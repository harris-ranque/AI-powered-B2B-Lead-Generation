"""
Pain Point Researcher Node for LangGraph workflow
Identifies customer challenges and problems we can solve
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

class PainPointAnalysis(BaseModel):
    """Structured output for pain point analysis"""
    operational_challenges: List[str] = Field(..., description="Operational and efficiency challenges")
    growth_obstacles: List[str] = Field(..., description="Growth and scaling challenges")
    technology_gaps: List[str] = Field(..., description="Technology and infrastructure gaps")
    competitive_pressures: List[str] = Field(..., description="Market and competitive challenges")
    resource_limitations: List[str] = Field(..., description="Resource and capability constraints")
    compliance_concerns: List[str] = Field(default_factory=list, description="Regulatory or compliance issues")
    primary_pain_points: List[str] = Field(..., description="Top 3-5 most critical pain points")
    pain_point_severity: Dict[str, str] = Field(..., description="Severity assessment for each pain point")

async def pain_point_researcher_node(state: EmailGenerationState) -> Dict[str, Any]:
    """
    Research and identify specific pain points the lead is likely experiencing.
    
    This node identifies:
    - Operational challenges and inefficiencies
    - Growth and scaling obstacles
    - Technology and infrastructure gaps
    - Competitive pressures
    - Resource limitations
    - Compliance concerns
    
    Args:
        state: Current workflow state
        
    Returns:
        Updated state with pain point analysis
    """
    start_time = time.time()
    logger.info(f"Starting pain point research for {state['lead'].company_name}")
    
    try:
        # Initialize LLM with structured output
        llm = ChatOpenAI(
            model=settings.default_model,
            temperature=settings.temperature,
            max_tokens=settings.max_tokens,
            openai_api_key=settings.openai_api_key
        ).with_structured_output(PainPointAnalysis)
        
        # Get relevance analysis context
        relevance_context = state.get("relevance_analysis", {})
        
        # Create research prompt
        prompt = ChatPromptTemplate.from_messages([
            ("system", """You are a business analyst and customer research expert who specializes 
            in understanding the challenges businesses face. You have extensive knowledge of 
            common industry problems, operational inefficiencies, and growth obstacles. You're 
            skilled at reading between the lines to identify unspoken needs.
            
            Focus on identifying:
            1. Industry-specific challenges
            2. Company size and growth stage problems
            3. Technology infrastructure gaps
            4. Market positioning difficulties
            5. Resource and capability limitations
            6. Regulatory or compliance concerns
            
            Prioritize pain points that our solutions can address."""),
            ("human", """Based on the lead information and relevance analysis, identify specific pain points:
            
            Lead Information:
            - Company: {company_name}
            - Industry: {industry}
            - Size: {company_size}
            - Location: {location}
            - Description: {description}
            - Current Technologies: {technologies}
            
            Relevance Analysis Context:
            - Qualification Level: {qualification_level}
            - Key Factors: {key_factors}
            - Opportunities: {opportunities}
            
            Our Services That Can Help:
            - Services: {our_services}
            - Specializations: {our_differentiators}
            - Value Proposition: {our_value}
            
            Identify and categorize specific pain points this company likely faces.
            Focus on challenges that align with our solution capabilities.
            Assess the severity of each pain point (Critical, High, Medium, Low).
            """)
        ])
        
        # Prepare input data
        lead = state["lead"]
        business_profile = state["business_profile"]
        
        # Execute research
        analysis: PainPointAnalysis = await llm.ainvoke(prompt.format_messages(
            company_name=lead.company_name,
            industry=lead.industry or "Not specified",
            company_size=lead.company_size or "Not specified",
            location=lead.location or "Not specified",
            description=lead.description or "Not provided",
            technologies=", ".join(lead.technologies) if lead.technologies else "Not specified",
            qualification_level=relevance_context.get("qualification_level", "Unknown"),
            key_factors=", ".join(relevance_context.get("key_factors", [])),
            opportunities=", ".join(relevance_context.get("opportunities", [])),
            our_services=", ".join(business_profile.services),
            our_differentiators=", ".join(business_profile.key_differentiators),
            our_value=business_profile.value_proposition
        ))
        
        execution_time = time.time() - start_time
        
        # Compile all pain points
        all_pain_points = (
            analysis.operational_challenges +
            analysis.growth_obstacles +
            analysis.technology_gaps +
            analysis.competitive_pressures +
            analysis.resource_limitations +
            analysis.compliance_concerns
        )
        
        # Use primary pain points if specified, otherwise take top 5
        main_pain_points = analysis.primary_pain_points if analysis.primary_pain_points else all_pain_points[:5]
        
        # Create agent result
        agent_result = AgentResult(
            agent_name="Pain Point Researcher",
            role="Challenge identification and analysis",
            output=f"Identified {len(main_pain_points)} critical pain points: {', '.join(main_pain_points[:3])}...",
            confidence_score=0.85,
            execution_time=execution_time
        )
        
        # Update state
        logger.info(f"Pain point research complete: {len(main_pain_points)} critical issues identified")
        
        return {
            "pain_points": main_pain_points,
            "intermediate_results": {
                **state.get("intermediate_results", {}),
                "pain_point_analysis": {
                    "operational": analysis.operational_challenges,
                    "growth": analysis.growth_obstacles,
                    "technology": analysis.technology_gaps,
                    "competitive": analysis.competitive_pressures,
                    "resources": analysis.resource_limitations,
                    "compliance": analysis.compliance_concerns,
                    "severity": analysis.pain_point_severity
                }
            },
            "agent_results": [*state.get("agent_results", []), agent_result],
            "processing_times": {
                **state.get("processing_times", {}),
                "pain_point_researcher": execution_time
            },
            "confidence_scores": {
                **state.get("confidence_scores", {}),
                "pain_point_researcher": agent_result.confidence_score
            },
            "quality_gates_passed": {
                **state.get("quality_gates_passed", {}),
                "pain_point_research": len(main_pain_points) >= 3
            }
        }
        
    except Exception as e:
        logger.error(f"Error in pain point researcher: {str(e)}")
        execution_time = time.time() - start_time
        
        # Fallback to generic pain points
        generic_pain_points = [
            "Scaling operational challenges",
            "Technology integration needs",
            "Process optimization requirements",
            "Competitive differentiation challenges"
        ]
        
        agent_result = AgentResult(
            agent_name="Pain Point Researcher",
            role="Challenge identification and analysis",
            output=f"Error during research, using generic pain points: {str(e)}",
            confidence_score=0.3,
            execution_time=execution_time
        )
        
        return {
            "pain_points": generic_pain_points,
            "agent_results": [*state.get("agent_results", []), agent_result],
            "errors": [*state.get("errors", []), f"Pain point researcher error: {str(e)}"],
            "processing_times": {
                **state.get("processing_times", {}),
                "pain_point_researcher": execution_time
            }
        }