"""
Performance optimization utilities for single replica CrewAI worker
Handles memory management and resource optimization
"""
import gc
import psutil
import asyncio
import logging
from typing import Dict, Any, Optional
from concurrent.futures import ThreadPoolExecutor
from functools import wraps
from datetime import datetime

logger = logging.getLogger(__name__)

class MemoryOptimizer:
    """Memory optimization for single replica deployment"""
    
    def __init__(self, memory_limit_mb: int = 1024):
        self.memory_limit = memory_limit_mb * 1024 * 1024
        self.process = psutil.Process()
        
    def get_memory_usage(self) -> Dict[str, Any]:
        """Get current memory usage statistics"""
        memory_info = self.process.memory_info()
        memory_percent = self.process.memory_percent()
        
        return {
            "rss": memory_info.rss,
            "vms": memory_info.vms,
            "percent": memory_percent,
            "limit": self.memory_limit,
            "available": psutil.virtual_memory().available
        }
    
    def cleanup_if_needed(self) -> bool:
        """Cleanup memory if threshold is exceeded"""
        current_memory = self.process.memory_info().rss
        threshold = self.memory_limit * 0.8
        
        if current_memory > threshold:
            logger.warning(f"Memory usage ({current_memory / 1024 / 1024:.1f}MB) exceeds threshold")
            
            # Force garbage collection
            collected = gc.collect()
            
            # Log results
            new_memory = self.process.memory_info().rss
            freed = current_memory - new_memory
            
            logger.info(f"Memory cleanup: freed {freed / 1024 / 1024:.1f}MB, collected {collected} objects")
            
            return True
        
        return False
    
    def is_memory_critical(self) -> bool:
        """Check if memory usage is critical"""
        current_memory = self.process.memory_info().rss
        return current_memory > self.memory_limit * 0.9

class SingleReplicaOptimizer:
    """Optimization for single replica CrewAI deployment"""
    
    def __init__(self, max_workers: int = 4, queue_size: int = 100):
        self.executor = ThreadPoolExecutor(max_workers=max_workers)
        self.task_queue = asyncio.Queue(maxsize=queue_size)
        self.memory_optimizer = MemoryOptimizer()
        self.active_tasks = 0
        self.max_concurrent_tasks = 2  # Limit for single replica
        
    async def process_with_queue(self, task_data: Dict[str, Any]) -> Dict[str, Any]:
        """Queue task for background processing"""
        if self.task_queue.qsize() >= self.task_queue.maxsize:
            raise Exception("Task queue is full. Please try again later.")
        
        await self.task_queue.put(task_data)
        return {
            "status": "queued",
            "message": "Processing in background",
            "queue_size": self.task_queue.qsize()
        }
    
    async def background_processor(self):
        """Background task processor with memory management"""
        while True:
            try:
                # Wait for task with timeout
                task = await asyncio.wait_for(self.task_queue.get(), timeout=1.0)
                
                # Check if we can process more tasks
                if self.active_tasks >= self.max_concurrent_tasks:
                    # Put task back and wait
                    await self.task_queue.put(task)
                    await asyncio.sleep(1)
                    continue
                
                # Check memory before processing
                if self.memory_optimizer.is_memory_critical():
                    logger.warning("Memory critical, skipping task processing")
                    await self.task_queue.put(task)  # Put back in queue
                    await asyncio.sleep(5)
                    continue
                
                # Process task
                self.active_tasks += 1
                try:
                    await asyncio.get_event_loop().run_in_executor(
                        self.executor, self._process_ai_task, task
                    )
                finally:
                    self.active_tasks -= 1
                    self.memory_optimizer.cleanup_if_needed()
                
            except asyncio.TimeoutError:
                # No tasks in queue, perform maintenance
                self.memory_optimizer.cleanup_if_needed()
                continue
            except Exception as e:
                logger.error(f"Error in background processor: {e}")
                self.active_tasks = max(0, self.active_tasks - 1)
    
    def _process_ai_task(self, task_data: Dict[str, Any]) -> Dict[str, Any]:
        """Process AI task in thread executor"""
        # This would contain the actual CrewAI processing logic
        # For now, return a placeholder
        return {
            "status": "processed",
            "timestamp": datetime.utcnow().isoformat(),
            "task_id": task_data.get("id", "unknown")
        }
    
    def get_status(self) -> Dict[str, Any]:
        """Get optimizer status"""
        return {
            "active_tasks": self.active_tasks,
            "queue_size": self.task_queue.qsize(),
            "max_concurrent": self.max_concurrent_tasks,
            "memory": self.memory_optimizer.get_memory_usage(),
            "executor_threads": len(self.executor._threads) if hasattr(self.executor, '_threads') else 0
        }

def memory_monitor(func):
    """Decorator to monitor memory usage of functions"""
    @wraps(func)
    async def wrapper(*args, **kwargs):
        optimizer = MemoryOptimizer()
        
        # Log memory before
        before = optimizer.get_memory_usage()
        start_time = datetime.utcnow()
        
        try:
            result = await func(*args, **kwargs)
            
            # Log memory after
            after = optimizer.get_memory_usage()
            duration = (datetime.utcnow() - start_time).total_seconds()
            
            memory_diff = after["rss"] - before["rss"]
            logger.info(f"{func.__name__} completed in {duration:.2f}s, memory delta: {memory_diff / 1024 / 1024:.1f}MB")
            
            # Cleanup if needed
            optimizer.cleanup_if_needed()
            
            return result
            
        except Exception as e:
            logger.error(f"Error in {func.__name__}: {e}")
            optimizer.cleanup_if_needed()
            raise
    
    return wrapper

# Global instance
single_replica_optimizer = SingleReplicaOptimizer()