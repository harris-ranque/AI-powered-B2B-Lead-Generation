"""
Business Intelligence Agent for LangGraph workflow
Consolidates business context research, relevance analysis, pain point research, and value matching
into a single comprehensive intelligence gathering agent.
"""
import time
import asyncio
from typing import Dict, Any, List, Optional
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field, ConfigDict
from ...utils.config import get_settings
from ...utils.logger import setup_logger
from ...utils.research_clients import (
    ResearchOrchestrator,
    ResearchResult,
    ResearchTier,
    ClientRegistry,
)
from ...utils.data_validation import BaseDataValidator
from ...utils.analytics import capture_event, capture_error
from ...models.lead_models import AgentResult, CompetitorInsight
from ..state import EmailGenerationState

logger = setup_logger(__name__)
settings = get_settings()

class BusinessIntelligence(BaseModel):
    """Comprehensive business intelligence analysis"""
    model_config = ConfigDict(extra="forbid")

    # Company overview and context
    company_overview: str = Field(..., description="Comprehensive company overview")
    industry_focus: str = Field(..., description="Primary industry and market focus")
    business_model: str = Field(..., description="Core business model and revenue streams")
    key_services: List[str] = Field(..., description="Primary services or products")
    target_customers: str = Field(..., description="Target customer segments")
    competitive_landscape: str = Field(..., description="Competitive positioning and market presence")
    growth_stage: str = Field(..., description="Company growth stage and maturity")
    technology_stack: List[str] = Field(default_factory=list, description="Technologies and tools used")
    recent_news: List[str] = Field(default_factory=list, description="Recent company developments")
    
    # Research metadata
    research_tier: str = Field(..., description="Research tier used (tavily/exa/perplexity)")
    confidence_score: float = Field(..., ge=0, le=1, description="Research confidence score")
    data_sources: List[str] = Field(..., description="Sources of information gathered")
    competitors: List[CompetitorInsight] = Field(
        default_factory=list,
        description="Discovered competitor companies",
    )
    industry_insights: str = Field(default="", description="Deep industry analysis and trends")
    
    # Relevance analysis
    relevance_score: float = Field(..., ge=0, le=1, description="Overall relevance score for this lead")
    qualification_level: str = Field(..., description="High, Medium, or Low qualification")
    fit_assessment: str = Field(..., description="Detailed fit assessment")
    key_factors: List[str] = Field(..., description="Key factors affecting relevance")
    decision_factors: List[str] = Field(..., description="Decision-making factors identified")
    timing_assessment: str = Field(..., description="Urgency and timing assessment")
    red_flags: List[str] = Field(default_factory=list, description="Any concerns or red flags")
    opportunities: List[str] = Field(..., description="Key opportunities identified")
    
    # Pain points and challenges
    pain_points: List[str] = Field(..., description="Identified business pain points")
    pain_point_categories: List[str] = Field(..., description="Categories of pain points")
    urgency_indicators: List[str] = Field(..., description="Signs of urgency or pressure")
    impact_assessment: str = Field(..., description="Potential impact of addressing pain points")
    
    # Value propositions and matching
    value_matches: List[str] = Field(..., description="How our services match their needs")
    value_alignment_score: float = Field(..., ge=0, le=1, description="Value alignment score")
    quantified_benefits: List[str] = Field(..., description="Quantified potential benefits")
    risk_mitigation: List[str] = Field(..., description="How we mitigate their risks")
    competitive_advantages: List[str] = Field(..., description="Our advantages over alternatives")
    
    # Personalization insights
    personalization_elements: List[str] = Field(..., description="Key elements for personalization")
    messaging_strategy: str = Field(..., description="Recommended messaging approach")
    engagement_hooks: List[str] = Field(..., description="Potential engagement hooks")

async def business_intelligence_agent_node(state: EmailGenerationState) -> Dict[str, Any]:
    """
    Comprehensive Business Intelligence Agent that consolidates:
    1. Business Context Research (Tavily → Exa → Perplexity tiered research)
    2. Relevance Analysis (lead qualification and fit assessment)
    3. Pain Point Research (challenge identification and analysis)
    4. Value Matching (solution alignment and benefit quantification)
    
    This agent performs all business intelligence gathering in a single pass,
    providing rich context for downstream email generation.
    
    Args:
        state: Current workflow state containing lead data
        
    Returns:
        Updated state with comprehensive business intelligence
    """
    start_time = time.time()
    lead = state["lead"]
    business_profile = state["business_profile"]
    request_id = state.get("request_id", "unknown")
    
    logger.info(f"Starting comprehensive business intelligence analysis for {lead.company_name}")
    
    provider_keys: Optional[Dict[str, str]] = state.get("provider_keys")
    provider_key_map = provider_keys or {}
    using_user_keys = provider_keys is not None
    registry = ClientRegistry.get_instance()
    analytics_context = {
        "request_id": request_id,
        "lead_id": getattr(lead, "id", None),
        "company_name": lead.company_name,
        "user_id": state.get("user_id"),
        "user_tier": state.get("user_tier", "free"),
        "using_user_keys": using_user_keys,
        "provider_keys_supplied": sorted(provider_key_map.keys()) if using_user_keys else [],
    }
    capture_event("bi_agent_started", analytics_context)

    try:
        # Phase 1: Execute tiered business context research
        logger.info(f"Phase 1: Business context research for {lead.company_name}")
        research_start = time.time()
        
        # Extract domain from lead
        domain = lead.website or ""
        if not domain and hasattr(lead, 'contact_info') and hasattr(lead.contact_info, 'website'):
            domain = lead.contact_info.website or ""
        
        # Determine user tier and lead value
        user_tier = state.get("user_tier", "free")
        lead_value = float(getattr(lead, 'estimated_value', 0))
        
        # Perform tiered research
        orchestrator = ResearchOrchestrator(client_registry=registry)
        research_result = await orchestrator.research_company(
            company_name=lead.company_name,
            domain=domain,
            user_tier=user_tier,
            lead_value=lead_value,
            provider_keys=provider_key_map if using_user_keys else None,
            user_id=state.get("user_id"),
        )
        
        research_time = time.time() - research_start
        logger.info(f"Research completed in {research_time:.2f}s using {research_result.tier.value} tier")
        
        # Track deep research usage
        deep_research_used = research_result.tier == ResearchTier.PERPLEXITY
        deep_research_reason = research_result.escalation_reason if deep_research_used else None
        
        # Validate data completeness for tracking
        data_validator = BaseDataValidator()
        validation_result = data_validator.validate_research_result(research_result)
        
        # Calculate credit cost (base cost + deep research cost if used)
        from ...config import CREDIT_COSTS
        base_credit_cost = CREDIT_COSTS['AI_ANALYSIS']
        deep_research_cost = CREDIT_COSTS['DEEP_RESEARCH'] if deep_research_used else 0
        total_credit_cost = base_credit_cost + deep_research_cost
        
        logger.info(f"Deep research: {'Used' if deep_research_used else 'Not used'}, "
                   f"Reason: {deep_research_reason}, Credits: {total_credit_cost}")
        capture_event(
            "bi_agent_research_completed",
            {
                **analytics_context,
                "research_tier": research_result.tier.value,
                "research_confidence": research_result.confidence_score,
                "research_data_points": research_result.data_points,
                "research_sources": research_result.sources_analyzed,
                "deep_research_used": deep_research_used,
                "deep_research_reason": deep_research_reason,
                "research_duration_ms": research_time * 1000,
                "validation_score": validation_result.validation_score,
                "missing_data_points": validation_result.missing_data_points,
                "credit_cost": total_credit_cost,
            },
        )
        
        # Phase 2: Comprehensive business intelligence analysis
        logger.info(f"Phase 2: Comprehensive business intelligence analysis")
        analysis_start = time.time()
        
        # Initialize LLM for comprehensive analysis
        # gpt-5-nano uses max_completion_tokens instead of max_tokens
        openai_api_key = provider_key_map.get("openai") if using_user_keys else None
        llm = registry.get_openai_client(
            api_key=openai_api_key,
            model=settings.default_model,
            temperature=0.3,
            max_completion_tokens=settings.max_tokens,
            reasoning_effort="minimal",
            require_user_key=using_user_keys,
        ).with_structured_output(BusinessIntelligence)
        
        # Create comprehensive analysis prompt
        prompt = ChatPromptTemplate.from_messages([
            ("system", """You are an elite business intelligence analyst with expertise in:
            - Company research and competitive analysis
            - Lead qualification and market assessment  
            - Pain point identification and business challenge analysis
            - Value proposition alignment and benefit quantification
            - Personalization strategy and messaging optimization
            
            Your role is to perform comprehensive business intelligence analysis that combines:
            1. Deep company research and market context
            2. Lead relevance and qualification assessment
            3. Pain point identification and urgency analysis
            4. Value proposition matching and benefit quantification
            5. Personalization insights and messaging strategy
            
            Use the tiered research data to create actionable intelligence for highly 
            personalized B2B email outreach that demonstrates deep understanding of 
            the prospect's business context, challenges, and opportunities.
            
            Quality standards:
            - Relevance scores: >0.7 = High, 0.4-0.7 = Medium, <0.4 = Low
            - Value alignment: Focus on quantifiable business impact
            - Pain points: Prioritize by urgency and business impact
            - Personalization: Identify specific, unique elements for this company
            """),
            ("human", """Perform comprehensive business intelligence analysis:
            
            LEAD INFORMATION:
            Company: {company_name}
            Contact: {contact_name} ({title})
            Industry: {industry}
            Company Size: {company_size}
            Location: {location}
            Website: {website}
            Description: {description}
            Technologies: {technologies}
            Revenue: {revenue}
            
            TIERED RESEARCH RESULTS:
            Research Tier: {research_tier}
            Confidence Score: {confidence_score}
            Company Overview: {company_overview}
            Services/Products: {services_products}
            Industry Insights: {industry_insights}
            Competitors: {competitors_summary}
            Recent News: {recent_news}
            Research Time: {research_time}s
            Sources Analyzed: {sources_analyzed}
            
            OUR BUSINESS PROFILE:
            Company: {our_company}
            Industry: {our_industry}
            Value Proposition: {our_value_prop}
            Services: {our_services}
            Target Markets: {our_targets}
            Differentiators: {our_differentiators}
            
            COMPREHENSIVE ANALYSIS REQUIRED:
            
            1. COMPANY INTELLIGENCE:
            - Synthesize research into comprehensive company overview
            - Analyze business model, growth stage, and market position
            - Identify technology stack and innovation focus
            - Extract recent developments and strategic initiatives
            
            2. RELEVANCE ASSESSMENT:
            - Score lead relevance (0-1) based on fit with our services
            - Determine qualification level (High/Medium/Low)
            - Identify key factors affecting relevance
            - Assess decision-making factors and timing
            - Flag any red flags or concerns
            - Highlight key opportunities
            
            3. PAIN POINT ANALYSIS:
            - Identify specific business challenges and pain points
            - Categorize pain points by type and urgency
            - Assess potential impact of addressing these challenges
            - Look for urgency indicators and market pressures
            
            4. VALUE PROPOSITION ALIGNMENT:
            - Map our services to their specific needs
            - Quantify potential benefits and business impact
            - Identify competitive advantages over alternatives
            - Assess risk mitigation we provide
            - Calculate value alignment score (0-1)
            
            5. PERSONALIZATION STRATEGY:
            - Extract unique personalization elements
            - Recommend messaging strategy and tone
            - Identify engagement hooks and conversation starters
            - Suggest specific value propositions for this prospect
            
            Provide actionable intelligence for creating highly personalized, 
            value-driven email outreach that resonates with this specific prospect.
            """)
        ])
        
        # Prepare comprehensive analysis input
        competitors_summary = []
        if research_result.competitors:
            competitors_summary = [
                f"{comp.get('name', 'Unknown')}: {comp.get('description', '')[:100]}..."
                for comp in research_result.competitors[:3]
            ]
        
        # Execute comprehensive analysis
        intelligence: BusinessIntelligence = await llm.ainvoke(prompt.format_messages(
            # Lead information
            company_name=lead.company_name,
            contact_name=lead.contact_name or "Unknown",
            title=lead.title or "Professional",
            industry=getattr(lead, 'industry', '') or "Not specified",
            company_size=getattr(lead, 'company_size', '') or "Not specified",
            location=getattr(lead, 'location', '') or "Not specified",
            website=lead.website or "Not provided",
            description=getattr(lead, 'description', '') or "Not provided",
            technologies=", ".join(getattr(lead, 'technologies', [])) or "Not specified",
            revenue=getattr(lead, 'revenue', '') or "Not specified",
            
            # Research results
            research_tier=research_result.tier.value,
            confidence_score=research_result.confidence_score,
            company_overview=research_result.company_overview or "No overview available",
            services_products=", ".join(research_result.services_products) or "No services identified",
            industry_insights=research_result.industry_insights or "No industry insights",
            competitors_summary="; ".join(competitors_summary) or "No competitors identified",
            recent_news="; ".join(research_result.raw_data.get('recent_news', [])) or "No recent news",
            research_time=research_result.response_time,
            sources_analyzed=research_result.sources_analyzed,
            
            # Our business profile
            our_company=business_profile.company_name,
            our_industry=business_profile.industry,
            our_value_prop=business_profile.value_proposition,
            our_services=", ".join(business_profile.services),
            our_targets=", ".join(business_profile.target_markets),
            our_differentiators=", ".join(business_profile.key_differentiators)
        ))
        
        analysis_time = time.time() - analysis_start
        total_time = time.time() - start_time
        
        # Create comprehensive agent result
        agent_result = AgentResult(
            agent_name="Business Intelligence Agent",
            role="Comprehensive business intelligence and analysis",
            output=f"Complete business intelligence analysis for {lead.company_name}. "
                   f"Research tier: {research_result.tier.value}. "
                   f"Relevance: {intelligence.relevance_score:.2f} ({intelligence.qualification_level}). "
                   f"Found {len(intelligence.pain_points)} pain points, {len(intelligence.value_matches)} value matches, "
                   f"{len(intelligence.competitors)} competitors. "
                   f"Value alignment: {intelligence.value_alignment_score:.2f}. "
                   f"Personalization elements: {len(intelligence.personalization_elements)}. "
                   f"{intelligence.company_overview[:200]}...",
            confidence_score=max(research_result.confidence_score, intelligence.relevance_score),
            execution_time=total_time
        )
        
        logger.info(f"Business intelligence analysis completed for {lead.company_name}: "
                   f"Relevance={intelligence.relevance_score:.2f}, "
                   f"Value alignment={intelligence.value_alignment_score:.2f}, "
                   f"Time={total_time:.2f}s")
        
        intelligence_data = intelligence.model_dump()
        capture_event(
            "bi_agent_completed",
            {
                **analytics_context,
                "research_tier": research_result.tier.value,
                "research_confidence": research_result.confidence_score,
                "deep_research_used": deep_research_used,
                "analysis_duration_ms": analysis_time * 1000,
                "total_duration_ms": total_time * 1000,
                "relevance_score": intelligence.relevance_score,
                "qualification_level": intelligence.qualification_level,
                "pain_points_found": len(intelligence.pain_points),
                "value_matches_found": len(intelligence.value_matches),
                "competitors_found": len(intelligence.competitors),
                "value_alignment_score": intelligence.value_alignment_score,
                "personalization_elements": len(intelligence.personalization_elements),
            },
        )

        # Update state with comprehensive business intelligence
        return {
            "current_stage": "business_intelligence_complete",
            "business_intelligence": {
                **intelligence_data,
                "research_metadata": research_result.raw_data,
                "analysis_time": total_time,
            },
            # Populate legacy/top-level compatibility fields used by downstream components
            "relevance_score": intelligence.relevance_score,
            "pain_points": intelligence.pain_points,
            "value_matches": intelligence.value_matches,
            "agent_results": [*state.get("agent_results", []), agent_result],
            "processing_times": {
                **state.get("processing_times", {}),
                "business_intelligence": total_time,
                "research_time": research_time,
                "analysis_time": analysis_time
            },
            "confidence_scores": {
                **state.get("confidence_scores", {}),
                "business_intelligence": max(research_result.confidence_score, intelligence.relevance_score),
                "research_confidence": research_result.confidence_score,
                "relevance_score": intelligence.relevance_score,
                "value_alignment": intelligence.value_alignment_score
            },
            "quality_gates_passed": {
                **state.get("quality_gates_passed", {}),
                "business_intelligence": intelligence.relevance_score >= 0.4,
                "research_quality": research_result.confidence_score >= 0.6,
                "value_alignment": intelligence.value_alignment_score >= 0.5
            },
            # Deep research tracking
            "deep_research_triggered": deep_research_used,
            "deep_research_reason": deep_research_reason,
            "missing_data_points": validation_result.missing_data_points,
            "research_credit_cost": total_credit_cost,
            "base_data_validation_score": validation_result.validation_score,
            "research_tier": research_result.tier.value,
            "escalation_reason": research_result.escalation_reason
        }
        
    except Exception as e:
        import traceback
        import sentry_sdk
        execution_time = time.time() - start_time

        # Comprehensive error logging with full context
        error_details = {
            "error_type": type(e).__name__,
            "error_message": str(e),
            "lead_company": lead.company_name if lead else "Unknown",
            "lead_id": getattr(lead, 'id', 'Unknown'),
            "request_id": state.get('request_id', 'Unknown'),
            "execution_time": execution_time,
            "stack_trace": traceback.format_exc()
        }
        capture_error(
            "bi_agent_failed",
            e,
            {
                **analytics_context,
                "duration_ms": execution_time * 1000,
            },
        )

        # Send structured context to Sentry
        sentry_sdk.set_context("business_intelligence_error", {
            "agent": "Business Intelligence Agent",
            "error_type": error_details['error_type'],
            "lead_company": error_details['lead_company'],
            "lead_id": error_details['lead_id'],
            "request_id": error_details['request_id'],
            "execution_time_seconds": error_details['execution_time'],
            "has_business_profile": business_profile is not None,
            "has_requirements": requirements is not None
        })

        # Capture exception in Sentry with full context
        sentry_sdk.capture_exception(e)

        logger.error(
            f"CRITICAL ERROR in Business Intelligence Agent:\n"
            f"  Error Type: {error_details['error_type']}\n"
            f"  Error Message: {error_details['error_message']}\n"
            f"  Lead: {error_details['lead_company']} (ID: {error_details['lead_id']})\n"
            f"  Request ID: {error_details['request_id']}\n"
            f"  Execution Time: {error_details['execution_time']:.2f}s\n"
            f"  Full Stack Trace:\n{error_details['stack_trace']}"
        )

        # Create error result
        agent_result = AgentResult(
            agent_name="Business Intelligence Agent",
            role="Comprehensive business intelligence and analysis",
            output=f"Error during business intelligence analysis: {error_details['error_type']}: {error_details['error_message']}",
            confidence_score=0.1,
            execution_time=execution_time
        )
        
        return {
            "current_stage": "error",
            "business_intelligence": {
                "error": str(e),
                "company_overview": f"Business intelligence analysis failed for {lead.company_name}",
                "relevance_score": 0.1,
                "confidence_score": 0.1
            },
            "agent_results": [*state.get("agent_results", []), agent_result],
            "errors": [*state.get("errors", []), f"Business intelligence agent error: {str(e)}"]
        }
