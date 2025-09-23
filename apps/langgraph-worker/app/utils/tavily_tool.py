"""
Tavily Search Tool integration using langchain-tavily.
Provides async wrapper around the official LangChain Tavily tool.
"""

import asyncio
import time
from collections import deque
from typing import Deque, Dict, Any, List, Optional, Literal
from pydantic import BaseModel, Field
from langchain_tavily import TavilySearch
from .config import get_settings
from .logger import setup_logger

logger = setup_logger(__name__)
settings = get_settings()

_rate_limit_lock: Optional[asyncio.Lock] = None
_request_timestamps: Deque[float] = deque()
_RATE_LIMIT_PER_MINUTE = getattr(settings, "tavily_rate_limit_per_minute", 500)


async def _acquire_rate_limit() -> None:
    """Ensure Tavily requests respect the configured per-minute rate limit."""
    if _RATE_LIMIT_PER_MINUTE <= 0:
        return

    global _rate_limit_lock
    if _rate_limit_lock is None:
        _rate_limit_lock = asyncio.Lock()

    lock = _rate_limit_lock

    while True:
        async with lock:
            now = time.monotonic()
            window_start = now - 60

            while _request_timestamps and _request_timestamps[0] < window_start:
                _request_timestamps.popleft()

            if len(_request_timestamps) < _RATE_LIMIT_PER_MINUTE:
                _request_timestamps.append(now)
                return

            oldest = _request_timestamps[0]
            wait_time = max(0.0, 60 - (now - oldest))

        if wait_time > 0:
            await asyncio.sleep(wait_time)

class TavilySearchResult(BaseModel):
    """Standardized Tavily search result"""
    query: str
    results: List[Dict[str, Any]] = Field(default_factory=list)
    follow_up_questions: Optional[List[str]] = None
    answer: Optional[str] = None
    images: List[str] = Field(default_factory=list)
    response_time: float = 0.0
    error: Optional[str] = None
    
    # Extracted fields for compatibility
    total_results: int = 0
    content_snippets: List[str] = Field(default_factory=list)
    urls: List[str] = Field(default_factory=list)
    titles: List[str] = Field(default_factory=list)

class TavilySearchTool:
    """
    Async wrapper around LangChain Tavily tool with enhanced functionality.
    Provides compatibility with existing research infrastructure.
    """
    
    def __init__(
        self,
        max_results: int = 5,
        topic: Literal["general", "news", "finance"] = "general",
        include_answer: bool = True,
        include_raw_content: bool = False,
        include_images: bool = False,
        include_image_descriptions: bool = False,
        search_depth: Literal["basic", "advanced"] = "basic",
        time_range: Optional[Literal["day", "week", "month", "year"]] = None,
        include_domains: Optional[List[str]] = None,
        exclude_domains: Optional[List[str]] = None,
        timeout: float = 5.0
    ):
        """
        Initialize Tavily search tool with comprehensive configuration.
        
        Args:
            max_results: Maximum number of search results to return (default: 5)
            topic: Category of the search - 'general', 'news', or 'finance' (default: 'general')
            include_answer: Include an answer to original query in results (default: True)
            include_raw_content: Include cleaned and parsed HTML of each search result (default: False)
            include_images: Include a list of query related images in the response (default: False)
            include_image_descriptions: Include descriptive text for each image (default: False)
            search_depth: Depth of the search - 'basic' or 'advanced' (default: 'basic')
            time_range: Time range back from current date - 'day', 'week', 'month', or 'year' (default: None)
            include_domains: List of domains to specifically include (default: None)
            exclude_domains: List of domains to specifically exclude (default: None)
            timeout: Request timeout in seconds (default: 5.0)
        """
        self.timeout = timeout
        
        # Check if API key is configured
        self.api_key = getattr(settings, 'tavily_api_key', None)
        if not self.api_key:
            logger.warning("Tavily API key not configured")
            self.tool = None
            return
            
        try:
            # Initialize the LangChain Tavily tool with configuration
            self.tool = TavilySearch(
                max_results=max_results,
                topic=topic,
                include_answer=include_answer,
                include_raw_content=include_raw_content,
                include_images=include_images,
                include_image_descriptions=include_image_descriptions,
                search_depth=search_depth,
                time_range=time_range,
                include_domains=include_domains,
                exclude_domains=exclude_domains
            )
            logger.info(f"Tavily tool initialized with max_results={max_results}, topic={topic}, depth={search_depth}")
            
        except Exception as e:
            logger.error(f"Failed to initialize Tavily tool: {str(e)}")
            self.tool = None
    
    async def search_async(
        self, 
        query: str,
        # Allow runtime parameter overrides
        include_images: Optional[bool] = None,
        search_depth: Optional[Literal["basic", "advanced"]] = None,
        time_range: Optional[Literal["day", "week", "month", "year"]] = None,
        include_domains: Optional[List[str]] = None,
        exclude_domains: Optional[List[str]] = None
    ) -> TavilySearchResult:
        """
        Perform async search using Tavily API via LangChain tool.
        
        Args:
            query: Natural language search query
            include_images: Override include_images setting
            search_depth: Override search_depth setting  
            time_range: Override time_range setting
            include_domains: Override include_domains setting
            exclude_domains: Override exclude_domains setting
            
        Returns:
            TavilySearchResult with search results and metadata
        """
        start_time = time.time()
        
        if not self.tool:
            return TavilySearchResult(
                query=query,
                error="Tavily tool not initialized - check API key configuration",
                response_time=time.time() - start_time
            )
        
        try:
            # Build search parameters
            search_params = {"query": query}

            # Add runtime parameter overrides if provided
            if include_images is not None:
                search_params["include_images"] = include_images
            if search_depth is not None:
                search_params["search_depth"] = search_depth
            if time_range is not None:
                search_params["time_range"] = time_range
            if include_domains is not None:
                search_params["include_domains"] = include_domains
            if exclude_domains is not None:
                search_params["exclude_domains"] = exclude_domains

            logger.info(f"Tavily search: {query} with params: {search_params}")

            # Respect Tavily API rate limits
            # TODO: Implement batching of Tavily requests to minimize latency while sharing rate limits efficiently.
            await _acquire_rate_limit()

            # Execute search with timeout
            result = await asyncio.wait_for(
                self._run_tool_async(search_params),
                timeout=self.timeout
            )
            
            response_time = time.time() - start_time
            
            # Process and standardize the result
            return self._process_tavily_result(query, result, response_time)
            
        except asyncio.TimeoutError:
            logger.warning(f"Tavily search timeout for query: {query}")
            return TavilySearchResult(
                query=query,
                error="Search timeout",
                response_time=time.time() - start_time
            )
        except Exception as e:
            logger.error(f"Tavily search error for '{query}': {str(e)}")
            return TavilySearchResult(
                query=query,
                error=f"Search error: {str(e)}",
                response_time=time.time() - start_time
            )
    
    async def _run_tool_async(self, search_params: Dict[str, Any]) -> Any:
        """Run the LangChain tool in async context"""
        # LangChain tools are typically sync, so we run in thread pool
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.tool.invoke, search_params)
    
    def _process_tavily_result(self, query: str, raw_result: Any, response_time: float) -> TavilySearchResult:
        """
        Process raw Tavily result into standardized format.
        
        Args:
            query: Original search query
            raw_result: Raw result from LangChain Tavily tool
            response_time: Time taken for the search
            
        Returns:
            Processed TavilySearchResult
        """
        try:
            # Handle different result formats
            if isinstance(raw_result, str):
                # Tool returned string (JSON format)
                import json
                try:
                    data = json.loads(raw_result)
                except json.JSONDecodeError:
                    # If not JSON, treat as plain text answer
                    return TavilySearchResult(
                        query=query,
                        answer=raw_result,
                        response_time=response_time,
                        total_results=1,
                        content_snippets=[raw_result]
                    )
            elif isinstance(raw_result, dict):
                # Tool returned dictionary
                data = raw_result
            else:
                # Unexpected format
                logger.warning(f"Unexpected Tavily result format: {type(raw_result)}")
                return TavilySearchResult(
                    query=query,
                    error="Unexpected result format",
                    response_time=response_time
                )
            
            # Extract standard fields
            results = data.get("results", [])
            answer = data.get("answer")
            follow_up_questions = data.get("follow_up_questions", [])
            images = data.get("images", [])
            
            # Extract content for compatibility
            content_snippets = []
            urls = []
            titles = []
            
            for result in results:
                if isinstance(result, dict):
                    content_snippets.append(result.get("content", ""))
                    urls.append(result.get("url", ""))
                    titles.append(result.get("title", ""))
            
            logger.info(f"Tavily search completed: {len(results)} results, answer={'Yes' if answer else 'No'}")
            
            return TavilySearchResult(
                query=query,
                results=results,
                follow_up_questions=follow_up_questions,
                answer=answer,
                images=images,
                response_time=response_time,
                total_results=len(results),
                content_snippets=content_snippets,
                urls=urls,
                titles=titles
            )
            
        except Exception as e:
            logger.error(f"Error processing Tavily result: {str(e)}")
            return TavilySearchResult(
                query=query,
                error=f"Result processing error: {str(e)}",
                response_time=response_time
            )
    
    def search_sync(self, query: str, **kwargs) -> TavilySearchResult:
        """
        Synchronous search wrapper for compatibility.
        
        Args:
            query: Search query
            **kwargs: Additional search parameters
            
        Returns:
            TavilySearchResult with search results
        """
        # Run async search in sync context
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # If we're already in an async context, we need to handle this differently
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as executor:
                    future = executor.submit(asyncio.run, self.search_async(query, **kwargs))
                    return future.result(timeout=self.timeout + 1)
            else:
                return asyncio.run(self.search_async(query, **kwargs))
        except Exception as e:
            logger.error(f"Sync search error: {str(e)}")
            return TavilySearchResult(
                query=query,
                error=f"Sync search error: {str(e)}",
                response_time=0.0
            )

# Factory function for easy instantiation
def create_tavily_tool(
    max_results: int = 5,
    topic: Literal["general", "news", "finance"] = "general",
    search_depth: Literal["basic", "advanced"] = "basic",
    include_answer: bool = True,
    timeout: float = 5.0,
    **kwargs
) -> TavilySearchTool:
    """
    Create a configured Tavily search tool.
    
    Args:
        max_results: Maximum number of results
        topic: Search topic category
        search_depth: Search depth level
        include_answer: Whether to include answer summary
        timeout: Request timeout
        **kwargs: Additional tool configuration
        
    Returns:
        Configured TavilySearchTool instance
    """
    return TavilySearchTool(
        max_results=max_results,
        topic=topic,
        search_depth=search_depth,
        include_answer=include_answer,
        timeout=timeout,
        **kwargs
    )