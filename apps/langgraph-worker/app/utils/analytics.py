"""
PostHog analytics helper for LangGraph worker.
Provides safe wrappers when analytics are enabled.

PostHog's Python SDK handles async event dispatch internally via an internal
queue and consumer thread. Events are batched and sent in the background.

IMPORTANT: Call shutdown_analytics() before process termination to ensure
all queued events are flushed to PostHog.
"""

from __future__ import annotations

import atexit
import os
import threading
import time
from datetime import datetime
from typing import Any, Dict, Optional

from .logger import setup_logger

logger = setup_logger(__name__)

# Try to import posthog - it may not be available in all environments
try:
    import posthog as posthog_module  # type: ignore
except ImportError:  # pragma: no cover - dependency missing in some environments
    posthog_module = None  # type: ignore

_client_lock = threading.Lock()
_client: Optional[Any] = None
_shutdown_registered = False


def _get_client() -> Optional[Any]:
    """
    Lazily initialize the PostHog client if credentials are present.

    PostHog SDK handles async internally - events are queued and sent
    by a background consumer thread automatically.
    """
    global _client, _shutdown_registered

    if _client is not None:
        return _client

    with _client_lock:
        if _client is not None:
            return _client

        api_key = os.getenv("POSTHOG_API_KEY")
        if not api_key:
            logger.debug("PostHog disabled - POSTHOG_API_KEY not configured")
            return None

        # Default to US cloud; override with POSTHOG_HOST if needed
        host = os.getenv("POSTHOG_HOST", "https://us.i.posthog.com")

        if posthog_module is None:
            logger.warning("PostHog library not available - analytics disabled")
            return None

        try:
            # Initialize the global posthog module (recommended approach)
            posthog_module.api_key = api_key
            posthog_module.host = host

            # Disable sending in debug mode if needed
            posthog_module.debug = os.getenv("POSTHOG_DEBUG", "").lower() == "true"

            _client = posthog_module
            logger.info("PostHog analytics initialized", extra={"host": host})

            # Register shutdown handler to flush events on process exit
            if not _shutdown_registered:
                atexit.register(shutdown_analytics)
                _shutdown_registered = True

        except Exception as error:  # pragma: no cover - defensive guard
            logger.error("Failed to initialize PostHog", exc_info=error)
            _client = None

    return _client


def _build_properties(properties: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Build event properties with standard metadata."""
    payload: Dict[str, Any] = {
        "timestamp": datetime.utcnow().isoformat(),
        "service": "langgraph-worker",
        "environment": os.getenv("ENVIRONMENT", "production"),
    }
    if properties:
        payload.update(properties)
    return payload


def capture_event(
    event: str,
    properties: Optional[Dict[str, Any]] = None,
    distinct_id: Optional[str] = None,
) -> None:
    """
    Send a PostHog event if analytics are enabled.

    PostHog's SDK handles async dispatch internally - events are queued
    and sent by a background consumer thread. This call returns immediately
    after adding the event to the internal queue.
    """
    client = _get_client()
    if not client:
        return

    try:
        client.capture(
            distinct_id=distinct_id or "langgraph-worker",
            event=event,
            properties=_build_properties(properties),
        )
    except Exception as error:  # pragma: no cover - analytics should never break core flow
        logger.error(f"PostHog capture error for {event}", exc_info=error)


def capture_error(
    event: str,
    error: Exception,
    properties: Optional[Dict[str, Any]] = None,
    distinct_id: Optional[str] = None,
) -> None:
    """Capture an error event with stack-safe handling."""
    error_properties = {
        "error": str(error),
        "error_type": error.__class__.__name__,
    }
    if properties:
        error_properties.update(properties)
    capture_event(event, error_properties, distinct_id)


# =============================================================================
# LLM Analytics (LangChain Callback Handler)
# =============================================================================

def create_llm_callback_handler(
    distinct_id: Optional[str] = None,
    trace_id: Optional[str] = None,
    properties: Optional[Dict[str, Any]] = None,
) -> Optional[Any]:
    """
    Create PostHog LangChain callback handler for LLM analytics.

    Automatically captures: tokens, cost, latency, inputs/outputs, trace hierarchies.

    The callback handler operates asynchronously and will not block LLM calls.
    PostHog's SDK fires off async calls to PostHog in the background.

    Args:
        distinct_id: User ID (Convex user_id) for cost attribution
        trace_id: Request ID to group related LLM calls
        properties: Custom properties (search_id, lead_company, etc.)

    Returns:
        CallbackHandler if PostHog is configured, None otherwise
    """
    client = _get_client()
    if not client:
        return None

    try:
        # Import the LangChain callback handler from PostHog
        # This requires posthog[langchain] extras
        from posthog.ai.langchain import CallbackHandler

        full_properties = {
            "service": "langgraph-worker",
            "environment": os.getenv("ENVIRONMENT", "production"),
        }
        if properties:
            full_properties.update(properties)

        return CallbackHandler(
            client=client,
            distinct_id=distinct_id or "langgraph-worker",
            trace_id=trace_id,
            properties=full_properties,
            privacy_mode=False,  # Full visibility for debugging
        )
    except ImportError:
        logger.warning(
            "PostHog LangChain integration not available - install posthog[langchain]"
        )
        return None
    except Exception as error:
        logger.error("Failed to create LLM callback handler", exc_info=error)
        return None


# =============================================================================
# API Call Tracking
# =============================================================================

class APICallTracker:
    """
    Context manager for tracking API call metrics to PostHog.

    Usage:
        async with APICallTracker("perplexity_sonar", company_name="Acme Corp") as tracker:
            result = await make_api_call()
            tracker.set_result(success=True, tokens=1500, cost=0.02)

    Events are queued to PostHog's internal buffer and sent asynchronously
    by the SDK's background consumer thread.
    """

    def __init__(
        self,
        api_name: str,
        distinct_id: Optional[str] = None,
        **context: Any,
    ):
        self.api_name = api_name
        self.distinct_id = distinct_id
        self.context = context
        self.start_time: float = 0
        self.result_data: Dict[str, Any] = {}

    def __enter__(self) -> "APICallTracker":
        self.start_time = time.time()
        # Fire start event
        capture_event(
            f"api_{self.api_name}_started",
            {
                **self.context,
                "api_name": self.api_name,
            },
            self.distinct_id,
        )
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        duration_ms = (time.time() - self.start_time) * 1000

        if exc_type is not None:
            # Error occurred
            capture_event(
                f"api_{self.api_name}_error",
                {
                    **self.context,
                    **self.result_data,
                    "api_name": self.api_name,
                    "duration_ms": duration_ms,
                    "error": str(exc_val),
                    "error_type": exc_type.__name__ if exc_type else "Unknown",
                    "success": False,
                },
                self.distinct_id,
            )
        else:
            # Success or manual result set
            capture_event(
                f"api_{self.api_name}_completed",
                {
                    **self.context,
                    **self.result_data,
                    "api_name": self.api_name,
                    "duration_ms": duration_ms,
                    "success": self.result_data.get("success", True),
                },
                self.distinct_id,
            )

    async def __aenter__(self) -> "APICallTracker":
        return self.__enter__()

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.__exit__(exc_type, exc_val, exc_tb)

    def set_result(self, **kwargs: Any) -> None:
        """Set result data to be included in the completion event."""
        self.result_data.update(kwargs)


def track_api_call(
    api_name: str,
    distinct_id: Optional[str] = None,
    **context: Any,
) -> APICallTracker:
    """
    Create a context manager for tracking API calls to PostHog.

    Args:
        api_name: Name of the API (e.g., "perplexity_sonar", "tavily", "openai")
        distinct_id: User ID for attribution
        **context: Additional context (company_name, request_id, etc.)

    Returns:
        APICallTracker context manager

    Example:
        async with track_api_call("perplexity_sonar", company_name="Acme") as tracker:
            result = await perplexity_client.research(...)
            tracker.set_result(
                success=True,
                confidence_score=0.85,
                sources_analyzed=15,
                tokens_used=2500,
            )
    """
    return APICallTracker(api_name, distinct_id, **context)


# =============================================================================
# Convenience Functions for Specific APIs
# =============================================================================

def track_tavily_call(
    company_name: str,
    distinct_id: Optional[str] = None,
    request_id: Optional[str] = None,
    **extra: Any,
) -> APICallTracker:
    """Track Tavily search API calls."""
    return track_api_call(
        "tavily_search",
        distinct_id=distinct_id,
        company_name=company_name,
        request_id=request_id,
        api_provider="tavily",
        **extra,
    )


def track_perplexity_sonar_call(
    company_name: str,
    distinct_id: Optional[str] = None,
    request_id: Optional[str] = None,
    **extra: Any,
) -> APICallTracker:
    """Track Perplexity Sonar Pro API calls."""
    return track_api_call(
        "perplexity_sonar_pro",
        distinct_id=distinct_id,
        company_name=company_name,
        request_id=request_id,
        api_provider="perplexity",
        model="sonar-pro",
        **extra,
    )


def track_perplexity_deep_research_call(
    company_name: str,
    distinct_id: Optional[str] = None,
    request_id: Optional[str] = None,
    **extra: Any,
) -> APICallTracker:
    """Track Perplexity Deep Research API calls."""
    return track_api_call(
        "perplexity_deep_research",
        distinct_id=distinct_id,
        company_name=company_name,
        request_id=request_id,
        api_provider="perplexity",
        model="sonar-deep-research",
        **extra,
    )


def track_google_maps_call(
    query: str,
    distinct_id: Optional[str] = None,
    request_id: Optional[str] = None,
    **extra: Any,
) -> APICallTracker:
    """Track Google Maps API calls."""
    return track_api_call(
        "google_maps",
        distinct_id=distinct_id,
        query=query,
        request_id=request_id,
        api_provider="google",
        **extra,
    )


def track_openai_call(
    model: str,
    distinct_id: Optional[str] = None,
    request_id: Optional[str] = None,
    agent_name: Optional[str] = None,
    **extra: Any,
) -> APICallTracker:
    """Track OpenAI API calls (for direct calls, not via LangChain callback)."""
    return track_api_call(
        "openai_chat",
        distinct_id=distinct_id,
        model=model,
        request_id=request_id,
        agent_name=agent_name,
        api_provider="openai",
        **extra,
    )


# =============================================================================
# Cleanup
# =============================================================================

def shutdown_analytics() -> None:
    """
    Gracefully shutdown PostHog analytics.

    IMPORTANT: Call this before process termination to ensure all queued
    events are flushed to PostHog. This is especially critical in serverless
    environments.

    Per PostHog docs: "posthog.shutdown() flushes all messages and cleanly
    shuts down the client."
    """
    global _client

    if _client is not None:
        try:
            logger.info("Flushing PostHog analytics before shutdown...")
            _client.shutdown()
            logger.info("PostHog analytics shutdown complete")
        except Exception as error:  # pragma: no cover
            logger.error("Error during PostHog shutdown", exc_info=error)
        finally:
            _client = None


def flush_analytics() -> None:
    """
    Force flush all queued events to PostHog.

    Use this if you need to ensure events are sent immediately without
    shutting down the client. Note: This blocks until the queue is cleared.
    """
    client = _get_client()
    if client is not None:
        try:
            client.flush()
        except Exception as error:  # pragma: no cover
            logger.error("Error during PostHog flush", exc_info=error)
