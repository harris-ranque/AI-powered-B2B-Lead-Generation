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
from ...utils.data_validation import BaseDataValidator, determine_lead_tier
from ...utils.analytics import capture_event, capture_error
from ...models.lead_models import AgentResult, CompetitorInsight
from ..state import EmailGenerationState

logger = setup_logger(__name__)
settings = get_settings()

def extract_company_data(raw_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extract structured company data from raw research results.

    Extracts the 5 required data points with sources:
    1. Annual revenue
    2. Employee count
    3. Leadership names
    4. Recent company news (≤6 months)
    5. Funding/investments

    Args:
        raw_data: Raw research data from ResearchResult.raw_data

    Returns:
        Dictionary with structured company data and sources
    """
    import re

    company_data = {
        "annual_revenue": None,
        "employee_count": None,
        "leadership_names": [],
        "recent_news": [],
        "funding_details": None,
    }

    # Combine all text content for extraction
    all_text = ""
    if "comprehensive_report" in raw_data:
        all_text += str(raw_data["comprehensive_report"]) + " "
    if "langchain_tavily_result" in raw_data:
        tavily_data = raw_data["langchain_tavily_result"]
        if "answer" in tavily_data:
            all_text += str(tavily_data["answer"]) + " "
        if "results" in tavily_data and isinstance(tavily_data["results"], list):
            for item in tavily_data["results"]:
                if isinstance(item, dict) and "content" in item:
                    all_text += str(item["content"]) + " "

    # Extract annual revenue
    revenue_patterns = [
        r'\$([0-9,.]+)\s*(million|billion|M|B)\s*(?:in\s*revenue|revenue|annual revenue)',
        r'revenue.*?\$([0-9,.]+)\s*(million|billion|M|B)',
        r'annual.*?revenue.*?\$([0-9,.]+)\s*(million|billion|M|B)',
    ]
    for pattern in revenue_patterns:
        match = re.search(pattern, all_text, re.IGNORECASE)
        if match:
            amount = match.group(1)
            unit = match.group(2).upper()
            company_data["annual_revenue"] = {
                "amount": f"${amount} {unit}",
                "year": "recent",  # Could be enhanced to extract year
                "source": "research"
            }
            break

    # Extract employee count
    employee_patterns = [
        r'(\d+[\d,]*)\s*(?:employees|staff|workers|people)',
        r'team.*?(\d+[\d,]*)',
        r'workforce.*?(\d+[\d,]*)',
    ]
    for pattern in employee_patterns:
        match = re.search(pattern, all_text, re.IGNORECASE)
        if match:
            count = match.group(1)
            company_data["employee_count"] = {
                "count": count,
                "as_of": "recent",
                "source": "research"
            }
            break

    # Extract leadership names (titles with names)
    leadership_patterns = [
        r'(CEO|CTO|CFO|COO|President|Founder|Director)[\s:]+([A-Z][a-z]+ [A-Z][a-z]+)',
        r'([A-Z][a-z]+ [A-Z][a-z]+),?\s+(CEO|CTO|CFO|COO|President|Founder|Director)',
    ]
    leadership_names = []
    for pattern in leadership_patterns:
        matches = re.finditer(pattern, all_text, re.IGNORECASE)
        for match in matches:
            if match.group(1).upper() in ['CEO', 'CTO', 'CFO', 'COO', 'PRESIDENT', 'FOUNDER', 'DIRECTOR']:
                title = match.group(1)
                name = match.group(2)
            else:
                name = match.group(1)
                title = match.group(2)

            leadership_names.append({
                "name": name,
                "title": title,
                "source": "research"
            })

    if leadership_names:
        company_data["leadership_names"] = leadership_names[:5]  # Max 5 leaders

    # Extract recent news from dedicated field
    if "recent_news" in raw_data and isinstance(raw_data["recent_news"], list):
        recent_news_items = []
        for news in raw_data["recent_news"][:5]:  # Max 5 news items
            if isinstance(news, str):
                recent_news_items.append({
                    "event": news,
                    "date": "recent",
                    "source": "research"
                })
        company_data["recent_news"] = recent_news_items

    # Extract funding details
    funding_patterns = [
        r'raised\s*\$([0-9,.]+)\s*(million|billion|M|B)',
        r'funding.*?\$([0-9,.]+)\s*(million|billion|M|B)',
        r'(Series [A-Z]|Seed)\s*(?:round)?.*?\$([0-9,.]+)\s*(million|billion|M|B)?',
    ]
    for pattern in funding_patterns:
        match = re.search(pattern, all_text, re.IGNORECASE)
        if match:
            if len(match.groups()) >= 2:
                amount = match.group(1) if match.group(1) else match.group(2)
                unit = match.group(2) if len(match.groups()) == 2 else match.group(3)
                company_data["funding_details"] = {
                    "total_raised": f"${amount} {unit if unit else 'M'}",
                    "latest_round": match.group(0),
                    "investors": [],
                    "source": "research"
                }
            break

    return company_data

class BusinessIntelligence(BaseModel):
    """Streamlined business intelligence analysis optimized for token efficiency"""
    model_config = ConfigDict(extra="forbid")

    # Core company context (consolidated)
    company_overview: str = Field(..., description="2-sentence company overview with industry focus, business model, and growth stage")
    key_services: List[str] = Field(..., max_length=5, description="Top 3-5 primary services or products")
    target_customers: str = Field(..., description="1-sentence description of target customer segments")

    # Research metadata (essential only)
    research_tier: str = Field(..., description="Research tier used (tavily/perplexity)")
    confidence_score: float = Field(..., ge=0, le=1, description="Research confidence score")

    # Relevance analysis (core metrics)
    relevance_score: float = Field(..., ge=0, le=1, description="Overall relevance score for this lead")
    qualification_level: str = Field(..., description="High, Medium, or Low qualification")
    fit_assessment: str = Field(..., description="2-sentence fit assessment with key factors")
    opportunities: List[str] = Field(..., max_length=3, description="Top 3 key opportunities identified")
    red_flags: List[str] = Field(default_factory=list, max_length=3, description="Top 3 concerns or red flags")

    # Pain points (consolidated)
    pain_points: List[str] = Field(..., max_length=5, description="Top 3-5 business pain points with urgency indicators")
    impact_assessment: str = Field(..., description="1-sentence potential impact of addressing pain points")

    # Value propositions (consolidated)
    value_matches: List[str] = Field(..., max_length=5, description="Top 3-5 matches between our services and their needs")
    value_alignment_score: float = Field(..., ge=0, le=1, description="Value alignment score")
    competitive_advantages: List[str] = Field(..., max_length=3, description="Top 3 advantages over alternatives")

    # Personalization (essential only)
    personalization_elements: List[str] = Field(..., max_length=5, description="Top 3-5 elements for personalization")
    messaging_strategy: str = Field(..., description="1-sentence recommended messaging approach")

async def business_intelligence_agent_node(state: EmailGenerationState) -> Dict[str, Any]:
    """
    Comprehensive Business Intelligence Agent that consolidates:
    1. Business Context Research (Tavily → Perplexity tiered research)
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

        # Extract location from lead
        location = getattr(lead, 'location', '') or ""

        # Determine user tier and lead value
        user_tier = state.get("user_tier", "free")
        lead_value = float(getattr(lead, 'estimated_value', 0))
        
        # Perform tiered research
        orchestrator = ResearchOrchestrator(client_registry=registry)
        research_result = await orchestrator.research_company(
            company_name=lead.company_name,
            domain=domain,
            location=location,
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

        # Validate research relevance to prevent garbage results
        relevance_score, relevance_warnings = data_validator.validate_research_relevance(
            research_result,
            company_name=lead.company_name,
            industry=getattr(lead, 'industry', None)
        )

        # Log relevance issues if score is low
        if relevance_score < 0.7:
            logger.warning(f"Research quality concern for {lead.company_name}: "
                          f"Relevance={relevance_score:.2f}, Issues={len(relevance_warnings)}")

        # Determine lead tier based on research quality
        # A-tier: Rich research (validation >= 0.6, confidence >= 0.6, missing <= 1)
        # B-tier: Minimal research (still usable, not penalized in email generation)
        lead_tier, lead_tier_reason = determine_lead_tier(
            validation_score=validation_result.validation_score,
            confidence_score=research_result.confidence_score,
            missing_data_points=len(validation_result.missing_data_points),
        )
        logger.info(f"Lead tier classification for {lead.company_name}: {lead_tier} ({lead_tier_reason})")

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
                "lead_tier": lead_tier,
                "lead_tier_reason": lead_tier_reason,
            },
        )
        
        # Phase 2: Comprehensive business intelligence analysis
        logger.info(f"Phase 2: Comprehensive business intelligence analysis")
        analysis_start = time.time()
        
        # Initialize LLM for comprehensive analysis
        openai_api_key = provider_key_map.get("openai") if using_user_keys else None
        bi_model = settings.business_intelligence_model or settings.default_model
        bi_token_budget = settings.clamp_tokens(settings.business_intelligence_max_tokens)

        # Detect reasoning models: o1 series and gpt-5 series support reasoning_effort
        model_lower = bi_model.lower()
        is_reasoning_model = "o1" in model_lower or "gpt-5" in model_lower

        if is_reasoning_model:
            # Reasoning models (o1, gpt-5, gpt-5-mini): Use reasoning_effort parameter
            # GPT-5-mini supports "minimal" for fastest responses with structured output
            reasoning_level = "minimal" if "gpt-5" in model_lower else "low"

            llm = registry.get_openai_client(
                api_key=openai_api_key,
                model=bi_model,
                temperature=0.3,
                max_completion_tokens=bi_token_budget,
                reasoning_effort=reasoning_level,  # minimal for gpt-5, low for o1
                require_user_key=using_user_keys,
            ).with_structured_output(BusinessIntelligence)
            logger.info(f"Using reasoning model: {bi_model} with {bi_token_budget} tokens, reasoning_effort={reasoning_level}")
        else:
            # Standard GPT models (gpt-4o, gpt-4o-mini, etc.)
            llm = registry.get_openai_client(
                api_key=openai_api_key,
                model=bi_model,
                temperature=0.3,
                max_completion_tokens=bi_token_budget,
                # No reasoning_effort for standard models
                require_user_key=using_user_keys,
            ).with_structured_output(BusinessIntelligence)
            logger.info(f"Using standard GPT model: {bi_model} with {bi_token_budget} tokens")
        
        # Create streamlined analysis prompt optimized for EMAIL GENERATION
        prompt = ChatPromptTemplate.from_messages([
            ("system", """You are an elite business intelligence analyst specializing in EMAIL-READY, actionable insights.

CRITICAL PURPOSE: Extract intelligence that enables highly personalized B2B emails with:
- Recent, dateable events for opening personalization
- REAL competitor names and quantifiable proof points for body
- Specific numbers for subject line curiosity hooks
- Verifiable claims for credibility

CRITICAL CONSTRAINTS FOR TOKEN EFFICIENCY:
- Company overview: EXACTLY 2 sentences (industry focus, business model, growth stage)
- All text fields: MAXIMUM 2 sentences
- All lists: MAXIMUM 3-5 items (use max_length limit)
- Pain points: Include urgency indicators AND quantifiable impact in bullet text
- Fit assessment: 2 sentences covering key factors and decision-making elements

EMAIL-OPTIMIZED ANALYSIS FOCUS:

1. RECENT MILESTONES (for email opening personalization):
   - Extract SPECIFIC events with DATES (funding, hiring, launches, growth)
   - Format: "[Event] in [Month Year]" or "[Number] [thing] [timeframe]"
   - Examples: "closed Series A in March 2024", "posted 5 SDR roles", "doubled to 500+ customers"

2. COMPETITOR INTELLIGENCE (for proof points):
   - Extract REAL competitor NAMES (never "similar companies")
   - Include what competitors did and quantifiable results
   - Format: "[Competitor Name]: [Action] + [Specific Result with Number]"
   - Examples: "Salesforce: reduced churn by 40%", "Zendesk: switched from X to Y"

3. QUANTIFIABLE PAIN POINTS (for subject lines and relevance):
   - Include SPECIFIC NUMBERS: time wasted, cost, efficiency percentages
   - Format: "[Challenge] + [Quantifiable Impact]"
   - Examples: "25+ hours/week on manual prospecting", "SDRs spend only 20% time selling"

4. PROOF POINTS WITH NUMBERS (for email body):
   - Extract industry benchmarks with percentages
   - Include peer comparison data with numbers
   - Format: "[What] achieved [Number]% [Result]"
   - Examples: "Similar companies reduce X by 30-40%", "Mixpanel achieved 80% SDR efficiency"

5. PERSONALIZATION ELEMENTS (for deep customization):
   - Recent news with dates
   - Growth indicators with numbers
   - Technology stack with specific product names
   - Business challenges with quantifiable impact

OUTPUT REQUIREMENTS:
- Use REAL company/product names (never generic references)
- Include SPECIFIC NUMBERS and PERCENTAGES in every bullet
- Provide DATES for recent events (month/year minimum)
- Format for easy email insertion
- Prioritize EMAIL-USABLE insights over generic analysis
            """),
            ("human", """Extract EMAIL-READY business intelligence (2 sentences max per text field, 3-5 items per list):

LEAD DATA:
Company: {company_name} | Contact: {contact_name} ({title})
Industry: {industry} | Size: {company_size} | Location: {location}
Website: {website} | Technologies: {technologies}

RESEARCH RESULTS ({research_tier} tier, confidence: {confidence_score}):
Overview: {company_overview}
Services: {services_products}
Insights: {industry_insights}
Competitors: {competitors_summary}
Recent News: {recent_news}

OUR PROFILE:
{our_company} - {our_industry}
Value Prop: {our_value_prop}
Services: {our_services}
Target Markets: {our_targets}
Differentiators: {our_differentiators}

EXTRACT EMAIL-OPTIMIZED INTELLIGENCE:

1. Company overview (2 sentences: industry, model, growth stage + any recent milestone with date)

2. Top 3-5 services (specific, not generic)

3. Target customers (1 sentence with specifics)

4. Relevance score (0-1) and qualification (High/Medium/Low)

5. Fit assessment (2 sentences with key factors)

6. Top 3 opportunities and red flags

7. Top 3-5 pain points with QUANTIFIABLE IMPACT:
   - MUST include specific numbers: hours/week, percentage, dollar amount
   - Format: "[Challenge]: [Quantifiable Impact]"
   - Examples: "Manual prospecting: 25+ hours/week wasted", "Low conversion: Only 20% of leads qualify"
   - Extract from research or infer from industry standards

8. Impact assessment (1 sentence with quantifiable benefit if possible)

9. Top 3-5 value matches:
   - Match our services to their needs with potential impact
   - Include competitor examples if available: "[Competitor Name] achieved [Number]% [Result]"
   - Examples: "Automated lead gen: Similar companies reduce manual work by 30-40%"

10. Value alignment score (0-1)

11. Top 3 competitive advantages (specific to this prospect, with proof points if available)

12. Top 3-5 personalization elements for EMAIL OPENING:
    - PRIORITIZE recent events with dates: "closed Series A in [Month Year]"
    - Include hiring indicators: "posted [Number] [roles]"
    - Growth milestones with numbers: "doubled customer base to [Number]"
    - Technology stack: "uses [Specific Tool Names]"
    - Extract from recent_news first, then company_overview

13. Messaging strategy (1 sentence with specific angle based on their situation)

CRITICAL REQUIREMENTS:
- Extract REAL competitor names from research (list actual company names)
- Include SPECIFIC NUMBERS in pain points (percentages, hours, dollars)
- Add DATES to recent events (month/year minimum)
- Use ACTUAL company/product names (never generic "similar companies")
- Format insights for direct email insertion
- If research lacks numbers, use industry standard ranges (e.g., "typical 25-30% improvement")
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
        
        # Create streamlined agent result
        agent_result = AgentResult(
            agent_name="Business Intelligence Agent",
            role="Streamlined business intelligence and analysis",
            output=f"Business intelligence for {lead.company_name}. "
                   f"Research: {research_result.tier.value} tier. "
                   f"Relevance: {intelligence.relevance_score:.2f} ({intelligence.qualification_level}). "
                   f"Pain points: {len(intelligence.pain_points)}, Value matches: {len(intelligence.value_matches)}. "
                   f"Value alignment: {intelligence.value_alignment_score:.2f}. "
                   f"Personalization: {len(intelligence.personalization_elements)} elements. "
                   f"{intelligence.company_overview}",
            confidence_score=max(research_result.confidence_score, intelligence.relevance_score),
            execution_time=total_time
        )
        
        logger.info(f"Business intelligence analysis completed for {lead.company_name}: "
                   f"Relevance={intelligence.relevance_score:.2f}, "
                   f"Value alignment={intelligence.value_alignment_score:.2f}, "
                   f"Time={total_time:.2f}s")

        # TODO: REMOVE BEFORE PRODUCTION - Log raw research data being stored
        raw_data = research_result.raw_data
        logger.info("=" * 80)
        logger.info(f"RAW RESEARCH DATA STORED FOR {lead.company_name}")
        logger.info("=" * 80)
        logger.info(f"📰 Recent news items: {len(raw_data.get('recent_news', []))}")
        logger.info(f"🏢 Competitor mentions: {len(raw_data.get('competitor_mentions', []))}")
        logger.info(f"📊 Quantifiable metrics: {len(raw_data.get('quantifiable_metrics', []))}")
        logger.info(f"⚠️ Pain point research: {len(raw_data.get('pain_points', []))}")
        logger.info(f"📈 Industry benchmarks: {len(raw_data.get('industry_benchmarks', []))}")
        logger.info(f"💻 Technology stack: {len(raw_data.get('technology_stack', []))}")

        # Log first item from each category as sample
        if raw_data.get('recent_news'):
            logger.info(f"\nSample recent news: {raw_data['recent_news'][0][:150]}...")
        if raw_data.get('competitor_mentions'):
            logger.info(f"Sample competitor: {raw_data['competitor_mentions'][0][:150]}...")
        if raw_data.get('quantifiable_metrics'):
            logger.info(f"Sample metric: {raw_data['quantifiable_metrics'][0][:150]}...")
        logger.info("=" * 80)
        # END TODO: REMOVE LOGGING
        
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
                "value_alignment_score": intelligence.value_alignment_score,
                "personalization_elements": len(intelligence.personalization_elements),
                "token_optimization": "streamlined_schema_v2",  # Track optimization version
            },
        )

        # Extract structured company data from raw research
        company_data = extract_company_data(research_result.raw_data)

        # Update state with comprehensive business intelligence
        # IMPORTANT: research_metadata contains ALL raw bullet points from Tavily/Perplexity searches
        # This includes complete, unfiltered research results for downstream agents to use
        # Email Generation Agent extracts these for maximum personalization depth
        return {
            "current_stage": "business_intelligence_complete",
            "business_intelligence": {
                **intelligence_data,
                "research_metadata": research_result.raw_data,  # Complete research data preserved here
                "company_data": company_data,  # Structured extraction of 5 key data points
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
            # Deep research tracking with tier used
            "deep_research_triggered": deep_research_used,
            "deep_research_reason": deep_research_reason,
            "missing_data_points": validation_result.missing_data_points,
            "research_credit_cost": total_credit_cost,
            "base_data_validation_score": validation_result.validation_score,
            "research_tier": research_result.final_tier_used,  # "basic", "pro", or "deep"
            "escalation_reason": research_result.escalation_reason,
            "company_data": company_data,  # Structured company data for Convex storage
            # Lead tier classification for B-tier handling
            "lead_tier": lead_tier,  # "A" or "B"
            "lead_tier_reason": lead_tier_reason,  # Explanation for tier classification
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
            "has_lead": lead is not None
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
