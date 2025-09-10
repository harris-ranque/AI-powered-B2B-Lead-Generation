"""
Simplified supervisor for 3-agent linear workflow
Note: This supervisor is now simplified since we use a direct linear flow:
Business Intelligence → Email Generation → Quality Assurance → End
"""
from typing import Literal
from langchain_openai import ChatOpenAI
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

def supervisor_node(state: EmailGenerationState) -> dict:
    """
    Supervisor node that updates state and determines workflow progress.
    This is the actual node function that returns state updates.
    
    Args:
        state: Current workflow state
        
    Returns:
        State updates dict
    """
    current_stage = state.get("current_stage", "start")
    logger.info(f"Supervisor processing stage: {current_stage}")
    
    # Just return minimal state update - routing is handled by supervisor_router
    return {
        "current_stage": current_stage  # Keep current stage
    }

def supervisor_router(state: EmailGenerationState) -> str:
    """
    Router function for conditional edges.
    Determines next node based on current state.
    
    Args:
        state: Current workflow state
        
    Returns:
        Next node name as string
    """
    current_stage = state.get("current_stage", "start")
    logger.info(f"Supervisor routing from stage: {current_stage}")
    
    # Error handling
    if current_stage == "error":
        logger.error(f"Workflow in error state: {state.get('errors', [])}")
        return "__end__"
    
    # Stage-based routing logic
    if current_stage == "start":
        logger.info("Starting workflow with relevance analysis")
        return "relevance_analyzer"
    
    elif current_stage == "relevance_analysis":
        # TODO: Implement proper relevance threshold logic and scoring system
        # Currently allowing ALL leads through for testing - should be configurable threshold
        # Original threshold was 0.3, consider making this user-configurable or dynamic
        relevance_score = state.get("relevance_score", 0)
        
        # Temporarily allow all leads through for testing
        logger.info(f"Relevance score ({relevance_score}), proceeding to pain point research (all leads allowed)")
        return "pain_point_researcher"
    
    elif current_stage == "pain_point_research":
        logger.info("Moving from pain point research to value matching")
        return "value_matcher"
    
    elif current_stage == "value_matching":
        logger.info("Moving from value matching to email writing")
        return "email_writer"
    
    elif current_stage == "email_writing":
        # Check if follow-up sequence is requested
        requirements = state.get("requirements")
        if requirements and hasattr(requirements, 'follow_up_sequence') and requirements.follow_up_sequence:
            logger.info("Follow-up sequence requested, routing to strategist")
            return "followup_strategist"
        else:
            logger.info("No follow-up sequence needed, moving to aggregation")
            return "aggregator"
    
    elif current_stage == "followup_strategy":
        logger.info("Follow-up strategy complete, moving to aggregation")
        return "aggregator"
    
    elif current_stage == "aggregation" or current_stage == "complete":
        logger.info("Workflow complete, ending")
        return "__end__"
    
    else:
        logger.error(f"Unknown stage: {current_stage}")
        return "__end__"

def intelligent_supervisor_router(state: EmailGenerationState) -> str:
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
    
    state["next_agent"] = next_agent
    return next_agent