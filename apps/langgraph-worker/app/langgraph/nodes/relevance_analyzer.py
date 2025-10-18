"""
Relevance Analyzer Node for LangGraph workflow
Determines lead relevance and fit for our services
"""

import time
from typing import Dict, Any
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field
from ...utils.config import get_settings
from ...utils.logger import setup_logger
from ...utils.research_clients import ClientRegistry
from ...models.lead_models import AgentResult
from ..state import EmailGenerationState

logger = setup_logger(__name__)
settings = get_settings()

class RelevanceAnalysis(BaseModel):
    """Structured output for relevance analysis"""
    relevance_score: float = Field(..., ge=0, le=1, description="Relevance score from 0 to 1")
    qualification_level: str = Field(..., description="High, Medium, or Low qualification")
    fit_assessment: str = Field(..., description="Detailed fit assessment")
    key_factors: list[str] = Field(..., description="Key factors affecting relevance")
    decision_factors: list[str] = Field(..., description="Decision-making factors identified")
    timing_assessment: str = Field(..., description="Urgency and timing assessment")
    red_flags: list[str] = Field(default_factory=list, description="Any concerns or red flags")
    opportunities: list[str] = Field(..., description="Key opportunities identified")

async def relevance_analyzer_node(state: EmailGenerationState) -> Dict[str, Any]:
    """
    Analyze lead relevance and determine fit for our services.
    
    This node evaluates:
    - Lead qualification and quality (0-100 score)
    - Business fit and potential
    - Decision-making factors
    - Timing and urgency
    - Red flags or concerns
    
    Args:
        state: Current workflow state
        
    Returns:
        Updated state with relevance analysis
    """
    start_time = time.time()
    logger.info(f"Starting relevance analysis for {state['lead'].company_name}")
    
    try:
        provider_keys = state.get("provider_keys") or {}
        registry = ClientRegistry.get_instance()

        # Initialize LLM with structured output
        llm = registry.get_openai_client(
            api_key=provider_keys.get("openai"),
            model=settings.default_model,
            temperature=settings.temperature,
            max_tokens=settings.max_tokens,
        ).with_structured_output(RelevanceAnalysis)
        
        # Create analysis prompt
        prompt = ChatPromptTemplate.from_messages([
            ("system", """You are an expert lead qualification specialist with deep experience 
            in B2B sales and customer analysis. Your role is to evaluate leads based on their 
            business characteristics, size, industry, and potential for conversion. You excel 
            at identifying high-value prospects and understanding buying signals.
            
            Evaluate the lead considering:
            1. Company size and growth stage alignment
            2. Industry fit with our services
            3. Budget indicators and financial health
            4. Technology stack and current solutions
            5. Geographic and cultural fit
            6. Decision-making structure and urgency
            7. Potential value and long-term opportunity
            """),
            ("human", """Analyze this lead for our services:
            
            Lead Information:
            - Company: {company_name}
            - Industry: {industry}
            - Size: {company_size}
            - Location: {location}
            - Description: {description}
            - Website: {website}
            - Contact: {contact_name} ({title})
            - Technologies: {technologies}
            
            Our Business Context:
            - Company: {our_company}
            - Industry: {our_industry}
            - Services: {our_services}
            - Target Markets: {our_targets}
            - Value Proposition: {our_value}
            - Key Differentiators: {our_differentiators}
            
            Provide a comprehensive relevance analysis with:
            - Relevance score (0-1)
            - Qualification level (High/Medium/Low)
            - Detailed fit assessment
            - Key factors affecting relevance
            - Decision-making factors
            - Timing assessment
            - Any red flags
            - Key opportunities
            """)
        ])
        
        # Prepare input data
        lead = state["lead"]
        business_profile = state["business_profile"]
        
        # Execute analysis
        analysis: RelevanceAnalysis = await llm.ainvoke(prompt.format_messages(
            company_name=lead.company_name,
            industry=lead.industry or "Not specified",
            company_size=lead.company_size or "Not specified",
            location=lead.location or "Not specified",
            description=lead.description or "Not provided",
            website=lead.website or "Not provided",
            contact_name=lead.contact_name or "Unknown",
            title=lead.title or "Position not specified",
            technologies=", ".join(lead.technologies) if lead.technologies else "Not specified",
            our_company=business_profile.company_name,
            our_industry=business_profile.industry,
            our_services=", ".join(business_profile.services),
            our_targets=", ".join(business_profile.target_markets),
            our_value=business_profile.value_proposition,
            our_differentiators=", ".join(business_profile.key_differentiators)
        ))
        
        execution_time = time.time() - start_time
        
        # Create agent result
        agent_result = AgentResult(
            agent_name="Relevance Analyzer",
            role="Lead qualification and fit assessment",
            output=f"Relevance Score: {analysis.relevance_score:.2f} - {analysis.qualification_level} qualification. {analysis.fit_assessment}",
            confidence_score=min(0.95, analysis.relevance_score + 0.15),  # Boost confidence slightly
            execution_time=execution_time
        )
        
        # Update state
        logger.info(f"Relevance analysis complete: Score={analysis.relevance_score:.2f}, Level={analysis.qualification_level}")
        
        return {
            "current_stage": "relevance_analysis",  # Update stage for supervisor routing
            "relevance_analysis": {
                "score": analysis.relevance_score,
                "qualification_level": analysis.qualification_level,
                "fit_assessment": analysis.fit_assessment,
                "key_factors": analysis.key_factors,
                "decision_factors": analysis.decision_factors,
                "timing": analysis.timing_assessment,
                "red_flags": analysis.red_flags,
                "opportunities": analysis.opportunities
            },
            "relevance_score": analysis.relevance_score,
            "agent_results": [*state.get("agent_results", []), agent_result],
            "processing_times": {
                **state.get("processing_times", {}),
                "relevance_analyzer": execution_time
            },
            "confidence_scores": {
                **state.get("confidence_scores", {}),
                "relevance_analyzer": agent_result.confidence_score
            },
            "quality_gates_passed": {
                **state.get("quality_gates_passed", {}),
                "relevance_analysis": analysis.relevance_score >= 0.3
            }
        }
        
    except Exception as e:
        logger.error(f"Error in relevance analyzer: {str(e)}")
        execution_time = time.time() - start_time
        
        # Create error result
        agent_result = AgentResult(
            agent_name="Relevance Analyzer",
            role="Lead qualification and fit assessment",
            output=f"Error during analysis: {str(e)}",
            confidence_score=0.0,
            execution_time=execution_time
        )
        
        return {
            "current_stage": "error",  # Set error stage
            "relevance_score": 0.5,  # Default middle score on error
            "relevance_analysis": {
                "error": str(e),
                "score": 0.5,
                "qualification_level": "Unknown",
                "fit_assessment": "Analysis failed due to error"
            },
            "agent_results": [*state.get("agent_results", []), agent_result],
            "errors": [*state.get("errors", []), f"Relevance analyzer error: {str(e)}"]
        }
