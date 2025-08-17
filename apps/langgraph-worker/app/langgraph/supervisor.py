"""
Supervisor node for routing and orchestration in LangGraph workflow
"""
from typing import Literal
from langchain_openai import ChatOpenAI
from langgraph.types import Command
from ..utils.config import get_settings
from ..utils.logger import setup_logger
from .state import EmailGenerationState

logger = setup_logger(__name__)
settings = get_settings()

def create_supervisor_llm():
    """Create LLM for supervisor decisions if needed"""
    return ChatOpenAI(
        model=settings.default_model,
        temperature=0.3,  # Lower temperature for more consistent routing
        max_tokens=500,
        openai_api_key=settings.openai_api_key
    )

def supervisor_router(state: EmailGenerationState) -> Command[Literal[
    "relevance_analyzer",
    "pain_point_researcher", 
    "value_matcher",
    "email_writer",
    "followup_strategist",
    "aggregator",
    "__end__"
]]:
    """
    Supervisor function that routes to the next appropriate agent.
    Uses deterministic routing based on workflow stage.
    
    Args:
        state: Current workflow state
        
    Returns:
        Command object directing next node
    """
    current_stage = state.get("current_stage", "start")
    logger.info(f"Supervisor routing from stage: {current_stage}")
    
    # Error handling
    if current_stage == "error":
        logger.error(f"Workflow in error state: {state.get('errors', [])}")
        return Command(goto="__end__", update={"current_stage": "error"})
    
    # Stage-based routing logic
    if current_stage == "start":
        logger.info("Starting workflow with relevance analysis")
        return Command(
            goto="relevance_analyzer",
            update={"current_stage": "relevance_analysis"}
        )
    
    elif current_stage == "relevance_analysis":
        # Check relevance score to determine if we should continue
        relevance_score = state.get("relevance_score", 0)
        
        if relevance_score < 0.3:  # Low relevance threshold
            logger.warning(f"Low relevance score ({relevance_score}), ending workflow")
            return Command(
                goto="aggregator",
                update={
                    "current_stage": "aggregation",
                    "recommendations": ["Lead has low relevance score, consider deprioritizing"]
                }
            )
        
        logger.info(f"Relevance score ({relevance_score}) acceptable, proceeding to pain point research")
        return Command(
            goto="pain_point_researcher",
            update={"current_stage": "pain_point_research"}
        )
    
    elif current_stage == "pain_point_research":
        logger.info("Moving from pain point research to value matching")
        return Command(
            goto="value_matcher",
            update={"current_stage": "value_matching"}
        )
    
    elif current_stage == "value_matching":
        logger.info("Moving from value matching to email writing")
        return Command(
            goto="email_writer",
            update={"current_stage": "email_writing"}
        )
    
    elif current_stage == "email_writing":
        # Check if follow-up sequence is requested
        requirements = state.get("requirements")
        if requirements and hasattr(requirements, 'follow_up_sequence') and requirements.follow_up_sequence:
            logger.info("Follow-up sequence requested, routing to strategist")
            return Command(
                goto="followup_strategist",
                update={"current_stage": "followup_strategy"}
            )
        else:
            logger.info("No follow-up sequence needed, moving to aggregation")
            return Command(
                goto="aggregator",
                update={"current_stage": "aggregation"}
            )
    
    elif current_stage == "followup_strategy":
        logger.info("Follow-up strategy complete, moving to aggregation")
        return Command(
            goto="aggregator",
            update={"current_stage": "aggregation"}
        )
    
    elif current_stage == "aggregation" or current_stage == "complete":
        logger.info("Workflow complete, ending")
        return Command(
            goto="__end__",
            update={"current_stage": "complete"}
        )
    
    else:
        logger.error(f"Unknown stage: {current_stage}")
        return Command(
            goto="__end__",
            update={
                "current_stage": "error",
                "errors": [f"Unknown workflow stage: {current_stage}"]
            }
        )

def intelligent_supervisor_router(state: EmailGenerationState) -> Command:
    """
    Alternative supervisor that uses LLM for more intelligent routing decisions.
    Can be used for more complex workflows or A/B testing.
    """
    llm = create_supervisor_llm()
    current_stage = state.get("current_stage", "start")
    
    # Build context for LLM decision
    context = {
        "current_stage": current_stage,
        "relevance_score": state.get("relevance_score", 0),
        "pain_points_count": len(state.get("pain_points", [])),
        "has_primary_email": state.get("primary_email") is not None,
        "errors": state.get("errors", [])
    }
    
    # Use structured output to get routing decision
    prompt = f"""
    Based on the current workflow state, determine the next agent to call.
    
    Current context:
    {context}
    
    Available agents:
    - relevance_analyzer: Analyze lead relevance and fit
    - pain_point_researcher: Identify customer pain points
    - value_matcher: Match our value to their needs
    - email_writer: Write personalized email
    - followup_strategist: Plan follow-up sequence
    - aggregator: Compile final results
    - __end__: Complete the workflow
    
    Return only the agent name.
    """
    
    response = llm.invoke(prompt)
    next_agent = response.content.strip().lower()
    
    logger.info(f"Intelligent supervisor routing to: {next_agent}")
    
    return Command(
        goto=next_agent,
        update={"next_agent": next_agent}
    )