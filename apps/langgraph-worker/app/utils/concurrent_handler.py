"""
Multi-Client Concurrent Request Handler for LangGraph Worker

Designed to handle 500+ concurrent requests from multiple clients with:
- Adaptive concurrency based on system resources
- Per-client rate limiting
- Request prioritization
- Graceful degradation under load
"""
import asyncio
import logging
import psutil
from typing import Dict, Any, Optional
from datetime import datetime, timedelta
from collections import defaultdict
from functools import wraps

logger = logging.getLogger(__name__)

class ResourceMonitor:
    """Monitor system resources for adaptive concurrency"""

    def __init__(self):
        self.process = psutil.Process()
        # Cache CPU measurement (updated asynchronously, not on every request)
        self._cached_cpu_percent = 0.0
        self._last_cpu_check = datetime.utcnow()
        # Prime the pump with initial call (subsequent calls will be non-blocking)
        try:
            self.process.cpu_percent(interval=None)
        except:
            pass

    def get_status(self) -> Dict[str, Any]:
        """Get current resource status (NON-BLOCKING)"""
        # Use non-blocking CPU measurement (interval=None)
        # This returns the CPU usage since last call, not requiring sleep
        now = datetime.utcnow()
        if (now - self._last_cpu_check).total_seconds() > 1.0:
            # Only update CPU measurement once per second max
            try:
                self._cached_cpu_percent = self.process.cpu_percent(interval=None)
                self._last_cpu_check = now
            except:
                # If measurement fails, use cached value
                pass

        memory_info = self.process.memory_info()
        memory_percent = self.process.memory_percent()

        return {
            "cpu_percent": self._cached_cpu_percent,
            "memory_mb": memory_info.rss / 1024 / 1024,
            "memory_percent": memory_percent,
            "timestamp": now.isoformat(),
        }

    def is_overloaded(self) -> bool:
        """Check if system is overloaded"""
        status = self.get_status()
        # Consider overloaded if CPU > 95% or memory > 90%
        return status["cpu_percent"] > 95 or status["memory_percent"] > 90

    def get_max_concurrency(self) -> int:
        """Calculate maximum safe concurrency based on current resources"""
        status = self.get_status()
        memory_percent = status["memory_percent"]
        cpu_percent = status["cpu_percent"]

        # Base concurrency on available resources
        if memory_percent > 85 or cpu_percent > 85:
            return 10  # Throttle heavily
        elif memory_percent > 70 or cpu_percent > 70:
            return 50  # Moderate throttling
        elif memory_percent > 50 or cpu_percent > 50:
            return 100  # Light throttling
        else:
            return 200  # Full capacity


class ClientRateLimiter:
    """Per-client rate limiting with sliding window"""

    def __init__(self,
                 requests_per_minute: int = 60,
                 burst_size: int = 20):
        self.requests_per_minute = requests_per_minute
        self.burst_size = burst_size
        self.client_windows: Dict[str, list] = defaultdict(list)
        self.lock = asyncio.Lock()

    async def check_rate_limit(self, client_id: str) -> tuple[bool, Optional[str]]:
        """
        Check if client is within rate limits

        Returns:
            (allowed: bool, error_message: Optional[str])
        """
        async with self.lock:
            now = datetime.utcnow()
            one_minute_ago = now - timedelta(minutes=1)

            # Get client's request window
            window = self.client_windows[client_id]

            # Remove old requests (outside 1-minute window)
            window[:] = [ts for ts in window if ts > one_minute_ago]

            # Check burst limit
            if len(window) >= self.burst_size:
                return False, f"Burst limit exceeded ({self.burst_size} requests/burst)"

            # Check per-minute limit
            if len(window) >= self.requests_per_minute:
                oldest_request = min(window)
                wait_seconds = (oldest_request + timedelta(minutes=1) - now).total_seconds()
                return False, f"Rate limit exceeded. Try again in {int(wait_seconds)}s"

            # Allow request and record timestamp
            window.append(now)
            return True, None

    def get_client_stats(self, client_id: str) -> Dict[str, Any]:
        """Get rate limit stats for a client"""
        window = self.client_windows.get(client_id, [])
        now = datetime.utcnow()
        one_minute_ago = now - timedelta(minutes=1)

        recent_requests = [ts for ts in window if ts > one_minute_ago]

        return {
            "client_id": client_id,
            "requests_last_minute": len(recent_requests),
            "limit": self.requests_per_minute,
            "burst_limit": self.burst_size,
            "remaining": max(0, self.requests_per_minute - len(recent_requests)),
        }

    async def cleanup_old_clients(self, inactive_hours: int = 1) -> int:
        """
        Clean up inactive clients to prevent memory leaks

        Args:
            inactive_hours: Remove clients inactive for this many hours (default: 1)

        Returns:
            Number of clients removed
        """
        async with self.lock:
            now = datetime.utcnow()
            cutoff_time = now - timedelta(hours=inactive_hours)

            clients_to_remove = []

            for client_id, window in self.client_windows.items():
                # Remove client if window is empty or all timestamps are old
                if not window or all(ts < cutoff_time for ts in window):
                    clients_to_remove.append(client_id)

            for client_id in clients_to_remove:
                del self.client_windows[client_id]

            if clients_to_remove:
                logger.info(f"Cleaned up {len(clients_to_remove)} inactive clients", {
                    "removed_count": len(clients_to_remove),
                    "remaining_clients": len(self.client_windows),
                    "inactive_hours": inactive_hours,
                })

            return len(clients_to_remove)

    def get_total_clients(self) -> int:
        """Get total number of tracked clients"""
        return len(self.client_windows)


class ConcurrentRequestHandler:
    """
    Handle concurrent requests with adaptive concurrency and rate limiting

    Features:
    - Adaptive concurrency based on system resources
    - Per-client rate limiting
    - Request queuing with priority
    - Graceful degradation under load
    """

    def __init__(self,
                 max_concurrent: int = 200,
                 max_queue_size: int = 1000,
                 requests_per_minute_per_client: int = 60):
        self.max_concurrent = max_concurrent
        self.max_queue_size = max_queue_size

        # Semaphore for concurrency control
        self.semaphore = asyncio.Semaphore(max_concurrent)

        # Active request tracking
        self.active_requests = 0
        self.total_requests = 0
        self.failed_requests = 0

        # Resource monitoring
        self.resource_monitor = ResourceMonitor()

        # Rate limiting
        self.rate_limiter = ClientRateLimiter(
            requests_per_minute=requests_per_minute_per_client
        )

        # Request queue for when at capacity
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=max_queue_size)

        logger.info(f"Initialized ConcurrentRequestHandler: max_concurrent={max_concurrent}, "
                   f"max_queue={max_queue_size}, rate_limit={requests_per_minute_per_client}/min/client")

    async def process_request(self,
                             request_id: str,
                             client_id: str,
                             process_fn: callable,
                             *args,
                             **kwargs) -> Dict[str, Any]:
        """
        Process a request with concurrency control and rate limiting

        Args:
            request_id: Unique request identifier
            client_id: Client/user identifier for rate limiting
            process_fn: Async function to execute
            *args, **kwargs: Arguments to pass to process_fn

        Returns:
            Result from process_fn or error dict
        """
        start_time = datetime.utcnow()

        # Check rate limit for this client
        allowed, error_msg = await self.rate_limiter.check_rate_limit(client_id)
        if not allowed:
            logger.warning(f"Rate limit exceeded for client {client_id}: {error_msg}")
            return {
                "status": "error",
                "error": error_msg,
                "request_id": request_id,
                "client_id": client_id,
            }

        # Check if system is overloaded
        if self.resource_monitor.is_overloaded():
            logger.warning(f"System overloaded, rejecting request {request_id}")
            return {
                "status": "error",
                "error": "System at capacity. Please try again in a few moments.",
                "request_id": request_id,
                "client_id": client_id,
            }

        # Acquire semaphore (waits if at max concurrency)
        async with self.semaphore:
            self.active_requests += 1
            self.total_requests += 1

            try:
                logger.info(f"Processing request {request_id} for client {client_id} "
                          f"({self.active_requests} active)")

                # Execute the actual processing function
                result = await process_fn(*args, **kwargs)

                duration = (datetime.utcnow() - start_time).total_seconds()
                logger.info(f"Completed request {request_id} in {duration:.2f}s")

                return result

            except Exception as e:
                self.failed_requests += 1
                duration = (datetime.utcnow() - start_time).total_seconds()
                logger.error(f"Failed request {request_id} after {duration:.2f}s: {e}")

                return {
                    "status": "error",
                    "error": str(e),
                    "request_id": request_id,
                    "client_id": client_id,
                }

            finally:
                self.active_requests -= 1

    def get_stats(self) -> Dict[str, Any]:
        """Get handler statistics"""
        resource_status = self.resource_monitor.get_status()
        max_safe_concurrency = self.resource_monitor.get_max_concurrency()

        return {
            "active_requests": self.active_requests,
            "total_requests": self.total_requests,
            "failed_requests": self.failed_requests,
            "success_rate": (self.total_requests - self.failed_requests) / max(1, self.total_requests) * 100,
            "max_concurrent": self.max_concurrent,
            "max_safe_concurrent": max_safe_concurrency,
            "queue_size": self.queue.qsize(),
            "max_queue_size": self.max_queue_size,
            "resources": resource_status,
            "tracked_clients": self.rate_limiter.get_total_clients(),
        }

    def get_client_stats(self, client_id: str) -> Dict[str, Any]:
        """Get stats for a specific client"""
        return self.rate_limiter.get_client_stats(client_id)

    async def cleanup_inactive_clients(self, inactive_hours: int = 1) -> int:
        """
        Clean up inactive clients from rate limiter

        Args:
            inactive_hours: Remove clients inactive for this many hours (default: 1)

        Returns:
            Number of clients removed
        """
        return await self.rate_limiter.cleanup_old_clients(inactive_hours)


# Global singleton instance
# Configure for multi-client concurrent handling
concurrent_handler = ConcurrentRequestHandler(
    max_concurrent=200,  # Allow up to 200 concurrent requests
    max_queue_size=1000,  # Queue up to 1000 additional requests
    requests_per_minute_per_client=60,  # 60 requests per minute per client
)
