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
        # Initialize with Tavily-specific configuration from settings
        tavily_config = {
            'max_results': getattr(settings, 'tavily_max_results', 5),
            'topic': getattr(settings, 'tavily_topic', 'general'),
            'include_answer': getattr(settings, 'tavily_include_answer', True),
            'include_raw_content': getattr(settings, 'tavily_include_raw_content', False),
            'search_depth': getattr(settings, 'tavily_search_depth', 'basic'),
            'timeout': getattr(settings, 'tavily_timeout', 5.0)
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
        
        # Construct search query
        query = f"{company_name} business overview services products"
        if domain:
            query += f" {domain}"
            
        try:
            # Use the LangChain Tavily tool for search
            tavily_result: TavilySearchResult = await self.tavily_tool.search_async(
                query=query,
                search_depth="basic"
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
        """Convert TavilySearchResult to ResearchResult format for compatibility"""
        
        if tavily_result.error:
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.TAVILY,
                confidence_score=0.1,
                response_time=tavily_result.response_time,
                error=tavily_result.error
            )
        
        # Extract services/products from results
        services = []
        overview_parts = []
        
        # Add answer if available
        if tavily_result.answer:
            overview_parts.append(tavily_result.answer)
        
        # Process content snippets
        for i, content in enumerate(tavily_result.content_snippets):
            if content:
                overview_parts.append(content[:200])  # Limit content length
                
                # Extract potential services/products (basic keyword matching)
                service_keywords = ["service", "product", "solution", "offering", "software", "platform"]
                if any(keyword in content.lower() for keyword in service_keywords):
                    # Use title if available, otherwise extract from content
                    if i < len(tavily_result.titles) and tavily_result.titles[i]:
                        services.append(tavily_result.titles[i])
                    else:
                        # Extract first sentence as service name
                        sentences = content.split('.')
                        if sentences:
                            services.append(sentences[0][:50])
        
        company_overview = " ".join(overview_parts)[:800]  # Limit overview length
        
        # Calculate confidence based on data quality
        confidence = self._calculate_tavily_confidence(
            tavily_result.results, 
            tavily_result.answer or ""
        )
        
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
        """Calculate confidence score for Tavily results"""
        score = 0.0
        
        # Base score from number of results
        if len(results) >= 3:
            score += 0.4
        elif len(results) >= 1:
            score += 0.2
            
        # Bonus for having an answer
        if answer and len(answer) > 100:
            score += 0.3
        elif answer:
            score += 0.1
            
        # Bonus for content quality
        total_content_length = sum(len(r.get("content", "")) for r in results)
        if total_content_length > 1000:
            score += 0.3
        elif total_content_length > 300:
            score += 0.15
            
        return min(1.0, score)

class ExaClient:
    """
    Tier 2 research client using Exa for semantic search and competitor analysis.
    Target: 3-4 seconds response time, competitor and industry insights.
    """
    
    def __init__(self):
        self.api_key = getattr(settings, 'exa_api_key', None)
        self.base_url = "https://api.exa.ai/v1"
        self.timeout = 8.0  # Moderate timeout for Tier 2
        
        if not self.api_key:
            logger.warning("Exa API key not configured")
    
    async def deep_search(self, 
                         company_name: str, 
                         domain: str = "",
                         tavily_context: str = "") -> ResearchResult:
        """
        Perform deep semantic search with competitor discovery.
        
        Args:
            company_name: Name of the company to research
            domain: Company domain/website  
            tavily_context: Context from Tier 1 search
            
        Returns:
            ResearchResult with competitor and industry insights
        """
        start_time = time.time()
        
        if not self.api_key:
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.EXA,
                confidence_score=0.0,
                error="Exa API key not configured"
            )
        
        try:
            # First search for competitors
            competitors = await self._search_competitors(company_name, domain)
            
            # Then search for industry insights
            industry_insights = await self._search_industry_insights(company_name, tavily_context)
            
            response_time = time.time() - start_time
            
            # Calculate confidence based on findings
            confidence = self._calculate_exa_confidence(competitors, industry_insights)
            
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.EXA,
                confidence_score=confidence,
                data_points=len(competitors) + (1 if industry_insights else 0),
                sources_analyzed=len(competitors) + 1,
                response_time=response_time,
                competitors=competitors,
                industry_insights=industry_insights,
                raw_data={
                    "competitors_found": len(competitors),
                    "has_industry_insights": bool(industry_insights)
                }
            )
            
        except Exception as e:
            logger.error(f"Exa deep search error for {company_name}: {str(e)}")
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.EXA,
                confidence_score=0.1,
                response_time=time.time() - start_time,
                error=f"Exa error: {str(e)}"
            )
    
    async def _search_competitors(self, company_name: str, domain: str) -> List[Dict[str, Any]]:
        """Search for competitor companies using Exa's similarity search"""
        if not domain:
            return []
            
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=self.timeout)) as session:
                payload = {
                    "url": f"https://{domain.replace('https://', '').replace('http://', '')}",
                    "num_results": 10,
                    "contents": {
                        "text": {"max_characters": 1000}
                    }
                }
                
                headers = {
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                }
                
                async with session.post(
                    f"{self.base_url}/findSimilar",
                    json=payload,
                    headers=headers
                ) as response:
                    
                    if response.status != 200:
                        logger.warning(f"Exa findSimilar error: {response.status}")
                        return []
                    
                    data = await response.json()
                    results = data.get("results", [])
                    
                    competitors = []
                    for result in results[:5]:  # Limit to top 5 competitors
                        competitors.append({
                            "name": result.get("title", "").split(" - ")[0],  # Extract company name
                            "url": result.get("url", ""),
                            "description": result.get("text", "")[:200],
                            "relevance_score": result.get("score", 0.0)
                        })
                    
                    return competitors
                    
        except Exception as e:
            logger.warning(f"Competitor search failed: {str(e)}")
            return []
    
    async def _search_industry_insights(self, company_name: str, context: str) -> str:
        """Search for industry insights and trends"""
        try:
            # Extract industry from context or company name
            industry_query = f"{company_name} industry trends market analysis"
            if context:
                industry_query += f" {context[:100]}"  # Add context snippet
            
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=self.timeout)) as session:
                payload = {
                    "query": industry_query,
                    "num_results": 3,
                    "use_autoprompt": True,
                    "contents": {
                        "text": {"max_characters": 2000}
                    }
                }
                
                headers = {
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                }
                
                async with session.post(
                    f"{self.base_url}/search",
                    json=payload,
                    headers=headers
                ) as response:
                    
                    if response.status != 200:
                        logger.warning(f"Exa industry search error: {response.status}")
                        return ""
                    
                    data = await response.json()
                    results = data.get("results", [])
                    
                    # Combine insights from multiple sources
                    insights = []
                    for result in results:
                        text = result.get("text", "")
                        if text:
                            insights.append(text[:300])  # Limit each insight
                    
                    return " ".join(insights)[:1000]  # Limit total insights
                    
        except Exception as e:
            logger.warning(f"Industry insights search failed: {str(e)}")
            return ""
    
    def _calculate_exa_confidence(self, competitors: List[Dict], industry_insights: str) -> float:
        """Calculate confidence score for Exa results"""
        score = 0.0
        
        # Score based on competitors found
        if len(competitors) >= 3:
            score += 0.5
        elif len(competitors) >= 1:
            score += 0.3
            
        # Score based on industry insights
        if industry_insights and len(industry_insights) > 500:
            score += 0.4
        elif industry_insights:
            score += 0.2
            
        # Bonus for competitor quality
        if competitors:
            avg_relevance = sum(c.get("relevance_score", 0) for c in competitors) / len(competitors)
            if avg_relevance > 0.7:
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
    """
    
    def __init__(self):
        self.tavily = TavilyClient()
        self.exa = ExaClient() 
        self.perplexity = PerplexityClient()
        
        # Configuration thresholds
        self.tier2_confidence_threshold = 0.6
        self.tier3_confidence_threshold = 0.4
        self.premium_lead_value_threshold = 1000
        
    async def research_company(self, 
                             company_name: str,
                             domain: str = "",
                             user_tier: str = "free",
                             lead_value: float = 0.0,
                             force_tier: Optional[ResearchTier] = None) -> ResearchResult:
        """
        Orchestrate tiered research with intelligent escalation.
        
        Args:
            company_name: Company to research
            domain: Company website domain
            user_tier: User subscription tier (free, pro, enterprise)
            lead_value: Estimated lead value for premium research decisions
            force_tier: Force specific research tier (for testing)
            
        Returns:
            Final research result with all relevant data
        """
        logger.info(f"Starting tiered research for {company_name}")
        
        # TIER 1: Always start with Tavily (fast basic research)
        tier1_result = await self.tavily.search(company_name, domain)
        
        if force_tier == ResearchTier.TAVILY:
            return tier1_result
            
        if tier1_result.error:
            logger.warning(f"Tier 1 failed for {company_name}: {tier1_result.error}")
            
        # Decide if we should escalate to Tier 2
        should_escalate_tier2 = (
            tier1_result.confidence_score < self.tier2_confidence_threshold or
            tier1_result.data_points < 3 or
            tier1_result.error is not None or
            force_tier == ResearchTier.EXA
        )
        
        if not should_escalate_tier2:
            logger.info(f"Tier 1 sufficient for {company_name} (confidence: {tier1_result.confidence_score:.2f})")
            return tier1_result
        
        # TIER 2: Escalate to Exa for competitor and industry analysis
        logger.info(f"Escalating to Tier 2 for {company_name} (confidence: {tier1_result.confidence_score:.2f})")
        tier2_result = await self.exa.deep_search(
            company_name, 
            domain, 
            tier1_result.company_overview
        )
        
        if force_tier == ResearchTier.EXA:
            return self._merge_research_results(tier1_result, tier2_result)
        
        # Merge Tier 1 and Tier 2 results
        merged_result = self._merge_research_results(tier1_result, tier2_result)
        
        # Decide if we should escalate to Tier 3
        should_escalate_tier3 = (
            user_tier in ["pro", "enterprise"] and
            (
                merged_result.confidence_score < self.tier3_confidence_threshold or
                lead_value >= self.premium_lead_value_threshold or
                force_tier == ResearchTier.PERPLEXITY
            )
        )
        
        if not should_escalate_tier3:
            logger.info(f"Tier 2 sufficient for {company_name} (confidence: {merged_result.confidence_score:.2f})")
            return merged_result
        
        # TIER 3: Premium comprehensive research with Perplexity
        logger.info(f"Escalating to Tier 3 (Premium) for {company_name}")
        previous_context = f"{tier1_result.company_overview} {tier2_result.industry_insights}"
        
        tier3_result = await self.perplexity.comprehensive_research(
            company_name,
            domain, 
            previous_context
        )
        
        # Merge all research results
        final_result = self._merge_research_results(merged_result, tier3_result)
        
        logger.info(f"Completed tiered research for {company_name} - Final confidence: {final_result.confidence_score:.2f}")
        return final_result
    
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