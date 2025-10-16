"""
Research API clients for tiered business context research system.
Supports three tiers: Tavily (fast), Exa (semantic), Perplexity (comprehensive).
"""

import asyncio
import time
from typing import Dict, Any, List, Optional, Literal
from enum import Enum
import aiohttp
from pydantic import BaseModel, Field
from ..utils.config import get_settings
from ..utils.logger import setup_logger
from ..utils.tavily_tool import TavilySearchTool, TavilySearchResult
from ..utils.data_validation import BaseDataValidator, DataValidationResult

logger = setup_logger(__name__)
settings = get_settings()

class ResearchTier(str, Enum):
    TAVILY = "tavily"
    EXA = "exa"
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
    
    # Metadata
    raw_data: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None
    escalation_reason: Optional[str] = None

class TavilyClient:
    """
    Tier 1 research client using Tavily via LangChain integration for fast basic business context.
    Target: 2-3 seconds response time, basic business information.
    """
    
    def __init__(self):
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
        
        self.tavily_tool = TavilySearchTool(**tavily_config)
        self.timeout = tavily_config['timeout']
        
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
        
        # OPTIMIZATION: Construct focused query with domain prioritization (Tavily best practice)
        # Keep query under 400 chars, use site: operator for domain focus
        query = f"{company_name} company overview business model products services"
        if domain:
            query += f" site:{domain}"  # Prioritize company website

        # OPTIMIZATION: Target business-focused domains for better research quality
        business_domains = []
        if domain:
            business_domains.append(domain)  # Company's own website
        business_domains.extend([
            "linkedin.com/company",  # Company LinkedIn profiles
            "crunchbase.com",        # Startup/funding info
        ])

        try:
            # CRITICAL: Use advanced search depth for query-relevant content chunks
            # Advanced search provides content closely aligned with query vs generic summaries
            tavily_result: TavilySearchResult = await self.tavily_tool.search_async(
                query=query,
                search_depth="advanced",  # Changed from "basic" for 2x better quality
                include_domains=business_domains,  # Focus on business sources
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

        # Extract services/products with enhanced metadata filtering
        services = []
        overview_parts = []

        # Add answer if available (high-quality summary from Tavily)
        if tavily_result.answer:
            overview_parts.append(tavily_result.answer)

        # Process content snippets with metadata-aware extraction
        for i, result in enumerate(results_to_process):
            content = result.get('content', '')
            title = result.get('title', '')
            score = result.get('score', 0.0)
            raw_content = result.get('raw_content', '')

            if not content:
                continue

            # OPTIMIZATION: Use title for keyword filtering (Tavily best practice)
            # Titles often indicate relevance better than content body
            is_business_relevant = any(
                keyword in title.lower()
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


class ExaClient:
    """
    Tier 2 research client using Exa for semantic search and competitor analysis.
    Target: 3-4 seconds response time, focused on competitive landscape and industry insights.
    """

    def __init__(self):
        self.api_key = getattr(settings, 'exa_api_key', None)
        self.base_url = "https://api.exa.ai"
        self.timeout = 12.0

        if not self.api_key:
            logger.warning("Exa API key not configured")

    async def deep_search(self,
                          company_name: str,
                          domain: str = "",
                          previous_context: str = "") -> ResearchResult:
        """
        Perform semantic research using Exa to identify competitors and industry signals.

        Args:
            company_name: Company to research
            domain: Company website domain
            previous_context: Context from earlier tiers

        Returns:
            ResearchResult enriched with competitor and industry insight data
        """
        start_time = time.time()

        if not self.api_key:
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.EXA,
                confidence_score=0.0,
                error="Exa API key not configured",
            )

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        competitor_payload = {
            "query": company_name,
            "type": "semantic",
            "size": 5,
        }
        if domain:
            competitor_payload["domain"] = domain

        insights_payload = {
            "query": f"{company_name} industry analysis market trends",
            "type": "research",
            "size": 5,
        }
        if previous_context:
            insights_payload["context"] = previous_context[:500]

        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=self.timeout)) as session:
                competitor_data = await self._post_json(
                    session,
                    f"{self.base_url}/findSimilar",
                    competitor_payload,
                    headers,
                )
                insights_data = await self._post_json(
                    session,
                    f"{self.base_url}/search",
                    insights_payload,
                    headers,
                )
        except asyncio.TimeoutError as exc:
            logger.error(f"Exa timeout for {company_name}: {exc}")
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.EXA,
                confidence_score=0.1,
                response_time=time.time() - start_time,
                error="Exa request timed out",
            )
        except aiohttp.ClientError as exc:
            logger.error(f"Exa client error for {company_name}: {exc}")
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.EXA,
                confidence_score=0.1,
                response_time=time.time() - start_time,
                error=f"Exa client error: {exc}",
            )
        except Exception as exc:
            logger.exception(f"Unexpected Exa error for {company_name}")
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.EXA,
                confidence_score=0.1,
                response_time=time.time() - start_time,
                error=f"Unexpected Exa error: {exc}",
            )

        competitors = self._extract_competitors(competitor_data.get("results", []))
        industry_insights = self._extract_industry_insights(insights_data.get("results", []))

        response_time = time.time() - start_time
        confidence = self._calculate_confidence(competitors, industry_insights)
        sources_analyzed = len(competitors) + len(insights_data.get("results", []))
        data_points = len(competitors) + (1 if industry_insights else 0)

        return ResearchResult(
            query=company_name,
            tier=ResearchTier.EXA,
            confidence_score=confidence,
            data_points=data_points,
            sources_analyzed=sources_analyzed,
            response_time=response_time,
            industry_insights=industry_insights,
            competitors=competitors,
            raw_data={
                "competitors": competitor_data,
                "insights": insights_data,
            },
        )

    async def _post_json(self,
                         session: aiohttp.ClientSession,
                         url: str,
                         payload: Dict[str, Any],
                         headers: Dict[str, str]) -> Dict[str, Any]:
        """Helper to POST JSON data to Exa APIs with error handling."""
        async with session.post(url, json=payload, headers=headers) as response:
            if response.status >= 400:
                text = await response.text()
                raise RuntimeError(f"Exa API error {response.status}: {text}")
            return await response.json()

    def _extract_competitors(self, results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        competitors: List[Dict[str, Any]] = []

        for result in results:
            title = result.get("title") or ""
            name = title.split(" - ")[0] if title else (result.get("url") or "Unknown competitor")
            competitors.append({
                "name": name,
                "url": result.get("url"),
                "description": result.get("text", ""),
                "relevance_score": float(result.get("score", 0.0) or 0.0),
            })

        return competitors

    def _extract_industry_insights(self, results: List[Dict[str, Any]]) -> str:
        insights = [r.get("text", "") for r in results if r.get("text")]
        return " ".join(insights).strip()

    def _calculate_confidence(self, competitors: List[Dict[str, Any]], insights: str) -> float:
        score = 0.0

        if competitors:
            score += 0.4
            avg_relevance = sum(c.get("relevance_score", 0.0) for c in competitors) / len(competitors)
            score += min(0.3, avg_relevance * 0.3)

        if insights:
            score += 0.2
            if len(insights.split()) > 40:
                score += 0.1

        return min(1.0, score)


class PerplexityClient:
    """
    Tier 3 research client using Perplexity for comprehensive business reports.
    Target: 10-15 seconds response time, comprehensive analysis with citations.
    """
    
    def __init__(self):
        self.api_key = getattr(settings, 'perplexity_api_key', None)
        self.base_url = "https://api.perplexity.ai"
        self.timeout = 20.0  # Longer timeout for comprehensive analysis
        
        if not self.api_key:
            logger.warning("Perplexity API key not configured")
    
    async def comprehensive_research(self, 
                                   company_name: str,
                                   domain: str = "",
                                   previous_context: str = "") -> ResearchResult:
        """
        Generate comprehensive business research report using Perplexity.
        
        Args:
            company_name: Name of the company to research
            domain: Company domain/website
            previous_context: Context from previous research tiers
            
        Returns:
            ResearchResult with comprehensive business intelligence
        """
        start_time = time.time()
        
        if not self.api_key:
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.PERPLEXITY,
                confidence_score=0.0,
                error="Perplexity API key not configured"
            )
        
        try:
            # Construct comprehensive research query
            query = self._build_comprehensive_query(company_name, domain, previous_context)
            
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=self.timeout)) as session:
                payload = {
                    "model": "llama-3.1-sonar-large-128k-online",
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
                
                async with session.post(
                    f"{self.base_url}/chat/completions",
                    json=payload,
                    headers=headers
                ) as response:
                    
                    if response.status != 200:
                        error_text = await response.text()
                        raise Exception(f"Perplexity API error {response.status}: {error_text}")
                    
                    data = await response.json()
                    response_time = time.time() - start_time
                    
                    return self._process_perplexity_response(
                        company_name, data, response_time
                    )
                    
        except asyncio.TimeoutError:
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.PERPLEXITY,
                confidence_score=0.2,
                response_time=time.time() - start_time,
                error="Perplexity research timeout"
            )
        except Exception as e:
            logger.error(f"Perplexity research error for {company_name}: {str(e)}")
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.PERPLEXITY,
                confidence_score=0.2,
                response_time=time.time() - start_time,
                error=f"Perplexity error: {str(e)}"
            )
    
    def _build_comprehensive_query(self, company_name: str, domain: str, context: str) -> str:
        """Build comprehensive research query for Perplexity"""
        query_parts = [
            f"Provide a comprehensive business intelligence report for {company_name}",
        ]
        
        if domain:
            query_parts.append(f"(website: {domain})")
            
        query_parts.extend([
            "Include the following analysis:",
            "1. Business model and revenue streams",
            "2. Market position and competitive landscape", 
            "3. Recent news, developments, and growth initiatives",
            "4. Target customers and market segments",
            "5. Technology stack and innovation focus",
            "6. Financial performance and funding history",
            "7. Key partnerships and strategic alliances",
            "8. Potential business challenges and opportunities"
        ])
        
        if context:
            query_parts.append(f"Additional context: {context[:300]}")
            
        query_parts.extend([
            "Provide specific, factual information with citations.",
            "Focus on actionable business intelligence for sales and marketing."
        ])
        
        return " ".join(query_parts)
    
    def _process_perplexity_response(self, company_name: str, data: Dict[str, Any], response_time: float) -> ResearchResult:
        """Process Perplexity API response into standardized format"""
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
        
        # Calculate confidence based on content quality and citations
        confidence = self._calculate_perplexity_confidence(content, citations)
        
        return ResearchResult(
            query=company_name,
            tier=ResearchTier.PERPLEXITY,
            confidence_score=confidence,
            data_points=len(content.split(".")) if content else 0,  # Rough data point count
            sources_analyzed=len(citations),
            response_time=response_time,
            company_overview=content,
            raw_data={
                "comprehensive_report": content,
                "citations": citations,
                "word_count": len(content.split()) if content else 0
            }
        )
    
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

class ResearchOrchestrator:
    """
    Orchestrates the three-tier research system with intelligent escalation.
    Tavily (fast basic research) → Exa (semantic deepening) → Perplexity (comprehensive analysis)
    """

    def __init__(self):
        self.tavily = TavilyClient()
        self.exa = ExaClient()
        self.perplexity = PerplexityClient()
        self.data_validator = BaseDataValidator()
        
        # Configuration thresholds - use environment variables
        from ..config import DEEP_RESEARCH_CONFIG
        self.deep_research_confidence_threshold = DEEP_RESEARCH_CONFIG['CONFIDENCE_THRESHOLD']
        self.premium_lead_value_threshold = DEEP_RESEARCH_CONFIG['HIGH_VALUE_THRESHOLD']
        
    async def research_company(self,
                             company_name: str,
                             domain: str = "",
                             user_tier: str = "free",
                             lead_value: float = 0.0,
                             force_tier: Optional[ResearchTier] = None) -> ResearchResult:
        """
        Orchestrate 3-tier research with intelligent escalation.
        Tavily (basic research) → Exa (semantic research) → Perplexity (deep research when needed)

        Args:
            company_name: Company to research
            domain: Company website domain
            user_tier: User subscription tier (free, pro, enterprise)
            lead_value: Estimated lead value for premium research decisions
            force_tier: Force specific research tier (for testing)

        Returns:
            Final research result with all relevant data
        """
        logger.info(f"Starting 3-tier research for {company_name}")

        # TIER 1: Always start with Tavily (fast basic research)
        tier1_result = await self.tavily.search(company_name, domain)

        if force_tier == ResearchTier.TAVILY:
            return tier1_result

        if tier1_result.error:
            logger.warning(f"Tier 1 failed for {company_name}: {tier1_result.error}")

        # Validate data completeness of Tavily results
        validation_result = self.data_validator.validate_research_result(tier1_result)
        logger.info(
            f"Data validation: {len(validation_result.data_point_scores) - len(validation_result.missing_data_points)}/5 data points present, score: {validation_result.validation_score:.2f}"
        )

        # CRITICAL FIX: Adjust confidence based on data validation
        # This ensures low data quality triggers escalation even when Tavily returns many results
        # Example: 5 Tavily results (base=1.0) + 2/5 data points (validation=0.40) → adjusted=0.40
        base_confidence_value = tier1_result.confidence_score
        adjusted_confidence = base_confidence_value * validation_result.validation_score
        tier1_result.confidence_score = adjusted_confidence
        logger.info(
            f"Confidence adjusted: base={base_confidence_value:.2f} → adjusted={adjusted_confidence:.2f} based on data validation"
        )

        # Determine if we should escalate beyond Tavily
        should_escalate, validation_reason = self.data_validator.should_trigger_deep_research(
            validation_result=validation_result,
            user_tier=user_tier,
            confidence_score=adjusted_confidence,  # Use adjusted confidence
            lead_value=lead_value,
        )

        if force_tier == ResearchTier.EXA:
            should_escalate = True
            validation_reason = "Forced semantic research for testing"
        elif force_tier == ResearchTier.PERPLEXITY:
            should_escalate = True
            validation_reason = "Forced deep research for testing"

        if not should_escalate:
            logger.info(
                f"Basic research sufficient for {company_name} (confidence: {tier1_result.confidence_score:.2f})"
            )
            return tier1_result

        # TIER 2: Exa semantic search for competitor and industry insights
        logger.info(
            f"Escalating to semantic research for {company_name}: {validation_reason}"
        )
        tier2_result = await self.exa.deep_search(
            company_name,
            domain,
            tier1_result.company_overview,
        )

        combined_result = self._merge_research_results(tier1_result, tier2_result)
        combined_result.escalation_reason = validation_reason

        if force_tier == ResearchTier.EXA:
            return combined_result

        # Determine if we need to escalate again to Perplexity
        escalate_to_tier3 = False
        tier3_reason: Optional[str] = None

        if tier2_result.error:
            escalate_to_tier3 = True
            tier3_reason = f"Tier 2 error: {tier2_result.error}"
        else:
            tier2_validation = self.data_validator.validate_research_result(
                combined_result
            )
            logger.info(
                f"Post-Exa validation score: {tier2_validation.validation_score:.2f}"
            )
            escalate_to_tier3, tier3_reason = self.data_validator.should_trigger_deep_research(
                validation_result=tier2_validation,
                user_tier=user_tier,
                confidence_score=combined_result.confidence_score,
                lead_value=lead_value,
            )

        if force_tier == ResearchTier.PERPLEXITY:
            escalate_to_tier3 = True
            tier3_reason = "Forced deep research for testing"

        if not escalate_to_tier3:
            logger.info(
                f"Semantic research sufficient for {company_name} (confidence: {combined_result.confidence_score:.2f})"
            )
            return combined_result

        # TIER 3: Escalate to Perplexity for comprehensive analysis
        escalation_reason = tier3_reason or validation_reason
        logger.info(
            f"Escalating to deep research for {company_name}: {escalation_reason}"
        )

        deep_research_result = await self.perplexity.comprehensive_research(
            company_name,
            domain,
            combined_result.company_overview,
        )

        final_result = self._merge_research_results(combined_result, deep_research_result)
        final_result.escalation_reason = escalation_reason

        logger.info(
            f"Completed deep research for {company_name} - Final confidence: {final_result.confidence_score:.2f}"
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
            
        if lead_value >= self.premium_lead_value_threshold:
            reasons.append(f"High-value lead (${lead_value:,.0f})")
            
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
