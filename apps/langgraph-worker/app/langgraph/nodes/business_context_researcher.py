"""
Business Context Researcher Node for LangGraph workflow
Enhanced with three-tier research system (Tavily, Exa, Perplexity) and real-time progress updates
"""
import time
import asyncio
from typing import Dict, Any, Optional, List
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field
from ...utils.config import get_settings
from ...utils.logger import setup_logger
from ...utils.research_clients import ResearchOrchestrator, ResearchResult, ResearchTier
from ...models.lead_models import AgentResult
from ..state import EmailGenerationState
import json

logger = setup_logger(__name__)
settings = get_settings()

class BusinessContext(BaseModel):
    """Enhanced structured output for tiered business context research"""
    company_overview: str = Field(..., description="Comprehensive company overview")
    industry_focus: str = Field(..., description="Primary industry and market focus")  
    business_model: str = Field(..., description="Core business model and revenue streams")
    key_services: List[str] = Field(..., description="Primary services or products")
    target_customers: str = Field(..., description="Target customer segments")
    pain_points: List[str] = Field(default_factory=list, description="Potential business challenges")
    technology_stack: List[str] = Field(default_factory=list, description="Technologies and tools used")
    competitive_landscape: str = Field(..., description="Competitive positioning and market presence")
    growth_stage: str = Field(..., description="Company growth stage and maturity")
    recent_news: List[str] = Field(default_factory=list, description="Recent company developments")
    
    # Enhanced fields for tiered research
    competitors: List[Dict[str, Any]] = Field(default_factory=list, description="Discovered competitor companies")
    industry_insights: str = Field(default="", description="Deep industry analysis and trends")
    research_tier: str = Field(..., description="Research tier used (tavily/exa/perplexity)")
    confidence_score: float = Field(..., ge=0, le=1, description="Research confidence score")
    data_sources: List[str] = Field(..., description="Sources of information gathered")
    
    # Research metadata
    research_time: float = Field(..., description="Total research time in seconds")
    escalation_reason: Optional[str] = Field(None, description="Reason for tier escalation")
    sources_analyzed: int = Field(default=0, description="Number of sources analyzed")
    comprehensive_report: Optional[str] = Field(None, description="Comprehensive research report from Perplexity")

async def broadcast_research_progress(search_id: str, stage: str, tier: str, confidence: float = 0.0, data_points: int = 0, message: str = "", **kwargs):
    """
    Broadcast research progress to Convex backend for real-time updates.
    Makes HTTP calls to Convex webhook endpoints.
    """
    try:
        import aiohttp
        from ...utils.config import get_settings
        
        settings = get_settings()
        
        # Construct webhook URL
        if not settings.convex_url:
            logger.warning("No Convex URL configured, cannot broadcast research progress")
            return
        
        webhook_url = f"{settings.convex_url.rstrip('/')}/api/webhooks/research/progress"
        
        # Prepare payload
        payload = {
            "searchId": search_id,
            "stage": stage,
            "tier": tier,
            "confidence": confidence,
            "dataPoints": data_points,
            "message": message,
        }

        # Normalize and add optional fields from kwargs (accept snake_case and camelCase)
        # sourcesAnalyzed
        if kwargs.get("sourcesAnalyzed") is not None:
            payload["sourcesAnalyzed"] = kwargs["sourcesAnalyzed"]
        elif kwargs.get("sources_analyzed") is not None:
            payload["sourcesAnalyzed"] = kwargs["sources_analyzed"]
        # escalationReason
        if kwargs.get("escalationReason") is not None:
            payload["escalationReason"] = kwargs["escalationReason"]
        elif kwargs.get("escalation_reason") is not None:
            payload["escalationReason"] = kwargs["escalation_reason"]
        # error
        if kwargs.get("error") is not None:
            payload["error"] = kwargs["error"]
        # metadata
        if kwargs.get("metadata") is not None:
            payload["metadata"] = kwargs["metadata"]
        
        # Make HTTP request to Convex webhook
        headers = {
            "Content-Type": "application/json"
        }
        
        # Add API key if configured
        if hasattr(settings, 'api_key') and settings.api_key:
            headers["x-api-key"] = settings.api_key
        
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as session:
            async with session.post(webhook_url, json=payload, headers=headers) as response:
                if response.status == 200:
                    logger.info(f"Research progress broadcast successful: {search_id} - {stage}")
                else:
                    response_text = await response.text()
                    logger.warning(f"Research progress broadcast failed: {response.status} - {response_text}")
                    
    except Exception as e:
        logger.warning(f"Failed to broadcast research progress: {str(e)}")
        # Don't raise the exception to avoid breaking the research flow

class TieredBusinessContextResearcher:
    """
    Enhanced Business Context Researcher using three-tier research system.
    
    Tier 1: Tavily (fast basic context, 2-3 seconds)
    Tier 2: Exa (competitor analysis, 3-4 seconds) 
    Tier 3: Perplexity (comprehensive reports, 10-15 seconds)
    """
    
    def __init__(self):
        self.orchestrator = ResearchOrchestrator()
    
    async def research_company_with_progress(self, 
                                           company_name: str, 
                                           domain: str,
                                           search_id: str = "",
                                           user_tier: str = "free",
                                           lead_value: float = 0.0) -> ResearchResult:
        """
        Perform tiered research with real-time progress updates.
        
        Args:
            company_name: Company to research
            domain: Company website domain
            search_id: Search ID for progress tracking
            user_tier: User subscription tier
            lead_value: Estimated lead value
            
        Returns:
            Comprehensive research result from appropriate tier
        """
        logger.info(f"Starting tiered research for {company_name}")
        
        # Broadcast initial research start
        await broadcast_research_progress(
            search_id=search_id,
            stage="research_started", 
            tier="tavily",
            message="Starting business context research...",
            company_name=company_name
        )
        
        try:
            # Use the orchestrator to perform tiered research
            result = await self.orchestrator.research_company(
                company_name=company_name,
                domain=domain,
                user_tier=user_tier,
                lead_value=lead_value
            )
            
            # Broadcast completion with final results
            await broadcast_research_progress(
                search_id=search_id,
                stage="research_completed",
                tier=result.tier.value,
                confidence=result.confidence_score,
                data_points=result.data_points,
                message=f"Research completed with {result.tier.value} tier",
                sources_analyzed=result.sources_analyzed,
                escalation_reason=result.escalation_reason
            )
            
            return result
            
        except Exception as e:
            logger.error(f"Tiered research failed for {company_name}: {str(e)}")
            
            # Broadcast error
            await broadcast_research_progress(
                search_id=search_id,
                stage="research_failed",
                tier="error", 
                message=f"Research failed: {str(e)}",
                error=str(e)
            )
            
            # Return error result
            return ResearchResult(
                query=company_name,
                tier=ResearchTier.TAVILY,
                confidence_score=0.1,
                error=f"Research failed: {str(e)}"
            )

async def business_context_researcher_node(state: EmailGenerationState) -> Dict[str, Any]:
    """
    Enhanced Business Context Researcher node with three-tier research system.
    
    This node:
    1. Uses tiered research system (Tavily -> Exa -> Perplexity)
    2. Provides real-time progress updates via broadcasting
    3. Intelligently escalates based on confidence and user tier
    4. Enriches context with competitors and industry insights
    5. Generates comprehensive business intelligence for personalization
    
    Args:
        state: Current workflow state containing lead data
        
    Returns:
        Updated state with enhanced business context research
    """
    start_time = time.time()
    lead = state["lead"]
    request_id = state.get("request_id", "unknown")
    
    logger.info(f"Starting enhanced business context research for {lead.company_name}")
    
    try:
        # Extract domain from lead
        domain = lead.website or ""
        if not domain and hasattr(lead, 'contact_info') and hasattr(lead.contact_info, 'website'):
            domain = lead.contact_info.website or ""
        
        # Determine user tier and lead value (placeholder - could come from state)
        user_tier = state.get("user_tier", "free")  # Could be in business_profile
        lead_value = float(getattr(lead, 'estimated_value', 0))
        
        # Perform tiered research with progress updates
        researcher = TieredBusinessContextResearcher()
        research_result = await researcher.research_company_with_progress(
            company_name=lead.company_name,
            domain=domain,
            search_id=request_id,  # Use request_id for progress tracking
            user_tier=user_tier,
            lead_value=lead_value
        )
        
        # Initialize LLM for enhanced context analysis
        llm = ChatOpenAI(
            model=settings.default_model,
            temperature=0.3,  # Lower temperature for consistent analysis
            max_tokens=settings.max_tokens,
            openai_api_key=settings.openai_api_key
        ).with_structured_output(BusinessContext)
        
        # Create enhanced analysis prompt for tiered research
        prompt = ChatPromptTemplate.from_messages([
            ("system", """You are an expert business intelligence analyst specializing in 
            comprehensive company research and competitive analysis. Your role is to synthesize 
            multi-source research data into actionable business insights for personalized 
            sales and marketing outreach. You excel at identifying business models, pain points, 
            competitive positioning, growth opportunities, and market dynamics.
            
            Analyze the provided tiered research data and extract:
            1. Comprehensive company overview and value proposition
            2. Industry focus, market position, and trends
            3. Business model, revenue streams, and growth strategy
            4. Key services, products, and competitive differentiators
            5. Target customer segments and market approach
            6. Business challenges, pain points, and market pressures
            7. Technology stack, innovation focus, and digital presence
            8. Competitive landscape, positioning, and market opportunities
            9. Growth stage, maturity, and scaling indicators
            10. Recent developments, news, and strategic initiatives
            11. A list of concrete data sources used (titles and URLs) for transparency
            """),
            ("human", """Analyze this comprehensive tiered research data:
            
            Company: {company_name}
            Website: {domain}
            Research Tier: {research_tier}
            Confidence Score: {confidence_score}
            
            Lead Information:
            - Industry: {lead_industry}
            - Company Size: {company_size}
            - Location: {location}
            - Description: {lead_description}
            - Technologies: {technologies}
            
            Research Results:
            - Company Overview: {company_overview}
            - Services/Products: {services_products}
            - Industry Insights: {industry_insights}
            - Competitors: {competitors}
            - Research Time: {research_time}s
            - Sources Analyzed: {sources_analyzed}
            - Escalation Reason: {escalation_reason}
            
            Comprehensive Report:
            {comprehensive_report}
            
            Raw Research Data:
            {raw_data}
            
            Provide a comprehensive business context analysis leveraging all available 
            research tiers. Focus on actionable insights for highly personalized email 
            outreach that demonstrates deep understanding of the company's business context.
            """)
        ])
        
        # Prepare enhanced analysis input
        competitors_summary = []
        if research_result.competitors:
            competitors_summary = [
                f"{comp.get('name', 'Unknown')}: {comp.get('description', '')[:100]}..."
                for comp in research_result.competitors[:3]
            ]
        
        # Execute enhanced analysis with tiered research data
        analysis: BusinessContext = await llm.ainvoke(prompt.format_messages(
            company_name=lead.company_name,
            domain=domain or "Not provided",
            research_tier=research_result.tier.value,
            confidence_score=research_result.confidence_score,
            lead_industry=getattr(lead, 'industry', '') or "Not specified",
            company_size=getattr(lead, 'company_size', '') or "Not specified", 
            location=getattr(lead, 'location', '') or "Not specified",
            lead_description=getattr(lead, 'description', '') or "Not provided",
            technologies=", ".join(getattr(lead, 'technologies', [])) or "Not specified",
            company_overview=research_result.company_overview or "No overview available",
            services_products=", ".join(research_result.services_products) or "No services identified",
            industry_insights=research_result.industry_insights or "No industry insights",
            competitors="; ".join(competitors_summary) or "No competitors identified",
            research_time=research_result.response_time,
            sources_analyzed=research_result.sources_analyzed,
            escalation_reason=research_result.escalation_reason or "Not escalated",
            comprehensive_report=research_result.raw_data.get('comprehensive_report', 'No comprehensive report') or "No comprehensive report",
            raw_data=json.dumps(research_result.raw_data, indent=2)[:1000]  # Limit raw data
        ))
        
        execution_time = time.time() - start_time
        
        # Create enhanced agent result
        tier_label = research_result.tier.value.title()
        agent_result = AgentResult(
            agent_name="Enhanced Business Context Researcher",
            role=f"Tiered company intelligence ({tier_label})",
            output=f"Tier {research_result.tier.value} research completed for {lead.company_name}. "
                   f"Confidence: {research_result.confidence_score:.2f}. "
                   f"Found {len(analysis.key_services)} services, {len(analysis.competitors)} competitors, "
                   f"{len(analysis.pain_points)} pain points. Sources: {research_result.sources_analyzed}. "
                   f"{analysis.company_overview[:150]}...",
            confidence_score=research_result.confidence_score,
            execution_time=execution_time
        )
        
        # Update state with enhanced business context
        logger.info(f"Enhanced business context research complete for {lead.company_name}: "
                   f"Tier={tier_label}, Confidence={research_result.confidence_score:.2f}, "
                   f"Time={execution_time:.2f}s, Sources={research_result.sources_analyzed}")
        
        return {
            "current_stage": "business_context_research", 
            "business_context": {
                # Core analysis from LLM
                "company_overview": analysis.company_overview,
                "industry_focus": analysis.industry_focus,
                "business_model": analysis.business_model,
                "key_services": analysis.key_services,
                "target_customers": analysis.target_customers,
                "pain_points": analysis.pain_points,
                "technology_stack": analysis.technology_stack,
                "competitive_landscape": analysis.competitive_landscape,
                "growth_stage": analysis.growth_stage,
                "recent_news": analysis.recent_news,
                
                # Enhanced tiered research data
                "competitors": research_result.competitors,
                "industry_insights": research_result.industry_insights,
                "research_tier": research_result.tier.value,
                "confidence_score": research_result.confidence_score,
                # Data sources should come from the structured analysis
                "data_sources": analysis.data_sources,
                "research_time": research_result.response_time,
                "escalation_reason": research_result.escalation_reason,
                "sources_analyzed": research_result.sources_analyzed,
                "comprehensive_report": research_result.raw_data.get('comprehensive_report'),
                
                # Research metadata
                "research_metadata": {
                    "tier_used": research_result.tier.value,
                    "confidence": research_result.confidence_score,
                    "data_points": research_result.data_points,
                    "sources": research_result.sources_analyzed,
                    "escalation": research_result.escalation_reason,
                    "response_time": research_result.response_time,
                    "raw_data": research_result.raw_data
                }
            },
            "agent_results": [*state.get("agent_results", []), agent_result],
            "processing_times": {
                **state.get("processing_times", {}),
                "business_context_researcher": execution_time
            },
            "confidence_scores": {
                **state.get("confidence_scores", {}),
                "business_context_researcher": research_result.confidence_score
            },
            "quality_gates_passed": {
                **state.get("quality_gates_passed", {}),
                "business_context_research": research_result.confidence_score >= 0.6
            }
        }
        
    except Exception as e:
        logger.error(f"Error in enhanced business context researcher: {str(e)}")
        execution_time = time.time() - start_time
        
        # Broadcast error
        await broadcast_research_progress(
            search_id=request_id,
            stage="research_error",
            tier="error",
            message=f"Research error: {str(e)}",
            error=str(e)
        )
        
        # Create error result
        agent_result = AgentResult(
            agent_name="Enhanced Business Context Researcher",
            role="Tiered company intelligence",
            output=f"Error during enhanced business context research: {str(e)}",
            confidence_score=0.1,
            execution_time=execution_time
        )
        
        return {
            "current_stage": "error",
            "business_context": {
                "error": str(e),
                "company_overview": f"Enhanced research failed for {lead.company_name}",
                "research_tier": "error",
                "confidence_score": 0.1
            },
            "agent_results": [*state.get("agent_results", []), agent_result],
            "errors": [*state.get("errors", []), f"Enhanced business context researcher error: {str(e)}"]
        }
