"""
Value Matcher Node for LangGraph workflow
Aligns our solutions with identified problems
"""
import time
from typing import Dict, Any, List
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field
from ...utils.config import get_settings
from ...utils.logger import setup_logger
from ...models.lead_models import AgentResult
from ..state import EmailGenerationState

logger = setup_logger(__name__)
settings = get_settings()

class ValueAlignment(BaseModel):
    """Structured output for value proposition alignment"""
    value_matches: List[str] = Field(..., description="Direct problem-solution alignments")
    quantified_benefits: List[str] = Field(..., description="Quantifiable benefits and ROI")
    differentiators: List[str] = Field(..., description="Unique differentiators relevant to their needs")
    implementation_ease: str = Field(..., description="How easy/quick to implement our solution")
    success_indicators: List[str] = Field(..., description="Metrics that would indicate success")
    case_study_relevance: List[str] = Field(default_factory=list, description="Relevant case studies or proof points")
    competitive_advantages: List[str] = Field(..., description="Advantages over alternatives")
    risk_mitigation: List[str] = Field(..., description="How we reduce their risks")

async def value_matcher_node(state: EmailGenerationState) -> Dict[str, Any]:
    """
    Match our value proposition to the identified pain points.
    
    This node creates:
    - Direct problem-solution alignments
    - Quantified benefits and ROI
    - Relevant differentiators
    - Case study connections
    - Competitive advantages
    
    Args:
        state: Current workflow state
        
    Returns:
        Updated state with value matching analysis
    """
    start_time = time.time()
    logger.info(f"Starting value matching for {state['lead'].company_name}")
    
    try:
        # Initialize LLM with structured output
        llm = ChatOpenAI(
            model=settings.default_model,
            temperature=settings.temperature,
            max_tokens=settings.max_tokens,
            openai_api_key=settings.openai_api_key
        ).with_structured_output(ValueAlignment)
        
        # Get context from previous nodes
        pain_points = state.get("pain_points", [])
        relevance_context = state.get("relevance_analysis", {})
        
        # Create value matching prompt
        prompt = ChatPromptTemplate.from_messages([
            ("system", """You are a solutions consultant with deep expertise in translating 
            business problems into solution opportunities. You understand how to position 
            products and services to address specific customer needs. You excel at creating 
            compelling value narratives that resonate with decision makers.
            
            Focus on:
            1. Direct problem-solution alignment
            2. Quantifiable benefits and ROI
            3. Competitive advantages in their context
            4. Implementation feasibility
            5. Strategic value beyond immediate needs
            
            Make connections specific, measurable, and compelling."""),
            ("human", """Connect our value proposition to the identified pain points:
            
            Lead Context:
            - Company: {company_name}
            - Industry: {industry}
            - Size: {company_size}
            - Key Opportunities: {opportunities}
            
            Identified Pain Points:
            {pain_points}
            
            Our Capabilities:
            - Value Proposition: {our_value}
            - Services: {our_services}
            - Differentiators: {our_differentiators}
            - Target Markets: {our_targets}
            - Case Studies Available: {has_case_studies}
            
            Create compelling value alignments that:
            - Address each pain point specifically
            - Quantify benefits where possible (time saved, cost reduced, revenue increased)
            - Highlight unique advantages
            - Suggest relevant proof points
            - Position us as the ideal solution
            
            Be specific about how our solutions address their exact situation.
            """)
        ])
        
        # Prepare input data
        lead = state["lead"]
        business_profile = state["business_profile"]
        
        # Execute value matching
        alignment: ValueAlignment = await llm.ainvoke(prompt.format_messages(
            company_name=lead.company_name,
            industry=lead.industry or "Not specified",
            company_size=lead.company_size or "Not specified",
            opportunities=", ".join(relevance_context.get("opportunities", [])),
            pain_points="\n".join(f"- {pp}" for pp in pain_points),
            our_value=business_profile.value_proposition,
            our_services=", ".join(business_profile.services),
            our_differentiators=", ".join(business_profile.key_differentiators),
            our_targets=", ".join(business_profile.target_markets),
            has_case_studies="Yes" if business_profile.case_studies else "No"
        ))
        
        execution_time = time.time() - start_time
        
        # Create agent result
        agent_result = AgentResult(
            agent_name="Value Matcher",
            role="Solution alignment and value proposition",
            output=f"Aligned {len(alignment.value_matches)} value propositions with quantified benefits",
            confidence_score=0.88,
            execution_time=execution_time
        )
        
        # Update state
        logger.info(f"Value matching complete: {len(alignment.value_matches)} alignments created")
        
        return {
            "value_matches": alignment.value_matches,
            "intermediate_results": {
                **state.get("intermediate_results", {}),
                "value_alignment": {
                    "quantified_benefits": alignment.quantified_benefits,
                    "differentiators": alignment.differentiators,
                    "implementation_ease": alignment.implementation_ease,
                    "success_indicators": alignment.success_indicators,
                    "case_studies": alignment.case_study_relevance,
                    "competitive_advantages": alignment.competitive_advantages,
                    "risk_mitigation": alignment.risk_mitigation
                }
            },
            "agent_results": [*state.get("agent_results", []), agent_result],
            "processing_times": {
                **state.get("processing_times", {}),
                "value_matcher": execution_time
            },
            "confidence_scores": {
                **state.get("confidence_scores", {}),
                "value_matcher": agent_result.confidence_score
            },
            "quality_gates_passed": {
                **state.get("quality_gates_passed", {}),
                "value_matching": len(alignment.value_matches) >= 2
            }
        }
        
    except Exception as e:
        logger.error(f"Error in value matcher: {str(e)}")
        execution_time = time.time() - start_time
        
        # Fallback to generic value matches
        generic_matches = [
            "Our AI-powered solution addresses your scaling needs",
            "Streamline operations with our automation capabilities",
            "Improve efficiency and reduce manual effort"
        ]
        
        agent_result = AgentResult(
            agent_name="Value Matcher",
            role="Solution alignment and value proposition",
            output=f"Error during matching, using generic values: {str(e)}",
            confidence_score=0.3,
            execution_time=execution_time
        )
        
        return {
            "value_matches": generic_matches,
            "agent_results": [*state.get("agent_results", []), agent_result],
            "errors": [*state.get("errors", []), f"Value matcher error: {str(e)}"],
            "processing_times": {
                **state.get("processing_times", {}),
                "value_matcher": execution_time
            }
        }