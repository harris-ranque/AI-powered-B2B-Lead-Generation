"""
Follow-up Strategist Node for LangGraph workflow
Plans multi-touch email sequences and timing
"""
import time
from typing import Dict, Any, List
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field
from ...utils.config import get_settings
from ...utils.logger import setup_logger
from ...models.lead_models import AgentResult, EmailContent, FollowUpSequence
from ..state import EmailGenerationState

logger = setup_logger(__name__)
settings = get_settings()

class FollowUpStrategy(BaseModel):
    """Structured output for follow-up sequence planning"""
    sequence_emails: List[Dict[str, str]] = Field(..., description="Email subjects and themes for sequence")
    timing_days: List[int] = Field(..., description="Days to wait between each email")
    angle_progression: List[str] = Field(..., description="Different angles for each touch")
    value_escalation: List[str] = Field(..., description="Escalating value propositions")
    cta_progression: List[str] = Field(..., description="Progressive CTAs")
    conversion_strategy: str = Field(..., description="Overall conversion approach")
    success_metrics: List[str] = Field(..., description="Metrics to track success")
    optimization_points: List[str] = Field(..., description="When/how to optimize sequence")

async def followup_strategist_node(state: EmailGenerationState) -> Dict[str, Any]:
    """
    Design follow-up sequence strategy for multi-touch engagement.
    
    This node creates:
    - Optimal timing for follow-ups
    - Different angles for each touch
    - Value escalation strategy
    - Conversion optimization approach
    
    Args:
        state: Current workflow state
        
    Returns:
        Updated state with follow-up sequence
    """
    start_time = time.time()
    logger.info(f"Starting follow-up strategy for {state['lead'].company_name}")
    
    try:
        # Initialize LLM with structured output
        llm = ChatOpenAI(
            model=settings.default_model,
            temperature=settings.temperature,
            max_tokens=settings.max_tokens,
            openai_api_key=settings.openai_api_key
        ).with_structured_output(FollowUpStrategy)
        
        # Get context from previous nodes
        lead = state["lead"]
        requirements = state["requirements"]
        pain_points = state.get("pain_points", [])
        value_matches = state.get("value_matches", [])
        relevance_context = state.get("relevance_analysis", {})
        primary_email = state.get("primary_email")
        
        # Create strategy prompt
        prompt = ChatPromptTemplate.from_messages([
            ("system", """You are a customer engagement strategist with expertise in designing 
            multi-touch communication campaigns. You understand buyer psychology, decision-making 
            processes, and the optimal timing and messaging for each stage of the customer journey. 
            Your sequences consistently improve conversion rates.
            
            Consider:
            - Industry buying cycles and decision processes
            - Seasonal and business calendar factors
            - Multiple stakeholder engagement needs
            - Various content types and value offerings
            - Progressive value demonstration
            - Natural conversation flow
            """),
            ("human", """Design a follow-up sequence strategy based on the initial email and analysis:
            
            Lead Context:
            - Company: {company_name}
            - Industry: {industry}
            - Size: {company_size}
            - Qualification Level: {qualification_level}
            - Decision Timeline: {timing_assessment}
            
            Initial Email Subject: {initial_subject}
            
            Pain Points to Address:
            {pain_points}
            
            Value Propositions Available:
            {value_matches}
            
            Requirements:
            - Personalization Level: {personalization_level}
            - Original CTA: {original_cta}
            
            Design a 3-5 email follow-up sequence that:
            1. Uses optimal timing based on industry and urgency
            2. Approaches from different angles each time
            3. Escalates value and urgency appropriately
            4. Varies content types (education, case study, offer, etc.)
            5. Includes alternative contact strategies
            6. Builds relationship progressively
            
            Consider the buying cycle for {industry} companies of {company_size} size.
            """)
        ])
        
        # Execute strategy generation
        business_profile = state["business_profile"]
        
        strategy: FollowUpStrategy = await llm.ainvoke(prompt.format_messages(
            company_name=lead.company_name,
            industry=lead.industry or "their industry",
            company_size=lead.company_size or "their size",
            qualification_level=relevance_context.get("qualification_level", "qualified"),
            timing_assessment=relevance_context.get("timing", "standard timeline"),
            initial_subject=primary_email.subject if primary_email else "Strategic Solutions",
            pain_points="\n".join(f"- {pp}" for pp in pain_points[:3]),
            value_matches="\n".join(f"- {vm}" for vm in value_matches[:3]),
            personalization_level=requirements.personalization_level,
            original_cta=requirements.call_to_action
        ))
        
        execution_time = time.time() - start_time
        
        # Create follow-up emails based on strategy
        follow_up_emails = []
        for i, email_plan in enumerate(strategy.sequence_emails[:4]):  # Limit to 4 follow-ups
            follow_up_email = EmailContent(
                subject=email_plan.get("subject", f"Follow-up {i+1}"),
                body=f"""[Follow-up Email {i+1}]
                
Theme: {email_plan.get('theme', 'Value reinforcement')}
Angle: {strategy.angle_progression[i] if i < len(strategy.angle_progression) else 'Alternative approach'}
Value Focus: {strategy.value_escalation[i] if i < len(strategy.value_escalation) else 'Enhanced benefits'}
CTA: {strategy.cta_progression[i] if i < len(strategy.cta_progression) else 'Schedule a call'}

[Actual email content would be generated here based on the strategy]""",
                personalization_notes=[f"Follow-up {i+1}", email_plan.get('theme', '')],
                estimated_effectiveness=0.65 - (i * 0.05)  # Decreasing effectiveness
            )
            follow_up_emails.append(follow_up_email)
        
        # Create FollowUpSequence object
        follow_up_sequence = FollowUpSequence(
            sequence_id=f"seq_{state['request_id']}",
            emails=follow_up_emails,
            timing_schedule=strategy.timing_days[:len(follow_up_emails)],
            conversion_strategy=strategy.conversion_strategy
        )
        
        # Create agent result
        agent_result = AgentResult(
            agent_name="Follow-up Strategist",
            role="Sequence planning and optimization",
            output=f"Designed {len(follow_up_emails)}-email sequence with {strategy.conversion_strategy}",
            confidence_score=0.85,
            execution_time=execution_time
        )
        
        # Update state
        logger.info(f"Follow-up strategy complete: {len(follow_up_emails)} emails planned")
        
        return {
            "follow_up_sequence": follow_up_sequence,
            "intermediate_results": {
                **state.get("intermediate_results", {}),
                "followup_strategy": {
                    "angle_progression": strategy.angle_progression,
                    "value_escalation": strategy.value_escalation,
                    "cta_progression": strategy.cta_progression,
                    "success_metrics": strategy.success_metrics,
                    "optimization_points": strategy.optimization_points
                }
            },
            "agent_results": [*state.get("agent_results", []), agent_result],
            "processing_times": {
                **state.get("processing_times", {}),
                "followup_strategist": execution_time
            },
            "confidence_scores": {
                **state.get("confidence_scores", {}),
                "followup_strategist": agent_result.confidence_score
            },
            "quality_gates_passed": {
                **state.get("quality_gates_passed", {}),
                "followup_strategy": True
            }
        }
        
    except Exception as e:
        logger.error(f"Error in follow-up strategist: {str(e)}")
        execution_time = time.time() - start_time
        
        agent_result = AgentResult(
            agent_name="Follow-up Strategist",
            role="Sequence planning and optimization",
            output=f"Error during strategy generation: {str(e)}",
            confidence_score=0.3,
            execution_time=execution_time
        )
        
        # No follow-up sequence on error
        return {
            "follow_up_sequence": None,
            "agent_results": [*state.get("agent_results", []), agent_result],
            "errors": [*state.get("errors", []), f"Follow-up strategist error: {str(e)}"],
            "processing_times": {
                **state.get("processing_times", {}),
                "followup_strategist": execution_time
            }
        }