"""
Main LangGraph workflow for email generation
Orchestrates 3-agent architecture for optimal performance and quality
"""
import time
from typing import Dict, Any, Optional
from datetime import datetime
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver
from langchain_core.runnables import RunnableConfig
from ..utils.logger import setup_logger
from ..utils.analytics import capture_event, capture_error, create_llm_callback_handler
from .state import EmailGenerationState
from .nodes.business_intelligence_agent import business_intelligence_agent_node
from .nodes.email_generation_agent import email_generation_agent_node
from .nodes.quality_assurance_agent import quality_assurance_agent_node
from .nodes.aggregator import aggregator_node

logger = setup_logger(__name__)

# Cache compiled workflow at module level (reused across all requests)
_cached_workflow = None

def create_email_generation_workflow(
    checkpointer: Optional[MemorySaver] = None,
    debug: bool = False
) -> StateGraph:
    """
    Create the optimized 3-agent email generation workflow using LangGraph.
    
    This workflow implements a streamlined linear flow with the following agents:
    1. Business Intelligence Agent: Research + Analysis (Tavily→Perplexity)
    2. Email Generation Agent: Writing + Follow-up Strategy
    3. Quality Assurance Agent: Validation + Standards Enforcement
    
    Benefits:
    - 57% fewer LLM calls (3 vs 7 agents)
    - 50% faster execution (~25-30s vs 45-60s)
    - Better personalization with consolidated business context
    - Simpler maintenance and debugging
    
    Args:
        checkpointer: Optional checkpointer for state persistence
        debug: Enable debug mode for verbose output
        
    Returns:
        Compiled LangGraph workflow
    """
    logger.info("Creating optimized 3-agent email generation workflow")
    
    # Initialize the state graph
    workflow = StateGraph(EmailGenerationState)

    # Add the 3 optimized agents to the graph
    workflow.add_node("business_intelligence", business_intelligence_agent_node)
    workflow.add_node("email_generation", email_generation_agent_node)
    workflow.add_node("quality_assurance", quality_assurance_agent_node)
    workflow.add_node("aggregator", aggregator_node)

    # Define conditional routing functions for error-aware workflow
    def should_continue_after_bi(state: EmailGenerationState) -> str:
        """Route after BI agent: skip Email Gen if BI failed"""
        if state.get("current_stage") == "error":
            logger.warning("BI agent failed - skipping Email Generation and QA, going to aggregator")
            return "aggregator"
        return "email_generation"

    def should_continue_after_email(state: EmailGenerationState) -> str:
        """Route after Email Gen: skip QA if email generation failed or no email"""
        if state.get("current_stage") == "error" or not state.get("primary_email"):
            logger.warning("Email Generation failed or no email - skipping QA, going to aggregator")
            return "aggregator"
        return "quality_assurance"

    def should_retry_after_qa(state: EmailGenerationState) -> str:
        """
        Route after QA: decide whether to approve, retry, or reject.

        Hybrid quality strategy:
        - Score ≥0.60: Approve immediately (high quality)
        - Score 0.35-0.60: Retry up to 3 times with QA feedback (3 retry attempts)
        - Score <0.35: Reject immediately (poor quality, not worth retrying)
        """
        qa = state.get("quality_assessment", {})
        approval_status = qa.get("approval_status", "Unknown")
        quality_score = qa.get("overall_quality_score", 0)
        retry_count = state.get("retry_count", 0)
        max_retries = state.get("max_retries", 3)  # 4 total attempts (1 initial + 3 retries)

        # If approved or error state, go to aggregator
        if approval_status == "Approved" or state.get("current_stage") == "error":
            logger.info(f"QA {approval_status} - proceeding to aggregator (score={quality_score:.2f})")
            return "aggregator"

        # If quality is too poor (<0.35), reject immediately without retry
        if quality_score < 0.35:
            logger.warning(f"QA score too low ({quality_score:.2f}) - rejecting without retry")
            return "aggregator"

        # If we have retries left and quality is in retry range (0.35-0.60), retry
        if retry_count < max_retries and 0.35 <= quality_score < 0.60:
            logger.info(f"QA needs improvement (score={quality_score:.2f}) - retry {retry_count + 1}/{max_retries}")
            return "retry_email_generation"

        # Otherwise, max retries exhausted, go to aggregator
        logger.warning(f"Max retries exhausted ({retry_count}/{max_retries}) - proceeding to aggregator (score={quality_score:.2f})")
        return "aggregator"

    # Define the error-aware conditional workflow with retry loop
    # Conditional flow: Start → BI → (if success) Email → (if success) QA → [Check quality]
    #                              → (if error) skip to aggregator              ↓
    #                                                                  ┌─ retry ←┘
    #                                                                  ↓
    #                                                              Email Gen (with feedback)
    #                                                                  ↓
    #                                                                 QA → approve/reject
    workflow.add_edge(START, "business_intelligence")
    workflow.add_conditional_edges(
        "business_intelligence",
        should_continue_after_bi,
        {
            "email_generation": "email_generation",
            "aggregator": "aggregator"
        }
    )
    workflow.add_conditional_edges(
        "email_generation",
        should_continue_after_email,
        {
            "quality_assurance": "quality_assurance",
            "aggregator": "aggregator"
        }
    )
    workflow.add_conditional_edges(
        "quality_assurance",
        should_retry_after_qa,
        {
            "retry_email_generation": "email_generation",  # Retry loop back to email gen
            "aggregator": "aggregator"  # Approve or reject final
        }
    )
    workflow.add_edge("aggregator", END)
    
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
    provider_keys: Optional[Any] = None,
    user_id: Optional[str] = None,
    checkpointer: Optional[MemorySaver] = None
) -> Dict[str, Any]:
    """
    Execute the optimized 3-agent email generation workflow.

    Flow: Business Intelligence → Email Generation → Quality Assurance

    Args:
        lead: Lead information
        business_profile: Business context
        requirements: Email requirements
        request_id: Unique request identifier
        checkpointer: Optional checkpointer for persistence

    Returns:
        Workflow execution result with quality-assured email
    """
    logger.info(f"Executing optimized 3-agent email generation for request {request_id}")
    workflow_start = time.time()
    provider_key_labels = sorted(provider_keys.keys()) if isinstance(provider_keys, dict) else []
    analytics_context = {
        "request_id": request_id,
        "lead_id": getattr(lead, "id", None),
        "company_name": getattr(lead, "company_name", None),
        "user_id": user_id,
        "provider_keys_supplied": provider_key_labels,
        "using_user_keys": bool(provider_keys),
    }
    capture_event("workflow_execution_started", analytics_context)

    # Create PostHog LLM callback handler for automatic LLM analytics
    llm_callback = create_llm_callback_handler(
        distinct_id=user_id,  # Convex user_id for cost attribution
        trace_id=request_id,  # Groups all LLM calls for this email generation
        properties={
            "request_id": request_id,
            "lead_id": getattr(lead, "id", None),
            "lead_company": getattr(lead, "company_name", None),
            "workflow": "email_generation",
            "using_user_keys": bool(provider_keys),
        }
    )

    # Use cached workflow (compile once, reuse for all requests)
    global _cached_workflow
    if _cached_workflow is None or checkpointer is not None:
        # Only rebuild if no cache exists or checkpointer is explicitly provided
        logger.info("Compiling workflow (first request or custom checkpointer)")
        _cached_workflow = create_email_generation_workflow(checkpointer)
    else:
        logger.debug("Reusing cached workflow (no compilation overhead)")

    workflow = _cached_workflow
    
    # Prepare initial state for 3-agent workflow
    initial_state = {
        "request_id": request_id,
        "lead": lead,
        "business_profile": business_profile,
        "requirements": requirements,
        "current_stage": "start",
        "start_time": datetime.utcnow().isoformat(),
        "agent_results": [],
        "errors": [],
        "processing_times": {},
        "confidence_scores": {},
        "quality_gates_passed": {},
        "provider_keys": provider_keys,
        "user_id": user_id,
        # PostHog LLM analytics callback (passed to all agent nodes)
        "llm_callback": llm_callback,
        # New fields for 3-agent architecture
        "business_intelligence": {},
        "primary_email": None,
        "follow_up_sequence": None,
        "email_metadata": {},
        "quality_assessment": {},
        "final_result": {},
        # Quality retry tracking
        "retry_count": 0,
        "max_retries": 3,  # Allow 4 total attempts (1 initial + 3 retries) for quality improvement
        "previous_quality_feedback": []
    }

    # Configuration for execution
    config = {
        "configurable": {
            "thread_id": request_id,  # Use request ID as thread ID for persistence
            "provider_keys": provider_keys,
            "user_id": user_id,
        }
    }
    
    try:
        # Execute optimized 3-agent workflow
        logger.info("Starting optimized 3-agent workflow execution")
        result = await workflow.ainvoke(initial_state, config)
        
        # Extract final result from quality assurance agent
        final_result = result.get("final_result")
        quality_assessment = result.get("quality_assessment", {})
        
        if final_result:
            # Calculate total processing time
            processing_times = result.get("processing_times", {})
            total_time = sum(processing_times.values())

            logger.info(f"3-agent workflow completed for {request_id}: "
                       f"Quality={quality_assessment.get('overall_quality_score', 0):.2f}, "
                       f"Approved={quality_assessment.get('approval_status', 'Unknown')}, "
                       f"Time={total_time:.2f}s")
            capture_event(
                "workflow_execution_completed",
                {
                    **analytics_context,
                    "duration_ms": (time.time() - workflow_start) * 1000,
                    "processing_time_ms": total_time * 1000,
                    "quality_score": quality_assessment.get("overall_quality_score", 0),
                    "approved": quality_assessment.get("approval_status") == "Approved",
                    "agents": 3,
                },
            )

            return {
                "status": "completed",
                "result": final_result,
                "processing_time": total_time,
                "quality_score": quality_assessment.get("overall_quality_score", 0),
                "approved": quality_assessment.get("approval_status") == "Approved",
                "lead_tier": result.get("lead_tier", "A"),
            }
        else:
            logger.error(f"No final result generated for {request_id}")
            return {
                "status": "error",
                "error": "No result generated from 3-agent workflow",
                "errors": result.get("errors", [])
            }

    except Exception as e:
        logger.error(f"Workflow execution error: {str(e)}")
        capture_error(
            "workflow_execution_failed",
            e,
            {
                **analytics_context,
                "duration_ms": (time.time() - workflow_start) * 1000,
            },
        )
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
    provider_keys: Optional[Any] = None,
    user_id: Optional[str] = None,
    checkpointer: Optional[MemorySaver] = None
):
    """
    Execute optimized 3-agent workflow with streaming updates.
    
    Yields progress updates as each agent completes:
    1. Business Intelligence Agent
    2. Email Generation Agent  
    3. Quality Assurance Agent
    
    Args:
        lead: Lead information
        business_profile: Business context
        requirements: Email requirements
        request_id: Unique request identifier
        checkpointer: Optional checkpointer
        
    Yields:
        Progress updates from 3-agent workflow execution
    """
    logger.info(f"Executing 3-agent workflow with streaming for request {request_id}")

    # Create PostHog LLM callback handler for automatic LLM analytics
    llm_callback = create_llm_callback_handler(
        distinct_id=user_id,
        trace_id=request_id,
        properties={
            "request_id": request_id,
            "lead_id": getattr(lead, "id", None),
            "lead_company": getattr(lead, "company_name", None),
            "workflow": "email_generation_streaming",
            "using_user_keys": bool(provider_keys),
        }
    )

    # Create workflow
    workflow = create_email_generation_workflow(checkpointer)

    # Prepare initial state for 3-agent workflow
    initial_state = {
        "request_id": request_id,
        "lead": lead,
        "business_profile": business_profile,
        "requirements": requirements,
        "current_stage": "start",
        "start_time": datetime.utcnow().isoformat(),
        "agent_results": [],
        "errors": [],
        "processing_times": {},
        "confidence_scores": {},
        "quality_gates_passed": {},
        "provider_keys": provider_keys,
        # PostHog LLM analytics callback (passed to all agent nodes)
        "llm_callback": llm_callback,
        "business_intelligence": {},
        "primary_email": None,
        "follow_up_sequence": None,
        "email_metadata": {},
        "quality_assessment": {},
        "final_result": {},
        # Quality retry tracking
        "retry_count": 0,
        "max_retries": 3,  # Allow 4 total attempts (1 initial + 3 retries) for quality improvement
        "previous_quality_feedback": []
    }

    # Configuration
    config = {
        "configurable": {
            "thread_id": request_id,
            "provider_keys": provider_keys,
            "user_id": user_id,
        }
    }
    
    try:
        # Stream execution updates from 3-agent workflow
        async for event in workflow.astream(initial_state, config):
            # Extract relevant update information for each agent
            if "current_stage" in event:
                stage = event["current_stage"]
                yield {
                    "type": "stage_update",
                    "stage": stage,
                    "timestamp": datetime.utcnow().isoformat()
                }
                
                # Provide stage-specific progress updates
                if stage == "business_intelligence_complete":
                    bi_data = event.get("business_intelligence", {})
                    yield {
                        "type": "business_intelligence_complete",
                        "relevance_score": bi_data.get("relevance_score", 0),
                        "research_tier": bi_data.get("research_tier", "unknown"),
                        "pain_points": len(bi_data.get("pain_points", [])),
                        "value_matches": len(bi_data.get("value_matches", [])),
                        "timestamp": datetime.utcnow().isoformat()
                    }
                elif stage == "email_generation_complete":
                    email_meta = event.get("email_metadata", {})
                    yield {
                        "type": "email_generation_complete",
                        "effectiveness": email_meta.get("estimated_effectiveness", 0),
                        "personalization_depth": email_meta.get("personalization_depth", "Unknown"),
                        "subject": event.get("primary_email", {}).get("subject", "") if event.get("primary_email") else "",
                        "timestamp": datetime.utcnow().isoformat()
                    }
                elif stage == "quality_assurance_complete":
                    qa_data = event.get("quality_assessment", {})
                    yield {
                        "type": "quality_assurance_complete",
                        "quality_score": qa_data.get("overall_quality_score", 0),
                        "approval_status": qa_data.get("approval_status", "Unknown"),
                        "issues_found": len(qa_data.get("quality_issues", [])),
                        "timestamp": datetime.utcnow().isoformat()
                    }
            
            if "agent_results" in event and event["agent_results"]:
                latest_result = event["agent_results"][-1]
                yield {
                    "type": "agent_complete",
                    "agent": latest_result.agent_name,
                    "output": latest_result.output,
                    "confidence": latest_result.confidence_score,
                    "execution_time": latest_result.execution_time,
                    "timestamp": datetime.utcnow().isoformat()
                }
            
            if "final_result" in event:
                final_result = event["final_result"]
                qa = event.get("quality_assessment", {})
                # Normalize Pydantic model to dict if needed
                try:
                    final_result_payload = final_result.model_dump(by_alias=True)  # type: ignore[attr-defined]
                except Exception:
                    try:
                        final_result_payload = final_result.dict(by_alias=True)  # type: ignore[attr-defined]
                    except Exception:
                        final_result_payload = final_result

                yield {
                    "type": "complete",
                    "result": final_result_payload,
                    "quality_score": qa.get("overall_quality_score", 0),
                    "approved": qa.get("approval_status") == "Approved",
                    "total_time": event.get("processing_times", {}).get("business_intelligence", 0)
                                 + event.get("processing_times", {}).get("email_generation", 0)
                                 + event.get("processing_times", {}).get("quality_assurance", 0),
                    "timestamp": datetime.utcnow().isoformat()
                }
                
    except Exception as e:
        logger.error(f"Streaming execution error: {str(e)}")
        yield {
            "type": "error",
            "error": str(e),
            "timestamp": datetime.utcnow().isoformat()
        }


# LangGraph Studio entry point - requires RunnableConfig parameter
def create_email_generation_workflow_studio(config: RunnableConfig) -> StateGraph:
    """
    LangGraph Studio compatible entry point.
    
    This function is required by LangGraph Studio which expects a function
    that takes exactly one argument: a RunnableConfig.
    
    Args:
        config: RunnableConfig required by LangGraph Studio
        
    Returns:
        StateGraph: The compiled workflow
    """
    # Extract debug flag from config if present
    debug = config.get("configurable", {}).get("debug", False) if config else False
    
    # Create workflow with default checkpointer for Studio
    checkpointer = MemorySaver()
    return create_email_generation_workflow(checkpointer, debug)
