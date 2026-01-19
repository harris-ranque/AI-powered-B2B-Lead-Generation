"""
Research API clients for tiered business context research system.
Supports two tiers: Tavily (fast) and Perplexity (comprehensive).
"""

import asyncio
import hashlib
import os
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple, Literal

import aiohttp
import googlemaps
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from ..utils.config import get_settings
from ..utils.logger import setup_logger
from ..utils.tavily_tool import TavilySearchTool, TavilySearchResult
from ..utils.data_validation import BaseDataValidator, DataValidationResult
from ..utils.analytics import (
    capture_event,
    capture_error,
    track_tavily_call,
    track_perplexity_sonar_call,
    track_perplexity_deep_research_call,
)
from ..utils.perplexity_rate_limiter import create_perplexity_rate_limiter, PerplexityRateLimiter
from ..utils.perplexity_retry import (
    perplexity_request_with_retry,
    handle_perplexity_response,
    RateLimitError,
    RateLimitExhaustedError,
    PerplexityAPIError,
    RetryConfig,
)
# New adaptive rate limiting system
from ..utils.rate_limiting import (
    rate_limited_request,
    Provider,
    CircuitBreakerOpenError,
)
from ..utils.api_errors import (
    classify_perplexity_error,
    StandardizedApiError,
    should_block_pipeline,
    API_ERROR_CODES,
    ApiErrorCategory,
)
from ..config import PERPLEXITY_RATE_LIMIT_CONFIG

logger = setup_logger(__name__)
settings = get_settings()

class ResearchTier(str, Enum):
    TAVILY = "tavily"
    PERPLEXITY = "perplexity"

class ResearchResult(BaseModel):
    """Standardized research result structure"""
    query: str
    tier: ResearchTier
    confidence_score: float = Field(ge=0, le=1)
    data_points: int = 0
    sources_analyzed: int = 0
    response_time: float = 0.0

    # Content fields
    company_overview: str = ""
    services_products: List[str] = Field(default_factory=list)
    industry_insights: str = ""
    competitors: List[Dict[str, Any]] = Field(default_factory=list)

    # 5 CRITICAL STRUCTURED DATA POINTS for email personalization
    annual_revenue: str = ""  # e.g., "$5M-10M ARR", "$50M annual revenue", "Not publicly disclosed"
    employee_count: str = ""  # e.g., "50-100 employees", "250+ team members", "Doubled from 50 to 100 in 2023"
    leadership_names: List[str] = Field(default_factory=list)  # CEO, C-level executives with names
    recent_news: List[str] = Field(default_factory=list)  # Recent milestones with dates (≤6 months)
    funding_investments: str = ""  # Total funding, latest round details, key investors

    # Metadata
    raw_data: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None
    api_error: Optional[Dict[str, Any]] = None  # Standardized API error for frontend handling
    escalation_reason: Optional[str] = None
    final_tier_used: str = "basic"  # Tracks final research tier: "basic" (Tavily), "pro" (Sonar Pro), "deep" (Deep Research)

class TavilyClient:
    """
    Tier 1 research client using Tavily via LangChain integration for fast basic business context.
    Target: 2-3 seconds response time, basic business information.
    """
    
    def __init__(self, api_key: Optional[str] = None):
        # Initialize with Tavily-specific configuration optimized for business research
        tavily_config = {
            'max_results': getattr(settings, 'tavily_max_results', 5),
            'topic': getattr(settings, 'tavily_topic', 'general'),
            'include_answer': getattr(settings, 'tavily_include_answer', True),
            # OPTIMIZATION: Enable raw content for comprehensive data extraction
            'include_raw_content': getattr(settings, 'tavily_include_raw_content', True),  # Changed from False
            # Note: search_depth overridden per query in search() method
            'search_depth': getattr(settings, 'tavily_search_depth', 'basic'),
            # OPTIMIZATION: Increased timeout for advanced searches
            'timeout': getattr(settings, 'tavily_timeout', 10.0)  # Changed from 5.0s
        }
        
        resolved_key = api_key or getattr(settings, 'tavily_api_key', None)
        self.tavily_tool = TavilySearchTool(tavily_api_key=resolved_key, **tavily_config)
        self.timeout = tavily_config['timeout']
        self.api_key = resolved_key

        # Check if tool initialized successfully
        if not self.tavily_tool.tool:
            logger.warning("Tavily tool not initialized - check API key configuration")
    
    async def search(self, 
                    company_name: str, 
                    domain: str = "", 
                    max_results: int = 5) -> ResearchResult:
        """
        Perform basic business context search using Tavily via LangChain tool.
        
        Args:
            company_name: Name of the company to research
            domain: Company domain/website
            max_results: Maximum search results to process
            
        Returns:
            ResearchResult with basic business context
        """
        start_time = time.time()
        
        # Check if tool is available
        if not self.tavily_tool.tool:
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.TAVILY,
                confidence_score=0.0,
                error="Tavily API key not configured"
            )
        
        # EMAIL-OPTIMIZED COMPREHENSIVE QUERY: Tavily is PRIMARY source (Perplexity is fallback)
        # Search for ALL the same data points as Perplexity prompt to avoid escalation
        # Keep query comprehensive but under 400 chars for optimal results
        query_parts = [
            f"{company_name}",
            "recent milestones funding rounds Series hiring announcements product launches",
            "competitors names case studies results metrics percentages",
            "pain points time savings cost reduction efficiency improvements",
            "industry benchmarks typical results peer comparison",
            "technology stack tools partnerships integrations"
        ]

        query = " ".join(query_parts)
        if domain:
            query += f" site:{domain}"  # Prioritize company website first

        # EMAIL-OPTIMIZED DOMAINS: Sources with recent news, funding, and competitor data
        business_domains = []
        if domain:
            business_domains.append(domain)  # Company website (press releases, news, about page)
        business_domains.extend([
            "linkedin.com/company",    # Company LinkedIn (recent posts, job listings, milestones)
            "crunchbase.com",          # Funding rounds, leadership changes, competitors
            "techcrunch.com",          # Recent news, funding announcements, launches
            "businesswire.com",        # Press releases, official announcements
            "prnewswire.com",          # Press releases, company news
        ])

        try:
            # CRITICAL: Use advanced search depth for query-relevant content chunks
            # Advanced search provides content closely aligned with query vs generic summaries
            async with track_tavily_call(
                company_name=company_name,
                request_id=None,  # Will be set by caller if available
                domain=domain,
                max_results=max_results,
                search_depth="advanced",
            ) as tracker:
                tavily_result: TavilySearchResult = await self.tavily_tool.search_async(
                    query=query,
                    search_depth="advanced",  # Changed from "basic" for 2x better quality
                    include_domains=business_domains,  # Focus on business sources
                )

                # Set result metrics for PostHog tracking
                tracker.set_result(
                    success=tavily_result.error is None,
                    total_results=tavily_result.total_results,
                    has_answer=bool(tavily_result.answer),
                    response_time_ms=tavily_result.response_time * 1000,
                )

            # Convert TavilySearchResult to ResearchResult format
            return self._convert_tavily_to_research_result(
                company_name, tavily_result
            )
                    
        except Exception as e:
            logger.error(f"Tavily search error for {company_name}: {str(e)}")
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.TAVILY,
                confidence_score=0.1,
                response_time=time.time() - start_time,
                error=f"Tavily error: {str(e)}"
            )
    
    def _convert_tavily_to_research_result(self, company_name: str, tavily_result: TavilySearchResult) -> ResearchResult:
        """
        Convert TavilySearchResult to ResearchResult format with enhanced metadata extraction.
        Uses Tavily best practices for post-processing and relevance scoring.
        """

        if tavily_result.error:
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.TAVILY,
                confidence_score=0.1,
                response_time=tavily_result.response_time,
                error=tavily_result.error
            )

        # OPTIMIZATION: Sort results by score (relevance) for better quality
        # Higher scores indicate better query-content alignment
        sorted_results = sorted(
            tavily_result.results,
            key=lambda r: r.get('score', 0.0),
            reverse=True
        )

        # OPTIMIZATION: Filter results by minimum score threshold (Tavily best practice)
        MIN_SCORE_THRESHOLD = 0.3  # Exclude low-relevance results
        high_quality_results = [
            r for r in sorted_results
            if r.get('score', 0.0) >= MIN_SCORE_THRESHOLD
        ]

        # Fall back to all results if filtering is too aggressive
        results_to_process = high_quality_results if high_quality_results else sorted_results

        # COMPREHENSIVE EMAIL-OPTIMIZED EXTRACTION: Match Perplexity data points
        services = []
        overview_parts = []
        recent_news = []  # Recent milestones with dates
        competitor_mentions = []  # Competitor names and case studies
        quantifiable_metrics = []  # Numbers, percentages, results
        pain_points = []  # Business challenges with impact
        industry_benchmarks = []  # Typical improvements, peer data

        # Add answer if available (high-quality summary from Tavily)
        if tavily_result.answer:
            overview_parts.append(tavily_result.answer)

        # Process content snippets with comprehensive extraction
        for i, result in enumerate(results_to_process):
            content = result.get('content', '')
            title = result.get('title', '')
            score = result.get('score', 0.0)
            raw_content = result.get('raw_content', '')

            if not content:
                continue

            title_lower = title.lower()
            content_lower = content.lower()
            content_for_analysis = raw_content if raw_content else content

            # 1. RECENT MILESTONES: Extract funding, hiring, launches with dates
            news_keywords = ['funding', 'series a', 'series b', 'series c', 'raised', 'million',
                           'hiring', 'launched', 'announced', 'expands', 'grows', 'milestone',
                           'acquisition', 'partnership', 'appoints', 'names', 'opens']
            if any(keyword in title_lower or keyword in content_lower for keyword in news_keywords):
                recent_news.append(f"{title}: {content[:250]}")

            # 2. COMPETITOR INTELLIGENCE: Extract competitor names and results
            competitor_keywords = ['competitor', 'versus', 'vs', 'compared to', 'alternative',
                                 'rival', 'compete', 'similar companies', 'peer', 'industry leader']
            if any(keyword in content_lower for keyword in competitor_keywords):
                competitor_mentions.append(f"{title}: {content[:300]}")

            # 3. QUANTIFIABLE METRICS: Extract numbers, percentages, results
            metrics_keywords = ['%', 'percent', 'increase', 'decrease', 'improved', 'reduced',
                              'saved', 'hours', 'minutes', 'revenue', 'growth', 'roi', 'conversion']
            if any(keyword in content_lower for keyword in metrics_keywords):
                quantifiable_metrics.append(f"{title}: {content[:250]}")

            # 4. PAIN POINTS: Extract business challenges
            pain_keywords = ['challenge', 'problem', 'struggle', 'difficult', 'bottleneck',
                           'manual', 'time-consuming', 'inefficient', 'costly', 'friction']
            if any(keyword in content_lower for keyword in pain_keywords):
                pain_points.append(f"{title}: {content[:250]}")

            # 5. INDUSTRY BENCHMARKS: Extract typical results and peer comparisons
            benchmark_keywords = ['typical', 'average', 'industry standard', 'benchmark',
                                'similar companies', 'peers', 'companies like', 'best practice']
            if any(keyword in content_lower for keyword in benchmark_keywords):
                industry_benchmarks.append(f"{title}: {content[:250]}")

            # OPTIMIZATION: Use title for keyword filtering (Tavily best practice)
            # Titles often indicate relevance better than content body
            is_business_relevant = any(
                keyword in title_lower
                for keyword in ['company', 'business', 'about', 'services', 'products', 'solutions']
            )

            # Add high-quality content to overview (prioritize high-score results)
            if score >= 0.5 or is_business_relevant:
                overview_parts.append(content[:300])  # Increased limit for advanced search

            # OPTIMIZATION: Extract services from raw_content if available
            # Raw content provides more structured data than snippets
            content_for_extraction = raw_content if raw_content else content

            # Extract potential services/products with better keyword matching
            service_keywords = [
                "service", "product", "solution", "offering", "software", "platform",
                "tool", "application", "system", "technology", "consulting", "support"
            ]
            if any(keyword in content_for_extraction.lower() for keyword in service_keywords):
                # Use title as service name if it's business-relevant
                if is_business_relevant and title:
                    services.append(title)
                elif title:
                    # Extract first meaningful sentence as service description
                    sentences = content_for_extraction.split('.')
                    for sentence in sentences[:3]:  # Check first 3 sentences
                        if any(keyword in sentence.lower() for keyword in service_keywords):
                            services.append(sentence.strip()[:100])
                            break

        company_overview = " ".join(overview_parts)[:1200]  # Increased limit for advanced search
        
        # Calculate base confidence based on result quality
        base_confidence = self._calculate_tavily_confidence(
            tavily_result.results,
            tavily_result.answer or ""
        )

        # Adjust confidence based on data validation (data completeness score)
        # This ensures weak data quality (e.g., 2/5 data points = 0.40) triggers escalation
        # Note: We'll apply data validation adjustment after creating result for proper flow
        confidence = base_confidence
        
        return ResearchResult(
            query=company_name,
            tier=ResearchTier.TAVILY,
            confidence_score=confidence,
            data_points=tavily_result.total_results,
            sources_analyzed=tavily_result.total_results,
            response_time=tavily_result.response_time,
            company_overview=company_overview,
            services_products=services[:5],  # Limit services
            raw_data={
                "langchain_tavily_result": {
                    "query": tavily_result.query,
                    "results": tavily_result.results,
                    "answer": tavily_result.answer,
                    "images": tavily_result.images,
                    "follow_up_questions": tavily_result.follow_up_questions,
                    "total_results": tavily_result.total_results
                },
                # COMPREHENSIVE EMAIL-READY DATA: Matches Perplexity's 5 critical data points
                "recent_news": recent_news[:5],  # Top 5 recent milestones for opening personalization
                "competitor_mentions": competitor_mentions[:5],  # Top 5 competitor references for proof points
                "quantifiable_metrics": quantifiable_metrics[:5],  # Top 5 metrics with numbers
                "pain_points": pain_points[:5],  # Top 5 business challenges
                "industry_benchmarks": industry_benchmarks[:5],  # Top 5 benchmark references
                # Data completeness tracking - aligned with 5 critical data points
                "data_completeness": {
                    "has_recent_news": len(recent_news) > 0,
                    "has_competitors": len(competitor_mentions) > 0,
                    "has_metrics": len(quantifiable_metrics) > 0,
                    "has_pain_points": len(pain_points) > 0,
                    "has_benchmarks": len(industry_benchmarks) > 0,
                    "completeness_score": sum([
                        len(recent_news) > 0,
                        len(competitor_mentions) > 0,
                        len(quantifiable_metrics) > 0,
                        len(pain_points) > 0,
                        len(industry_benchmarks) > 0,
                    ]) / 5.0  # 0.0 to 1.0 score (5 data points)
                }
            }
        )
    
    def _calculate_tavily_confidence(self, results: List[Dict], answer: str) -> float:
        """
        Calculate confidence score for Tavily results using metadata-aware scoring.
        Incorporates Tavily's relevance scores for better quality assessment.
        """
        score = 0.0

        # OPTIMIZATION: Leverage Tavily's relevance scores (best practice)
        # Average relevance score from results (weighted by Tavily's internal ranking)
        if results:
            relevance_scores = [r.get('score', 0.0) for r in results if 'score' in r]
            if relevance_scores:
                avg_relevance = sum(relevance_scores) / len(relevance_scores)
                score += min(0.5, avg_relevance)  # Cap at 0.5 for balance

        # Base score from number of results
        if len(results) >= 3:
            score += 0.2  # Reduced from 0.4 since we now use relevance scores
        elif len(results) >= 1:
            score += 0.1

        # Bonus for having a high-quality answer (Tavily's AI-generated summary)
        if answer and len(answer) > 100:
            score += 0.2  # Reduced from 0.3 for balance
        elif answer:
            score += 0.1

        # OPTIMIZATION: Check for raw_content availability (indicates deep extraction)
        has_raw_content = any(r.get('raw_content') for r in results)
        if has_raw_content:
            score += 0.1  # Bonus for comprehensive data

        # Bonus for content quality (comprehensive coverage)
        total_content_length = sum(len(r.get("content", "")) for r in results)
        if total_content_length > 1500:  # Higher threshold for advanced search
            score += 0.2  # Reduced from 0.3
        elif total_content_length > 500:
            score += 0.1

        return min(1.0, score)


class PerplexityClient:
    """
    Tier 3 research client using Perplexity for comprehensive business reports.
    Target: 10-15 seconds response time, comprehensive analysis with citations.

    Includes built-in rate limiting and retry logic:
    - Sliding window rate limiting per model (Tier 5 defaults: sonar-pro: 2000 RPM, sonar-deep-research: 100 RPM)
    - Exponential backoff with jitter for transient errors (handles lower-tier users who hit 429s)
    - Graceful degradation when rate limits exhausted after retries
    """

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or getattr(settings, 'perplexity_api_key', None)
        self.base_url = "https://api.perplexity.ai"
        self.timeout = 20.0  # Longer timeout for comprehensive analysis

        # Initialize rate limiter with configurable limits
        # BYOK clients may override via environment variables
        self.rate_limiter = create_perplexity_rate_limiter(
            sonar_pro_rpm=PERPLEXITY_RATE_LIMIT_CONFIG['SONAR_PRO_RPM'],
            deep_research_rpm=PERPLEXITY_RATE_LIMIT_CONFIG['DEEP_RESEARCH_RPM'],
        )

        # Initialize retry configuration
        self.retry_config = RetryConfig(
            max_retries=PERPLEXITY_RATE_LIMIT_CONFIG['MAX_RETRIES'],
            base_delay_ms=PERPLEXITY_RATE_LIMIT_CONFIG['BASE_DELAY_MS'],
            max_delay_ms=PERPLEXITY_RATE_LIMIT_CONFIG['MAX_DELAY_MS'],
            jitter_min=PERPLEXITY_RATE_LIMIT_CONFIG['JITTER_MIN'],
            jitter_max=PERPLEXITY_RATE_LIMIT_CONFIG['JITTER_MAX'],
            timeout_retry_once=PERPLEXITY_RATE_LIMIT_CONFIG['TIMEOUT_RETRY_ONCE'],
        )

        if not self.api_key:
            logger.warning("Perplexity API key not configured")
    
    async def comprehensive_research(self,
                                   company_name: str,
                                   domain: str = "",
                                   location: str = "",
                                   previous_context: str = "") -> ResearchResult:
        """
        Generate comprehensive business research report using Perplexity Sonar Pro.

        Args:
            company_name: Name of the company to research
            domain: Company domain/website
            location: Company physical location/address for context
            previous_context: Context from previous research tiers

        Returns:
            ResearchResult with comprehensive business intelligence

        Rate Limiting (NEW ADAPTIVE SYSTEM):
            - Uses adaptive rate limiter that learns actual API tier from 429s
            - Request queue prevents thundering herd
            - Per-API-key bucket isolation for BYOK support
            - Circuit breaker protection against cascading failures

        Retry Logic:
            - Retries on 429, 5xx errors with exponential backoff
            - Parses Retry-After header when available
            - Max 4 retries with jitter to prevent thundering herd
        """
        start_time = time.time()

        if not self.api_key:
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.PERPLEXITY,
                confidence_score=0.0,
                error="Perplexity API key not configured"
            )

        # Construct comprehensive research query
        query = self._build_comprehensive_query(company_name, domain, location, previous_context)

        # Prepare request payload
        payload = {
            # Use sonar-pro for comprehensive research
            "model": "sonar-pro",
            "messages": [
                {
                    "role": "system",
                    "content": "You are a business intelligence analyst. Provide comprehensive, factual research about companies including business model, market position, competitive landscape, recent developments, and growth opportunities. Include specific data points and cite your sources."
                },
                {
                    "role": "user",
                    "content": query
                }
            ],
            "max_tokens": 4000,
            "temperature": 0.3,
            "stream": False,
            "return_citations": True,
            "return_images": False
        }

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        async def make_api_call() -> dict:
            """Execute the actual API call."""
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=self.timeout)) as session:
                async with session.post(
                    f"{self.base_url}/chat/completions",
                    json=payload,
                    headers=headers
                ) as response:
                    # Use standardized response handler (raises RateLimitError on 429)
                    return await handle_perplexity_response(
                        response,
                        operation_name=f"sonar_pro_research:{company_name}"
                    )

        async def execute_with_rate_limit() -> dict:
            """Execute API call with rate limiting (retried by outer wrapper on 429)."""
            # Note: timeout here is for QUEUE wait, not API call
            # API timeout is set in make_api_call via aiohttp.ClientTimeout
            # Use default queue timeout (60s) - don't inflate it
            return await rate_limited_request(
                Provider.PERPLEXITY,
                make_api_call,
                model="sonar-pro",
                api_key=self.api_key,
                correlation_id=f"sonar_pro:{company_name}",
                # timeout defaults to 60s queue wait (from config)
            )

        try:
            # Use NEW adaptive rate limiting system with request queue
            # This replaces the old sliding window rate limiter
            async with track_perplexity_sonar_call(
                company_name=company_name,
                request_id=None,  # Will be set by caller if available
                domain=domain,
                location=location,
                rate_limit_wait_time=0,  # Will be tracked by new system
            ) as tracker:
                # Execute with retry logic wrapping the rate-limited request
                # perplexity_request_with_retry handles RateLimitError with exponential backoff
                data = await perplexity_request_with_retry(
                    execute_with_rate_limit,
                    config=self.retry_config,
                    operation_name=f"sonar_pro:{company_name}"
                )

                # Set result metrics for PostHog tracking
                choices = data.get("choices", [])
                content = choices[0].get("message", {}).get("content", "") if choices else ""
                citations = data.get("citations", [])
                tracker.set_result(
                    success=True,
                    word_count=len(content.split()) if content else 0,
                    citation_count=len(citations),
                    has_content=bool(content),
                )

            response_time = time.time() - start_time
            return self._process_perplexity_response(company_name, data, response_time)

        except CircuitBreakerOpenError as e:
            logger.error(f"Circuit breaker open for Perplexity (sonar-pro) researching {company_name}: {e}")
            api_error = classify_perplexity_error(429, f"Circuit breaker open: {str(e)}")
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.PERPLEXITY,
                confidence_score=0.2,
                response_time=time.time() - start_time,
                error=f"Rate limit circuit breaker open - too many consecutive 429s",
                api_error=api_error.to_dict()
            )
        except RateLimitExhaustedError as e:
            logger.error(f"Rate limit exhausted for sonar-pro research on {company_name}: {e}")
            # Classify as persistent rate limit exceeded (not transient)
            api_error = classify_perplexity_error(429, f"Rate limit exhausted after {e.total_attempts} attempts")
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.PERPLEXITY,
                confidence_score=0.2,
                response_time=time.time() - start_time,
                error=f"Rate limit exhausted after {e.total_attempts} attempts ({e.total_wait_time:.1f}s wait)",
                api_error=api_error.to_dict()
            )
        except PerplexityAPIError as e:
            logger.error(f"Perplexity API error for {company_name}: {e.status_code} - {e.message}")
            # Classify the error for proper frontend handling
            api_error = classify_perplexity_error(e.status_code, e.message)
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.PERPLEXITY,
                confidence_score=0.2,
                response_time=time.time() - start_time,
                error=f"Perplexity API error {e.status_code}: {e.message[:200]}",
                api_error=api_error.to_dict()
            )
        except asyncio.TimeoutError:
            # Classify timeout error
            api_error = classify_perplexity_error(408, "Request timed out")
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.PERPLEXITY,
                confidence_score=0.2,
                response_time=time.time() - start_time,
                error="Perplexity research timeout",
                api_error=api_error.to_dict()
            )
        except Exception as e:
            logger.error(f"Perplexity research error for {company_name}: {str(e)}")
            # Classify as unknown error
            api_error = classify_perplexity_error(500, str(e))
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.PERPLEXITY,
                confidence_score=0.2,
                response_time=time.time() - start_time,
                error=f"Perplexity error: {str(e)}",
                api_error=api_error.to_dict()
            )
    
    def _build_comprehensive_query(self, company_name: str, domain: str, location: str, context: str) -> str:
        """Build comprehensive research query for Perplexity - FOCUSED ON 5 REQUIRED DATA POINTS"""
        query_parts = [
            f"Provide comprehensive business intelligence for {company_name}",
        ]

        if domain:
            query_parts.append(f"(website: {domain})")

        if location:
            query_parts.append(f"(location: {location})")

        query_parts.extend([
            "",
            "Research and provide the following 5 CRITICAL DATA POINTS with SPECIFIC DETAILS:",
            "",
            "1. ANNUAL REVENUE:",
            "   - Current annual revenue or revenue range (e.g., '$5M-10M ARR', '$50M annual revenue')",
            "   - Revenue growth rate if available (e.g., 'grew 200% YoY to $10M')",
            "   - Revenue model (subscription, transaction, services, etc.)",
            "   - If exact revenue not available, provide company size indicators and funding as proxy",
            "",
            "2. EMPLOYEE COUNT:",
            "   - Current employee count or range (e.g., '50-100 employees', '250+ team members')",
            "   - Recent hiring activity with numbers (e.g., 'hired 15 SDRs in Q1 2024', 'posted 20 open roles')",
            "   - Key department sizes if available (e.g., '30-person sales team', '10 engineers')",
            "   - Growth trajectory (e.g., 'doubled headcount from 50 to 100 in 2023')",
            "",
            "3. LEADERSHIP NAMES:",
            "   - CEO/Founder name and background",
            "   - C-level executives (CTO, CFO, COO, CMO, etc.) with names",
            "   - VP-level leaders if C-suite not available",
            "   - Recent leadership changes or appointments with dates",
            "   - LinkedIn profiles or professional backgrounds when relevant",
            "",
            "4. RECENT COMPANY NEWS (≤6 MONTHS):",
            "   - Funding announcements with amounts and dates (e.g., 'closed Series B $25M in March 2024')",
            "   - Product launches or major feature releases with dates",
            "   - Partnership announcements with partner names and dates",
            "   - Acquisitions or market expansions with dates",
            "   - Awards, recognition, or major milestones with dates",
            "   - Press releases or news coverage from last 6 months",
            "",
            "5. FUNDING/INVESTMENTS:",
            "   - Total funding raised (e.g., '$50M total funding across 3 rounds')",
            "   - Latest funding round details (Series A/B/C, amount, date, lead investors)",
            "   - Key investors and venture capital firms",
            "   - Valuation if publicly disclosed",
            "   - Bootstrap status if not venture-backed",
            "   - IPO status or acquisition history if applicable",
        ])

        if context:
            query_parts.append(f"Additional context from previous research: {context[:300]}")

        query_parts.extend([
            "",
            "CRITICAL REQUIREMENTS:",
            "- Provide REAL NAMES for all people (CEO, executives, investors)",
            "- Include SPECIFIC NUMBERS for revenue, employees, funding (never say 'approximately' without a range)",
            "- Include DATES for all recent news (must be within 6 months - after {6 months ago date})",
            "- Use REAL COMPANY NAMES for investors, partners, competitors",
            "- If data point is not available, explicitly state 'Not publicly disclosed' rather than guessing",
            "- Cite sources for all claims",
            "",
            "THESE 5 DATA POINTS ARE REQUIRED FOR EMAIL PERSONALIZATION:",
            "- Annual revenue helps establish company stage and decision-making authority",
            "- Employee count indicates organizational complexity and buying process",
            "- Leadership names enable personalized outreach and research",
            "- Recent news provides timely hooks for email opening lines",
            "- Funding details show growth trajectory and available budget",
        ])

        return " ".join(query_parts)

    async def deep_research(self,
                           company_name: str,
                           domain: str = "",
                           location: str = "",
                           previous_context: str = "") -> ResearchResult:
        """
        Generate exhaustive research report using Perplexity Deep Research model.
        Runs 30-90 seconds and searches hundreds of sources for comprehensive analysis.

        Args:
            company_name: Name of the company to research
            domain: Company domain/website
            location: Company physical location/address for context
            previous_context: Context from previous research tiers

        Returns:
            ResearchResult with exhaustive business intelligence

        Rate Limiting (NEW ADAPTIVE SYSTEM - Deep Research has strict limits):
            - Uses adaptive rate limiter that learns actual API tier from 429s
            - Starts at 5 RPM (Tier 0 limit) with conservative approach
            - Request queue serializes requests to prevent thundering herd
            - Circuit breaker protects against cascading failures

        Retry Logic:
            - Retries on 429, 5xx errors with exponential backoff
            - Parses Retry-After header when available
            - Max 4 retries with jitter to prevent thundering herd
            - Returns error result with flag for graceful degradation
        """
        start_time = time.time()

        if not self.api_key:
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.PERPLEXITY,
                confidence_score=0.0,
                error="Perplexity API key not configured"
            )

        # Construct deep research query using same query builder
        query = self._build_comprehensive_query(company_name, domain, location, previous_context)

        # Prepare request payload
        payload = {
            # Use sonar-deep-research model for exhaustive analysis
            "model": "sonar-deep-research",
            "messages": [
                {
                    "role": "system",
                    "content": "You are an expert business intelligence analyst conducting exhaustive research. Analyze hundreds of sources and provide comprehensive insights with detailed citations for all 5 required data points: annual revenue, employee count, leadership names, recent news (≤6 months), and funding details."
                },
                {
                    "role": "user",
                    "content": query
                }
            ],
            "max_tokens": 8000,  # Higher for detailed reports
            "temperature": 0.2,  # Lower for more focused research
            "stream": False,
            "return_citations": True,
            "return_images": False,
            # Deep research specific parameters
            "reasoning_effort": "high",  # Use high reasoning effort for exhaustive analysis
        }

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        # Longer timeout for deep research (90 seconds vs 20 seconds for standard)
        # Deep research queries can be complex and Perplexity needs more time
        deep_research_timeout = 90.0

        async def make_api_call() -> dict:
            """Execute the actual API call."""
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=deep_research_timeout)) as session:
                async with session.post(
                    f"{self.base_url}/chat/completions",
                    json=payload,
                    headers=headers
                ) as response:
                    # Use standardized response handler (raises RateLimitError on 429)
                    return await handle_perplexity_response(
                        response,
                        operation_name=f"deep_research:{company_name}"
                    )

        async def execute_with_rate_limit() -> dict:
            """Execute API call with rate limiting (retried by outer wrapper on 429)."""
            # Note: timeout here is for QUEUE wait, not API call
            # API timeout (90s) is set in make_api_call via aiohttp.ClientTimeout
            # Use default queue timeout (60s) - don't inflate to 150s!
            return await rate_limited_request(
                Provider.PERPLEXITY,
                make_api_call,
                model="sonar-deep-research",
                api_key=self.api_key,
                correlation_id=f"deep_research:{company_name}",
                # timeout defaults to 60s queue wait (from config)
                priority=0,  # Lower priority than sonar-pro
            )

        try:
            # Use NEW adaptive rate limiting system with request queue
            # This replaces the old sliding window rate limiter
            async with track_perplexity_deep_research_call(
                company_name=company_name,
                request_id=None,  # Will be set by caller if available
                domain=domain,
                location=location,
                rate_limit_wait_time=0,  # Will be tracked by new system
            ) as tracker:
                # Execute with retry logic wrapping the rate-limited request
                # perplexity_request_with_retry handles RateLimitError with exponential backoff
                data = await perplexity_request_with_retry(
                    execute_with_rate_limit,
                    config=self.retry_config,
                    operation_name=f"deep_research:{company_name}"
                )

                # Set result metrics for PostHog tracking
                choices = data.get("choices", [])
                content = choices[0].get("message", {}).get("content", "") if choices else ""
                citations = data.get("citations", [])
                tracker.set_result(
                    success=True,
                    word_count=len(content.split()) if content else 0,
                    citation_count=len(citations),
                    has_content=bool(content),
                )

            response_time = time.time() - start_time
            result = self._process_perplexity_response(company_name, data, response_time)
            result.final_tier_used = "deep"
            return result

        except CircuitBreakerOpenError as e:
            logger.error(f"Circuit breaker open for Perplexity (deep-research) researching {company_name}: {e}")
            api_error = classify_perplexity_error(429, f"Circuit breaker open: {str(e)}")
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.PERPLEXITY,
                confidence_score=0.2,
                response_time=time.time() - start_time,
                error=f"Rate limit circuit breaker open - too many consecutive 429s",
                api_error=api_error.to_dict(),
                final_tier_used="deep_failed"
            )
        except RateLimitExhaustedError as e:
            # GRACEFUL DEGRADATION: Return error result with flag
            # ResearchOrchestrator will fall back to Sonar Pro results
            logger.error(
                f"Deep research rate limit exhausted for {company_name} after {e.total_attempts} attempts, "
                f"total wait: {e.total_wait_time:.1f}s - graceful degradation will use Sonar Pro results"
            )
            # Classify as persistent rate limit exceeded
            api_error = classify_perplexity_error(429, f"Deep research rate limit exhausted after {e.total_attempts} attempts")
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.PERPLEXITY,
                confidence_score=0.3,  # Low confidence for failed deep research
                response_time=time.time() - start_time,
                error=f"Deep research rate limited after {e.total_attempts} retries",
                api_error=api_error.to_dict(),
                final_tier_used="deep_failed"  # Flag for graceful degradation
            )
        except PerplexityAPIError as e:
            logger.error(f"Deep research API error for {company_name}: {e.status_code} - {e.message}")
            # Classify the error for proper frontend handling
            api_error = classify_perplexity_error(e.status_code, e.message)
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.PERPLEXITY,
                confidence_score=0.2,
                response_time=time.time() - start_time,
                error=f"Deep research API error {e.status_code}: {e.message[:200]}",
                api_error=api_error.to_dict(),
                final_tier_used="deep_failed"
            )
        except asyncio.TimeoutError:
            elapsed = time.time() - start_time
            # Classify timeout error
            api_error = classify_perplexity_error(408, f"Deep research timeout ({deep_research_timeout}s)")
            logger.warning(f"Perplexity deep-research timeout for {company_name} after {elapsed:.1f}s (limit: {deep_research_timeout}s)")
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.PERPLEXITY,
                confidence_score=0.2,
                response_time=elapsed,
                error=f"Deep research timeout ({deep_research_timeout}s)",
                api_error=api_error.to_dict(),
                final_tier_used="deep_failed"
            )
        except Exception as e:
            logger.error(f"Deep research error for {company_name}: {str(e)}")
            # Classify as unknown error
            api_error = classify_perplexity_error(500, str(e))
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.PERPLEXITY,
                confidence_score=0.2,
                response_time=time.time() - start_time,
                error=f"Deep research error: {str(e)}",
                api_error=api_error.to_dict(),
                final_tier_used="deep_failed"
            )

    def _process_perplexity_response(self, company_name: str, data: Dict[str, Any], response_time: float) -> ResearchResult:
        """Process Perplexity API response into standardized format with structured data extraction"""
        choices = data.get("choices", [])
        if not choices:
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.PERPLEXITY,
                confidence_score=0.2,
                response_time=response_time,
                error="No response content from Perplexity"
            )

        content = choices[0].get("message", {}).get("content", "")
        citations = data.get("citations", [])

        # Extract structured data from content
        structured_data = self._extract_structured_data(content, company_name)

        # Calculate confidence based on content quality and citations
        confidence = self._calculate_perplexity_confidence(content, citations)

        # Count actual extracted data points (not sentences)
        actual_data_points = sum([
            1 if structured_data.get("annual_revenue") else 0,
            1 if structured_data.get("employee_count") else 0,
            1 if structured_data.get("leadership_names") else 0,
            1 if structured_data.get("recent_news") else 0,
            1 if structured_data.get("funding_investments") else 0
        ])

        return ResearchResult(
            query=company_name,
            tier=ResearchTier.PERPLEXITY,
            confidence_score=confidence,
            data_points=actual_data_points,
            sources_analyzed=len(citations),
            response_time=response_time,
            company_overview=content,
            # STRUCTURED DATA POINTS for email personalization
            annual_revenue=structured_data.get("annual_revenue", ""),
            employee_count=structured_data.get("employee_count", ""),
            leadership_names=structured_data.get("leadership_names", []),
            recent_news=structured_data.get("recent_news", []),
            funding_investments=structured_data.get("funding_investments", ""),
            raw_data={
                "comprehensive_report": content,
                "citations": citations,
                "word_count": len(content.split()) if content else 0,
                # Flatten extracted data to match Tavily's structure for downstream compatibility
                "recent_news": structured_data.get("recent_news", []),
                "competitor_mentions": [],  # Perplexity doesn't extract these directly
                "quantifiable_metrics": [],  # Perplexity doesn't extract these directly
                "pain_points": [],  # Perplexity doesn't extract these directly
                "industry_benchmarks": [],  # Perplexity doesn't extract these directly
                "technology_stack": [],  # Perplexity doesn't extract these directly
                "extracted_data": structured_data,  # Keep original for backward compatibility
                "data_completeness": {
                    "has_recent_news": len(structured_data.get("recent_news", [])) > 0,
                    "has_competitors": False,
                    "has_metrics": False,
                    "has_pain_points": False,
                    "has_benchmarks": False,
                    "completeness_score": 0.2 if len(structured_data.get("recent_news", [])) > 0 else 0.0
                }
            }
        )

    def _extract_structured_data(self, content: str, company_name: str) -> Dict[str, Any]:
        """Extract 5 critical data points from Perplexity response text"""
        import re
        from datetime import datetime, timedelta

        extracted = {
            "annual_revenue": "",
            "employee_count": "",
            "leadership_names": [],
            "recent_news": [],
            "funding_investments": ""
        }

        if not content:
            return extracted

        # Split content into sections for easier parsing
        lines = content.split("\n")
        content_lower = content.lower()

        # Extract annual revenue
        revenue_patterns = [
            r"\$[\d,]+[mkb]?\s*(?:arr|annual revenue|revenue|in sales)",
            r"revenue of \$[\d,]+[mkb]?",
            r"generated \$[\d,]+[mkb]?",
            r"\$[\d,.]+-\$?[\d,.]+[mkb]?\s*(?:arr|revenue)"
        ]
        for pattern in revenue_patterns:
            match = re.search(pattern, content, re.IGNORECASE)
            if match:
                extracted["annual_revenue"] = match.group(0)
                break

        if not extracted["annual_revenue"] and "not publicly disclosed" in content_lower:
            extracted["annual_revenue"] = "Not publicly disclosed"

        # Extract employee count
        employee_patterns = [
            r"\d+[\+\-]?\s*(?:employees?|team members?|staff)",
            r"(?:employs|team of|staff of)\s*\d+[\+\-]?",
            r"\d+-\d+\s*(?:employees?|team members?)",
            r"(?:doubled|grew).*?(?:from|to)\s*\d+.*?employees?"
        ]
        for pattern in employee_patterns:
            match = re.search(pattern, content, re.IGNORECASE)
            if match:
                extracted["employee_count"] = match.group(0)
                break

        # Extract leadership names
        leadership_patterns = [
            r"CEO:?\s*([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)",
            r"Founder:?\s*([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)",
            r"(?:CTO|CFO|COO|CMO):?\s*([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)",
            r"([A-Z][a-z]+\s+[A-Z][a-z]+),\s*(?:CEO|Founder|CTO|CFO|COO|CMO)"
        ]
        seen_names = set()
        for pattern in leadership_patterns:
            matches = re.findall(pattern, content)
            for match in matches:
                name = match if isinstance(match, str) else match[0]
                if name and name not in seen_names:
                    extracted["leadership_names"].append(name)
                    seen_names.add(name)

        # Extract recent news (look for dates and milestones)
        # Focus on recent items within last 6 months
        six_months_ago = datetime.now() - timedelta(days=180)
        news_items = []

        # Look for sentences with dates and business keywords
        news_keywords = ["launched", "raised", "announced", "acquired", "partnership", "funding", "series", "round", "hired", "expanded"]
        for line in lines:
            line_lower = line.lower()
            # Check if line contains news keywords and looks like recent news
            if any(keyword in line_lower for keyword in news_keywords):
                # Extract meaningful news items (at least 30 chars)
                if len(line.strip()) > 30:
                    news_items.append(line.strip())

        extracted["recent_news"] = news_items[:5]  # Top 5 most recent

        # Extract funding/investments
        funding_patterns = [
            r"\$[\d,]+[mkb]?\s*(?:Series [A-E]|seed|funding)",
            r"raised \$[\d,]+[mkb]?",
            r"total funding of \$[\d,]+[mkb]?",
            r"\$[\d,]+[mkb]?\s*(?:valuation|investment)",
            r"(?:led by|investors include).*?(?:[A-Z][a-z]+\s+Capital|[A-Z][a-z]+\s+Ventures)"
        ]
        funding_parts = []
        for pattern in funding_patterns:
            matches = re.findall(pattern, content, re.IGNORECASE)
            for match in matches:
                if match and match not in funding_parts:
                    funding_parts.append(match)

        extracted["funding_investments"] = "; ".join(funding_parts[:3]) if funding_parts else ""

        if not extracted["funding_investments"] and ("bootstrap" in content_lower or "self-funded" in content_lower):
            extracted["funding_investments"] = "Bootstrapped / Self-funded"

        return extracted
    
    def _calculate_perplexity_confidence(self, content: str, citations: List[Dict]) -> float:
        """Calculate confidence score for Perplexity results"""
        score = 0.0

        # Base score for content length and quality
        if content:
            word_count = len(content.split())
            if word_count > 800:
                score += 0.6
            elif word_count > 400:
                score += 0.4
            elif word_count > 100:
                score += 0.2

        # Score for citations
        if len(citations) >= 5:
            score += 0.3
        elif len(citations) >= 2:
            score += 0.2
        elif len(citations) >= 1:
            score += 0.1

        # Bonus for comprehensive coverage (check for key business topics)
        business_keywords = [
            "business model", "revenue", "market", "competitive", "customers",
            "technology", "funding", "partnerships", "challenges", "opportunities"
        ]
        content_lower = content.lower() if content else ""
        keyword_coverage = sum(1 for keyword in business_keywords if keyword in content_lower)

        if keyword_coverage >= 7:
            score += 0.1
        elif keyword_coverage >= 5:
            score += 0.05

        return min(1.0, score)


@dataclass(frozen=True)
class CacheKey:
    provider: str
    identifier: Tuple[Any, ...]


class ClientRegistry:
    """Thread-safe registry for external provider clients."""

    _instance: Optional["ClientRegistry"] = None
    _instance_lock = threading.Lock()

    def __init__(self, max_cache_size: int = 100, ttl_seconds: int = 3600):
        self._max_cache_size = max_cache_size
        self._ttl_seconds = ttl_seconds
        self._cache: "OrderedDict[CacheKey, Any]" = OrderedDict()
        self._timestamps: Dict[CacheKey, float] = {}
        self._lock = threading.Lock()
        self._logger = setup_logger(__name__)

    @classmethod
    def get_instance(cls) -> "ClientRegistry":
        with cls._instance_lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()
            self._timestamps.clear()

    def clear_stale(self, max_age_seconds: Optional[int] = None) -> None:
        ttl = max_age_seconds or self._ttl_seconds
        cutoff = time.time() - ttl
        with self._lock:
            stale_keys = [key for key, ts in self._timestamps.items() if ts < cutoff]
            for key in stale_keys:
                self._cache.pop(key, None)
                self._timestamps.pop(key, None)

    def invalidate(self, provider: str, api_key: Optional[str]) -> None:
        identifier = self._build_identifier(api_key)
        cache_key = CacheKey(provider, identifier)
        with self._lock:
            self._cache.pop(cache_key, None)
            self._timestamps.pop(cache_key, None)

    def get_openai_client(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        require_user_key: bool = False,
        **kwargs: Any,
    ) -> ChatOpenAI:
        settings = get_settings()
        provided_key = (api_key or "").strip() if api_key else None
        if require_user_key:
            if not provided_key:
                raise ValueError("BYOK request missing OpenAI API key")
            resolved_key = provided_key
        else:
            resolved_key = provided_key or settings.openai_api_key or os.getenv("OPENAI_API_KEY")
            if resolved_key:
                resolved_key = resolved_key.strip()
        if not resolved_key:
            raise ValueError("OpenAI API key is required to create a client")

        model_name = model or settings.default_model
        identifier = self._build_identifier(resolved_key, model_name, tuple(sorted(kwargs.items())))
        cache_key = CacheKey("openai", identifier)

        def factory() -> ChatOpenAI:
            client_kwargs = {
                "model": model_name,
                "openai_api_key": resolved_key,
            }
            client_kwargs.update(kwargs)
            return ChatOpenAI(**client_kwargs)

        return self._get_or_create(cache_key, factory)

    def get_tavily_client(
        self,
        api_key: Optional[str] = None,
        require_user_key: bool = False,
    ) -> TavilyClient:
        provided_key = (api_key or "").strip() if api_key else None
        if require_user_key:
            if not provided_key:
                raise ValueError("BYOK request missing Tavily API key")
            resolved_key = provided_key
        else:
            resolved_key = provided_key or getattr(get_settings(), "tavily_api_key", None)
        identifier = self._build_identifier(resolved_key)
        cache_key = CacheKey("tavily", identifier)

        def factory() -> TavilyClient:
            return TavilyClient(api_key=resolved_key)

        return self._get_or_create(cache_key, factory)

    def get_perplexity_client(
        self,
        api_key: Optional[str] = None,
        require_user_key: bool = False,
    ) -> PerplexityClient:
        provided_key = (api_key or "").strip() if api_key else None
        if require_user_key:
            if not provided_key:
                raise ValueError("BYOK request missing Perplexity API key")
            resolved_key = provided_key
        else:
            resolved_key = provided_key or getattr(get_settings(), "perplexity_api_key", None)
        identifier = self._build_identifier(resolved_key)
        cache_key = CacheKey("perplexity", identifier)

        def factory() -> PerplexityClient:
            return PerplexityClient(api_key=resolved_key)

        return self._get_or_create(cache_key, factory)

    def get_google_places_client(
        self,
        api_key: Optional[str] = None,
        require_user_key: bool = False,
    ) -> googlemaps.Client:
        provided_key = (api_key or "").strip() if api_key else None
        if require_user_key:
            if not provided_key:
                raise ValueError("BYOK request missing Google Places API key")
            resolved_key = provided_key
        else:
            resolved_key = provided_key or os.getenv("GOOGLE_PLACES_API_KEY")
            if resolved_key:
                resolved_key = resolved_key.strip()
        if not resolved_key:
            raise ValueError("Google Places API key is required")

        identifier = self._build_identifier(resolved_key)
        cache_key = CacheKey("google_places", identifier)

        def factory() -> googlemaps.Client:
            return googlemaps.Client(key=resolved_key)

        return self._get_or_create(cache_key, factory)

    def _get_or_create(self, cache_key: CacheKey, factory: Callable[[], Any]):
        now = time.time()
        with self._lock:
            if cache_key in self._cache:
                self._cache.move_to_end(cache_key)
                self._timestamps[cache_key] = now
                return self._cache[cache_key]

        client = factory()
        with self._lock:
            self._evict_if_needed()
            self._cache[cache_key] = client
            self._timestamps[cache_key] = now
        return client

    def _evict_if_needed(self) -> None:
        while len(self._cache) >= self._max_cache_size:
            key, _ = self._cache.popitem(last=False)
            self._timestamps.pop(key, None)

    def _build_identifier(self, api_key: Optional[str], *extra: Any) -> Tuple[Any, ...]:
        if api_key:
            key_hash = hashlib.sha256(api_key.encode("utf-8")).hexdigest()
        else:
            key_hash = "system"
        return (key_hash, *extra)


class ResearchOrchestrator:
    """
    Orchestrates the three-tier research system with intelligent escalation.
        Tavily (fast baseline research) → Perplexity (comprehensive analysis)
    """

    def __init__(self, client_registry: Optional[ClientRegistry] = None):
        self.client_registry = client_registry or ClientRegistry.get_instance()
        self.data_validator = BaseDataValidator()

        # Configuration thresholds - use environment variables
        from ..config import DEEP_RESEARCH_CONFIG
        self.deep_research_confidence_threshold = DEEP_RESEARCH_CONFIG['CONFIDENCE_THRESHOLD']
        
    async def research_company(self,
                             company_name: str,
                             domain: str = "",
                             location: str = "",
                             user_tier: str = "free",
                             lead_value: float = 0.0,
                             force_tier: Optional[ResearchTier] = None,
                             provider_keys: Optional[Dict[str, str]] = None,
                             user_id: Optional[str] = None) -> ResearchResult:
        """
        Orchestrate 2-tier research with intelligent escalation.
        Tavily (basic research) → Perplexity (deep research when needed)

        Args:
            company_name: Company to research
            domain: Company website domain
            location: Company physical location/address for context
            user_tier: User subscription tier (free, pro, enterprise)
            lead_value: Estimated lead value for premium research decisions
            force_tier: Force specific research tier (for testing)
            provider_keys: Optional BYOK provider credentials
            user_id: Optional distinct identifier for analytics

        Returns:
            Final research result with all relevant data
        """
        logger.info(f"Starting 2-tier research for {company_name}")

        user_supplied_keys = provider_keys is not None
        provider_keys = provider_keys or {}
        using_user_keys = user_supplied_keys
        provider_key_labels = sorted(provider_keys.keys()) if using_user_keys else []
        analytics_id = user_id or "research_pipeline"
        pipeline_start = time.time()
        tavily_duration_ms = 0.0
        tavily_error: Optional[str] = None
        tavily_confidence = 0.0
        tavily_data_points = 0
        tavily_sources = 0
        perplexity_invoked = False
        perplexity_duration_ms = 0.0
        perplexity_error: Optional[str] = None
        perplexity_confidence = 0.0
        perplexity_data_points = 0
        perplexity_sources = 0

        def _emit_summary(final_result: ResearchResult,
                          validation_score: Optional[float] = None,
                          missing_data_points: Optional[List[str]] = None) -> None:
            capture_event(
                "research_pipeline_completed",
                {
                    "company_name": company_name,
                    "domain": domain,
                    "user_tier": user_tier,
                    "lead_value": lead_value,
                    "force_tier": force_tier.value if force_tier else None,
                    "using_user_keys": using_user_keys,
                    "provider_keys_supplied": provider_key_labels,
                    "final_tier": final_result.tier.value,
                    "final_confidence": final_result.confidence_score,
                    "final_data_points": final_result.data_points,
                    "final_sources_analyzed": final_result.sources_analyzed,
                    "final_error": final_result.error,
                    "deep_research_used": final_result.tier == ResearchTier.PERPLEXITY,
                    "deep_research_reason": final_result.escalation_reason,
                    "validation_score": validation_score,
                    "missing_data_points": missing_data_points or [],
                    "tavily_duration_ms": tavily_duration_ms,
                    "tavily_success": tavily_error is None,
                    "tavily_error": tavily_error,
                    "tavily_confidence": tavily_confidence,
                    "tavily_data_points": tavily_data_points,
                    "tavily_sources": tavily_sources,
                    "perplexity_invoked": perplexity_invoked,
                    "perplexity_success": perplexity_invoked and perplexity_error is None,
                    "perplexity_error": perplexity_error,
                    "perplexity_confidence": perplexity_confidence,
                    "perplexity_data_points": perplexity_data_points,
                    "perplexity_sources": perplexity_sources,
                    "perplexity_duration_ms": perplexity_duration_ms,
                    "total_duration_ms": (time.time() - pipeline_start) * 1000,
                },
                distinct_id=analytics_id,
            )

        capture_event(
            "research_pipeline_started",
            {
                "company_name": company_name,
                "domain": domain,
                "user_tier": user_tier,
                "lead_value": lead_value,
                "force_tier": force_tier.value if force_tier else None,
                "using_user_keys": using_user_keys,
                "provider_keys_supplied": provider_key_labels,
            },
            distinct_id=analytics_id,
        )

        # Tier 1: SKIPPED - Going straight to Perplexity Sonar Pro
        # Tavily is disabled to optimize for quality and cost-effectiveness
        logger.info(f"Skipping Tavily tier 1, using Perplexity Sonar Pro directly for {company_name}")

        # Create empty tier1_result for backwards compatibility with analytics
        tier1_result = ResearchResult(
            query=company_name,
            tier=ResearchTier.TAVILY,
            confidence_score=0.0,
            data_points=0,
            sources_analyzed=0,
            error="Skipped - using Perplexity Sonar Pro directly"
        )
        tavily_duration_ms = 0.0
        tavily_error = "Skipped"
        tavily_confidence = 0.0
        tavily_data_points = 0
        tavily_sources = 0

        # Tier 2: Sonar Pro (PRIMARY research tier - runs for ALL leads)
        logger.info(f"Running Sonar Pro research for {company_name}")
        perplexity_client = self.client_registry.get_perplexity_client(
            api_key=provider_keys.get("perplexity") if using_user_keys else None,
            require_user_key=using_user_keys,
        )
        tier2_start = time.time()
        capture_event(
            "research_tier_invoked",
            {
                "tier": "sonar_pro",
                "company_name": company_name,
                "using_user_keys": using_user_keys,
                "provider_keys_supplied": provider_key_labels,
            },
            distinct_id=analytics_id,
        )
        sonar_pro_result = await perplexity_client.comprehensive_research(
            company_name,
            domain,
            location,
            "",  # No previous context since we skipped Tavily
        )
        sonar_pro_duration_ms = (time.time() - tier2_start) * 1000
        sonar_pro_result.final_tier_used = "pro"  # Mark as Sonar Pro tier
        perplexity_invoked = True
        perplexity_duration_ms = sonar_pro_duration_ms
        perplexity_error = sonar_pro_result.error
        perplexity_confidence = sonar_pro_result.confidence_score
        perplexity_data_points = sonar_pro_result.data_points
        perplexity_sources = sonar_pro_result.sources_analyzed

        capture_event(
            "research_tier_completed",
            {
                "tier": "sonar_pro",
                "company_name": company_name,
                "success": sonar_pro_result.error is None,
                "error": sonar_pro_result.error,
                "confidence_score": sonar_pro_result.confidence_score,
                "data_points": sonar_pro_result.data_points,
                "sources_analyzed": sonar_pro_result.sources_analyzed,
                "duration_ms": sonar_pro_duration_ms,
            },
            distinct_id=analytics_id,
        )

        # Merge Tavily and Sonar Pro results
        tier2_result = self._merge_research_results(tier1_result, sonar_pro_result)
        tier2_result.final_tier_used = "pro"

        # Validate Sonar Pro result quality
        sonar_validation_result = self.data_validator.validate_research_result(tier2_result)
        logger.info(
            f"Sonar Pro validation: {len(sonar_validation_result.data_point_scores) - len(sonar_validation_result.missing_data_points)}/5 data points, score: {sonar_validation_result.validation_score:.2f}"
        )

        # Check if we need Deep Research based on Sonar Pro results
        # Only escalates on: low confidence OR missing data points
        should_escalate, validation_reason = self.data_validator.should_trigger_deep_research(
            validation_result=sonar_validation_result,
            confidence_score=tier2_result.confidence_score,
        )

        if force_tier == ResearchTier.PERPLEXITY:
            should_escalate = True
            validation_reason = "Forced deep research for testing"

        if not should_escalate:
            logger.info(
                f"Sonar Pro research sufficient for {company_name} (confidence: {tier2_result.confidence_score:.2f})"
            )
            _emit_summary(
                tier2_result,
                validation_score=sonar_validation_result.validation_score,
                missing_data_points=sonar_validation_result.missing_data_points,
            )
            return tier2_result

        # Tier 3: Deep Research (conditional - only when Sonar Pro insufficient)
        escalation_reason = validation_reason or f"Sonar Pro confidence {tier2_result.confidence_score:.2f}"
        logger.info(
            f"Escalating to Deep Research for {company_name}: {escalation_reason}"
        )

        tier3_start = time.time()
        capture_event(
            "research_tier_invoked",
            {
                "tier": "deep_research",
                "company_name": company_name,
                "reason": escalation_reason,
                "using_user_keys": using_user_keys,
                "provider_keys_supplied": provider_key_labels,
            },
            distinct_id=analytics_id,
        )

        # Use deep_research method with sonar-deep-research model for exhaustive analysis
        deep_research_result = await perplexity_client.deep_research(
            company_name,
            domain,
            location,
            tier2_result.company_overview,
        )
        deep_research_duration_ms = (time.time() - tier3_start) * 1000
        deep_research_result.final_tier_used = "deep"  # Mark as Deep Research tier

        # Update perplexity metrics to include deep research
        perplexity_duration_ms += deep_research_duration_ms
        perplexity_error = deep_research_result.error
        perplexity_confidence = deep_research_result.confidence_score
        perplexity_data_points = deep_research_result.data_points
        perplexity_sources = deep_research_result.sources_analyzed

        capture_event(
            "research_tier_completed",
            {
                "tier": "deep_research",
                "company_name": company_name,
                "success": deep_research_result.error is None,
                "error": deep_research_result.error,
                "confidence_score": deep_research_result.confidence_score,
                "data_points": deep_research_result.data_points,
                "sources_analyzed": deep_research_result.sources_analyzed,
                "duration_ms": deep_research_duration_ms,
            },
            distinct_id=analytics_id,
        )

        # GRACEFUL DEGRADATION: If deep research failed (rate limited, timeout, etc.),
        # fall back to Sonar Pro results instead of failing the lead
        if deep_research_result.error and deep_research_result.final_tier_used == "deep_failed":
            logger.warning(
                f"Deep research failed for {company_name}, using Sonar Pro results as fallback. "
                f"Reason: {deep_research_result.error}"
            )
            capture_event(
                "deep_research_graceful_degradation",
                {
                    "company_name": company_name,
                    "deep_research_error": deep_research_result.error,
                    "fallback_tier": "sonar_pro",
                    "sonar_pro_confidence": tier2_result.confidence_score,
                    "sonar_pro_data_points": tier2_result.data_points,
                },
                distinct_id=analytics_id,
            )

            # Use Sonar Pro results as final result
            final_result = tier2_result.copy()
            final_result.escalation_reason = f"Deep research failed ({deep_research_result.error}), using Sonar Pro results"
            final_result.final_tier_used = "pro_fallback"  # Indicate graceful degradation occurred

            _emit_summary(
                final_result,
                validation_score=sonar_validation_result.validation_score,
                missing_data_points=sonar_validation_result.missing_data_points,
            )
            return final_result

        # Normal path: merge Sonar Pro and Deep Research results
        final_result = self._merge_research_results(tier2_result, deep_research_result)
        final_result.escalation_reason = escalation_reason
        final_result.final_tier_used = "deep"  # Final tier is deep

        _emit_summary(
            final_result,
            validation_score=sonar_validation_result.validation_score,
            missing_data_points=sonar_validation_result.missing_data_points,
        )
        return final_result
    
    def _determine_escalation_reason(self, tier1_result: ResearchResult, lead_value: float) -> str:
        """Determine the reason for escalating to deep research"""
        reasons = []
        
        if tier1_result.confidence_score < self.deep_research_confidence_threshold:
            reasons.append(f"Low confidence ({tier1_result.confidence_score:.2f})")
        
        if tier1_result.data_points < 3:
            reasons.append(f"Sparse data ({tier1_result.data_points} points)")

        if tier1_result.error:
            reasons.append("Basic research failed")

        return "; ".join(reasons) if reasons else "Premium research requested"
    
    def _merge_research_results(self, base_result: ResearchResult, additional_result: ResearchResult) -> ResearchResult:
        """Merge research results from different tiers"""
        # Use the highest tier as the base
        merged = base_result.copy()
        merged.tier = additional_result.tier
        
        # Merge content fields
        if additional_result.company_overview:
            if merged.company_overview:
                merged.company_overview += " " + additional_result.company_overview
            else:
                merged.company_overview = additional_result.company_overview
                
        merged.services_products.extend(additional_result.services_products)
        merged.services_products = list(set(merged.services_products))[:10]  # Deduplicate and limit
        
        if additional_result.industry_insights:
            merged.industry_insights = additional_result.industry_insights
            
        merged.competitors.extend(additional_result.competitors)
        merged.competitors = merged.competitors[:10]  # Limit competitors
        
        # Merge metadata
        merged.data_points += additional_result.data_points
        merged.sources_analyzed += additional_result.sources_analyzed
        merged.response_time += additional_result.response_time
        
        # Use the highest confidence score
        merged.confidence_score = max(merged.confidence_score, additional_result.confidence_score)
        
        # Merge raw data
        merged.raw_data.update(additional_result.raw_data)
        
        # Set escalation reason if this was an escalation
        if additional_result.tier != base_result.tier:
            if base_result.confidence_score < 0.6:
                merged.escalation_reason = f"Low confidence ({base_result.confidence_score:.2f})"
            elif base_result.data_points < 3:
                merged.escalation_reason = f"Sparse data ({base_result.data_points} points)"
            else:
                merged.escalation_reason = "Premium research requested"
        
        return merged
