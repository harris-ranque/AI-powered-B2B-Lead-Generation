"""
PostHog analytics helper for LangGraph worker.
Provides safe no-op wrappers when analytics are disabled.
"""

from __future__ import annotations

import os
import threading
from datetime import datetime
from typing import Any, Dict, Optional

from .logger import setup_logger

logger = setup_logger(__name__)

try:
    from posthog import Posthog  # type: ignore
except Exception:  # pragma: no cover - dependency missing in some environments
    Posthog = None  # type: ignore

_client_lock = threading.Lock()
_client: Optional[Any] = None


def _get_client() -> Optional[Any]:
    """Lazily initialize the PostHog client if credentials are present."""
    global _client  # pylint: disable=global-statement
    if _client is not None:
        return _client

    with _client_lock:
        if _client is not None:
            return _client

        api_key = os.getenv("POSTHOG_API_KEY")
        if not api_key:
            logger.debug("PostHog disabled - POSTHOG_API_KEY not configured")
            return None

        host = os.getenv("POSTHOG_HOST", "https://app.posthog.com")

        if Posthog is None:
            logger.warning("PostHog library not available - analytics disabled")
            return None

        try:
            _client = Posthog(project_api_key=api_key, host=host)
            logger.info("PostHog analytics client initialized", extra={"host": host})
        except Exception as error:  # pragma: no cover - defensive guard
            logger.error("Failed to initialize PostHog client", exc_info=error)
            _client = None

    return _client


def _build_properties(properties: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "timestamp": datetime.utcnow().isoformat(),
    }
    if properties:
        payload.update(properties)
    return payload


def capture_event(
    event: str,
    properties: Optional[Dict[str, Any]] = None,
    distinct_id: Optional[str] = None,
) -> None:
    """Send a PostHog event if analytics are enabled."""
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
        logger.error("PostHog capture error", exc_info=error)


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
