"""
Main LangGraph workflow for email generation
Orchestrates all nodes and manages state flow
"""
from typing import Dict, Any, Optional
from datetime import datetime
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver
from ..utils.logger import setup_logger
from .state import EmailGenerationState
from .supervisor import supervisor_node, supervisor_router
from .nodes import (
    relevance_analyzer_node,
    pain_point_researcher_node,
    value_matcher_node,
    email_writer_node,
    followup_strategist_node,
    aggregator_node
)

logger = setup_logger(__name__)

def create_email_generation_workflow(
    checkpointer: Optional[MemorySaver] = None,
    debug: bool = False
) -> StateGraph:
    """
    Create the complete email generation workflow using LangGraph.
    
    This workflow implements a supervisor pattern with the following nodes:
    - Supervisor: Routes between agents
    - Relevance Analyzer: Evaluates lead fit
    - Pain Point Researcher: Identifies challenges
    - Value Matcher: Aligns solutions
    - Email Writer: Creates content
    - Follow-up Strategist: Plans sequences (optional)
    - Aggregator: Compiles results
    
    Args:
        checkpointer: Optional checkpointer for state persistence
        debug: Enable debug mode for verbose output
        
    Returns:
        Compiled LangGraph workflow
    """
    logger.info("Creating email generation workflow")
    
    # Initialize the state graph
    workflow = StateGraph(EmailGenerationState)
    
    # Add all nodes to the graph
    workflow.add_node("supervisor", supervisor_node)
    workflow.add_node("relevance_analyzer", relevance_analyzer_node)
    workflow.add_node("pain_point_researcher", pain_point_researcher_node)
    workflow.add_node("value_matcher", value_matcher_node)
    workflow.add_node("email_writer", email_writer_node)
    workflow.add_node("followup_strategist", followup_strategist_node)
    workflow.add_node("aggregator", aggregator_node)
    
    # Define the workflow edges
    # Start with supervisor
    workflow.add_edge(START, "supervisor")
    
    # From supervisor, route to appropriate nodes or end
    workflow.add_conditional_edges(
        "supervisor",
        supervisor_router,  # Supervisor returns the routing decision string
        {
            "relevance_analyzer": "relevance_analyzer",
            "pain_point_researcher": "pain_point_researcher",
            "value_matcher": "value_matcher",
            "email_writer": "email_writer",
            "followup_strategist": "followup_strategist",
            "aggregator": "aggregator",
            "__end__": END
        }
    )
    
    # After each agent node, return to supervisor for next routing decision
    workflow.add_edge("relevance_analyzer", "supervisor")
    workflow.add_edge("pain_point_researcher", "supervisor")
    workflow.add_edge("value_matcher", "supervisor")
    workflow.add_edge("email_writer", "supervisor")
    workflow.add_edge("followup_strategist", "supervisor")
    workflow.add_edge("aggregator", "supervisor")
    
    # Compile the workflow
    if checkpointer:
        logger.info("Compiling workflow with checkpointer")
        compiled = workflow.compile(checkpointer=checkpointer)
    else:
        logger.info("Compiling workflow without checkpointer")
        compiled = workflow.compile()
    
    if debug:
        logger.info("Workflow compiled in debug mode")
        # Could add visualization or debugging hooks here
    
    return compiled

async def execute_email_generation(
    lead: Any,
    business_profile: Any,
    requirements: Any,
    request_id: str,
    checkpointer: Optional[MemorySaver] = None
) -> Dict[str, Any]:
    """
    Execute the email generation workflow with given inputs.
    
    Args:
        lead: Lead information
        business_profile: Business context
        requirements: Email requirements
        request_id: Unique request identifier
        checkpointer: Optional checkpointer for persistence
        
    Returns:
        Workflow execution result
    """
    logger.info(f"Executing email generation for request {request_id}")
    
    # Create workflow
    workflow = create_email_generation_workflow(checkpointer)
    
    # Prepare initial state
    initial_state = {
        "request_id": request_id,
        "lead": lead,
        "business_profile": business_profile,
        "requirements": requirements,
        "current_stage": "start",
        "start_time": datetime.utcnow().isoformat(),  # Store as string to avoid serialization issues
        "agent_results": [],
        "errors": [],
        "processing_times": {},
        "confidence_scores": {},
        "quality_gates_passed": {},
        "recommendations": [],
        "intermediate_results": {}
    }
    
    # Configuration for execution
    config = {
        "configurable": {
            "thread_id": request_id  # Use request ID as thread ID for persistence
        }
    }
    
    try:
        # Execute workflow with streaming
        logger.info("Starting workflow execution")
        result = await workflow.ainvoke(initial_state, config)
        
        # Extract final result
        final_result = result.get("final_result")
        if final_result:
            logger.info(f"Workflow completed successfully for {request_id}")
            return {
                "status": "completed",
                "result": final_result,
                "processing_time": result.get("total_processing_time", 0)
            }
        else:
            logger.error(f"No final result generated for {request_id}")
            return {
                "status": "error",
                "error": "No result generated",
                "errors": result.get("errors", [])
            }
            
    except Exception as e:
        logger.error(f"Workflow execution error: {str(e)}")
        return {
            "status": "error",
            "error": str(e),
            "errors": [f"Workflow execution failed: {str(e)}"]
        }

async def execute_with_streaming(
    lead: Any,
    business_profile: Any,
    requirements: Any,
    request_id: str,
    checkpointer: Optional[MemorySaver] = None
):
    """
    Execute workflow with streaming updates.
    
    Yields progress updates as the workflow executes.
    
    Args:
        lead: Lead information
        business_profile: Business context
        requirements: Email requirements
        request_id: Unique request identifier
        checkpointer: Optional checkpointer
        
    Yields:
        Progress updates from workflow execution
    """
    logger.info(f"Executing with streaming for request {request_id}")
    
    # Create workflow
    workflow = create_email_generation_workflow(checkpointer)
    
    # Prepare initial state
    initial_state = {
        "request_id": request_id,
        "lead": lead,
        "business_profile": business_profile,
        "requirements": requirements,
        "current_stage": "start",
        "start_time": datetime.utcnow().isoformat(),  # Store as string to avoid serialization issues
        "agent_results": [],
        "errors": [],
        "processing_times": {},
        "confidence_scores": {},
        "quality_gates_passed": {},
        "recommendations": [],
        "intermediate_results": {}
    }
    
    # Configuration
    config = {
        "configurable": {
            "thread_id": request_id
        }
    }
    
    try:
        # Stream execution updates
        async for event in workflow.astream(initial_state, config):
            # Extract relevant update information
            if "current_stage" in event:
                yield {
                    "type": "stage_update",
                    "stage": event["current_stage"],
                    "timestamp": datetime.utcnow().isoformat()
                }
            
            if "agent_results" in event and event["agent_results"]:
                latest_result = event["agent_results"][-1]
                yield {
                    "type": "agent_complete",
                    "agent": latest_result.agent_name,
                    "output": latest_result.output,
                    "confidence": latest_result.confidence_score,
                    "timestamp": datetime.utcnow().isoformat()
                }
            
            if "final_result" in event:
                yield {
                    "type": "complete",
                    "result": event["final_result"],
                    "timestamp": datetime.utcnow().isoformat()
                }
                
    except Exception as e:
        logger.error(f"Streaming execution error: {str(e)}")
        yield {
            "type": "error",
            "error": str(e),
            "timestamp": datetime.utcnow().isoformat()
        }