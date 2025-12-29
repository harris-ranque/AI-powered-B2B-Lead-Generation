"""
Request Queue for serializing API requests per provider.

Prevents thundering herd by ensuring requests are processed sequentially
or with controlled concurrency per provider.

Features:
- Priority queue (higher priority processed first)
- Configurable concurrency per provider
- Request timeout handling
- Queue depth monitoring
"""

import asyncio
import heapq
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, Generic, Optional, TypeVar
from uuid import uuid4

from .types import Provider, RequestContext
from .config import get_rate_limit_config

# Import logger from parent utils
try:
    from ..logger import setup_logger
    from ..analytics import capture_event
except ImportError:
    # Fallback for testing
    import logging
    def setup_logger(name):
        return logging.getLogger(name)
    def capture_event(event_name, properties):
        pass

logger = setup_logger(__name__)

T = TypeVar('T')


@dataclass(order=True)
class QueuedRequest(Generic[T]):
    """
    A request waiting in the queue.

    Ordered by priority (higher first), then by timestamp (earlier first).
    """
    priority: int = field(compare=True)  # Negated for max-heap behavior
    timestamp: float = field(compare=True)
    request_id: str = field(compare=False, default_factory=lambda: str(uuid4())[:8])
    context: RequestContext = field(compare=False, default=None)
    func: Callable[[], Awaitable[T]] = field(compare=False, default=None)
    future: asyncio.Future = field(compare=False, default=None)

    def __post_init__(self):
        # Negate priority for max-heap behavior (higher priority = lower value)
        self.priority = -self.priority


@dataclass
class QueueMetrics:
    """Metrics for queue observability."""
    total_enqueued: int = 0
    total_processed: int = 0
    total_timeouts: int = 0
    total_errors: int = 0
    current_depth: int = 0
    max_depth_reached: int = 0
    total_wait_time_seconds: float = 0.0

    def record_enqueue(self) -> None:
        """Record a request being enqueued."""
        self.total_enqueued += 1
        self.current_depth += 1
        self.max_depth_reached = max(self.max_depth_reached, self.current_depth)

    def record_dequeue(self, wait_time: float) -> None:
        """Record a request being dequeued for processing."""
        self.current_depth -= 1
        self.total_wait_time_seconds += wait_time

    def record_success(self) -> None:
        """Record successful request completion."""
        self.total_processed += 1

    def record_timeout(self) -> None:
        """Record a request timeout."""
        self.total_timeouts += 1

    def record_error(self) -> None:
        """Record a request error."""
        self.total_errors += 1

    @property
    def avg_wait_time_seconds(self) -> float:
        """Average wait time in queue."""
        if self.total_processed == 0:
            return 0.0
        return self.total_wait_time_seconds / self.total_processed

    def to_dict(self) -> dict:
        """Convert metrics to dictionary."""
        return {
            "total_enqueued": self.total_enqueued,
            "total_processed": self.total_processed,
            "total_timeouts": self.total_timeouts,
            "total_errors": self.total_errors,
            "current_depth": self.current_depth,
            "max_depth_reached": self.max_depth_reached,
            "avg_wait_time_seconds": round(self.avg_wait_time_seconds, 3),
        }


class ProviderRequestQueue:
    """
    Priority queue for serializing requests to a specific provider.

    Ensures requests are processed with controlled concurrency to prevent
    thundering herd and respect rate limits.

    Usage:
        queue = ProviderRequestQueue(Provider.PERPLEXITY, max_concurrent=1)

        result = await queue.submit(
            func=lambda: perplexity_client.research(query),
            context=RequestContext(provider=Provider.PERPLEXITY, model="sonar-pro"),
            priority=1,
            timeout=60.0
        )
    """

    def __init__(
        self,
        provider: Provider,
        max_concurrent: int = 1,
        max_queue_size: int = 1000
    ):
        """
        Initialize the request queue.

        Args:
            provider: The API provider this queue handles
            max_concurrent: Maximum concurrent requests (default 1 for serialization)
            max_queue_size: Maximum queue depth before rejecting requests
        """
        self.provider = provider
        self.max_concurrent = max_concurrent
        self.max_queue_size = max_queue_size

        self._queue: list[QueuedRequest] = []
        self._active_count = 0
        self._lock = asyncio.Lock()
        self._condition = asyncio.Condition(self._lock)
        self._shutdown = False
        self._processor_task: Optional[asyncio.Task] = None
        self.metrics = QueueMetrics()

        logger.info(
            f"[RequestQueue] Created queue for {provider.value}: "
            f"max_concurrent={max_concurrent}, max_queue_size={max_queue_size}"
        )

    async def start(self) -> None:
        """Start the queue processor."""
        if self._processor_task is None or self._processor_task.done():
            self._shutdown = False
            self._processor_task = asyncio.create_task(self._process_loop())
            logger.info(f"[RequestQueue] Started processor for {self.provider.value}")

    async def stop(self) -> None:
        """Stop the queue processor gracefully."""
        self._shutdown = True
        async with self._condition:
            self._condition.notify_all()

        if self._processor_task:
            try:
                await asyncio.wait_for(self._processor_task, timeout=5.0)
            except asyncio.TimeoutError:
                self._processor_task.cancel()
                try:
                    await self._processor_task
                except asyncio.CancelledError:
                    pass

        logger.info(f"[RequestQueue] Stopped processor for {self.provider.value}")

    async def submit(
        self,
        func: Callable[[], Awaitable[T]],
        context: Optional[RequestContext] = None,
        priority: int = 0,
        timeout: Optional[float] = None
    ) -> T:
        """
        Submit a request to the queue.

        Args:
            func: Async function to execute
            context: Request context for tracking
            priority: Request priority (higher = more important)
            timeout: Maximum wait time in seconds

        Returns:
            Result of the function execution

        Raises:
            QueueFullError: If queue is at capacity
            asyncio.TimeoutError: If timeout exceeded
        """
        config = get_rate_limit_config()
        timeout = timeout or config.queue_timeout_seconds

        # Check queue capacity
        if len(self._queue) >= self.max_queue_size:
            self.metrics.record_error()
            raise QueueFullError(
                f"Queue full for {self.provider.value}: {len(self._queue)}/{self.max_queue_size}"
            )

        # Create future for result
        loop = asyncio.get_event_loop()
        future: asyncio.Future[T] = loop.create_future()

        # Create queued request
        request = QueuedRequest(
            priority=priority,
            timestamp=time.monotonic(),
            context=context or RequestContext(provider=self.provider),
            func=func,
            future=future
        )

        # Add to queue
        async with self._lock:
            heapq.heappush(self._queue, request)
            self.metrics.record_enqueue()

            logger.debug(
                f"[RequestQueue] Enqueued request for {self.provider.value}: "
                f"id={request.request_id}, priority={-request.priority}, "
                f"queue_depth={len(self._queue)}"
            )

        # Notify processor
        async with self._condition:
            self._condition.notify()

        # Wait for result with timeout
        try:
            result = await asyncio.wait_for(future, timeout=timeout)
            return result
        except asyncio.TimeoutError:
            self.metrics.record_timeout()
            # Try to remove from queue if still there
            async with self._lock:
                try:
                    self._queue.remove(request)
                    heapq.heapify(self._queue)
                    self.metrics.current_depth -= 1
                except ValueError:
                    pass  # Already being processed

            logger.warning(
                f"[RequestQueue] Request timeout for {self.provider.value}: "
                f"id={request.request_id}, timeout={timeout}s"
            )
            raise

    async def _process_loop(self) -> None:
        """Main processing loop."""
        while not self._shutdown:
            try:
                await self._process_next()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[RequestQueue] Processor error for {self.provider.value}: {e}")
                await asyncio.sleep(0.1)  # Brief pause on error

    async def _process_next(self) -> None:
        """Process the next request in the queue."""
        async with self._condition:
            # Wait for available slot and queued request
            while (
                not self._shutdown
                and (self._active_count >= self.max_concurrent or len(self._queue) == 0)
            ):
                await self._condition.wait()

            if self._shutdown:
                return

            # Get highest priority request
            request = heapq.heappop(self._queue)
            self._active_count += 1
            wait_time = time.monotonic() - request.timestamp
            self.metrics.record_dequeue(wait_time)

        # Process request outside the lock
        try:
            if request.future.done():
                # Request was cancelled/timed out
                return

            logger.debug(
                f"[RequestQueue] Processing request for {self.provider.value}: "
                f"id={request.request_id}, waited={wait_time:.2f}s"
            )

            # Execute the function
            result = await request.func()

            # Set result if future not already done
            if not request.future.done():
                request.future.set_result(result)

            self.metrics.record_success()

        except Exception as e:
            self.metrics.record_error()
            if not request.future.done():
                request.future.set_exception(e)

            logger.error(
                f"[RequestQueue] Request failed for {self.provider.value}: "
                f"id={request.request_id}, error={e}"
            )
        finally:
            async with self._condition:
                self._active_count -= 1
                self._condition.notify()  # Wake up processor for next request

    @property
    def queue_depth(self) -> int:
        """Current number of requests in queue."""
        return len(self._queue)

    @property
    def active_requests(self) -> int:
        """Current number of requests being processed."""
        return self._active_count

    def get_stats(self) -> Dict:
        """Get queue statistics."""
        return {
            "provider": self.provider.value,
            "max_concurrent": self.max_concurrent,
            "queue_depth": self.queue_depth,
            "active_requests": self.active_requests,
            "metrics": self.metrics.to_dict(),
        }


class QueueFullError(Exception):
    """Raised when the request queue is at capacity."""
    pass


class RequestQueueManager:
    """
    Manages request queues for all providers.

    Provides a unified interface for submitting requests to any provider's queue.
    """

    def __init__(self):
        self._queues: Dict[Provider, ProviderRequestQueue] = {}
        self._lock = asyncio.Lock()

    async def get_queue(self, provider: Provider) -> ProviderRequestQueue:
        """Get or create queue for a provider."""
        if provider not in self._queues:
            async with self._lock:
                if provider not in self._queues:
                    config = get_rate_limit_config()
                    max_concurrent = config.get_max_concurrent(provider)

                    queue = ProviderRequestQueue(
                        provider=provider,
                        max_concurrent=max_concurrent,
                        max_queue_size=config.max_queue_size
                    )
                    await queue.start()
                    self._queues[provider] = queue

        return self._queues[provider]

    async def submit(
        self,
        provider: Provider,
        func: Callable[[], Awaitable[T]],
        context: Optional[RequestContext] = None,
        priority: int = 0,
        timeout: Optional[float] = None
    ) -> T:
        """
        Submit a request to the appropriate provider queue.

        Args:
            provider: Target API provider
            func: Async function to execute
            context: Request context for tracking
            priority: Request priority (higher = more important)
            timeout: Maximum wait time in seconds

        Returns:
            Result of the function execution
        """
        queue = await self.get_queue(provider)
        return await queue.submit(func, context, priority, timeout)

    async def shutdown(self) -> None:
        """Shutdown all queues gracefully."""
        for queue in self._queues.values():
            await queue.stop()
        self._queues.clear()
        logger.info("[RequestQueueManager] All queues shutdown")

    def get_all_stats(self) -> Dict[str, Dict]:
        """Get statistics for all queues."""
        return {
            provider.value: queue.get_stats()
            for provider, queue in self._queues.items()
        }
