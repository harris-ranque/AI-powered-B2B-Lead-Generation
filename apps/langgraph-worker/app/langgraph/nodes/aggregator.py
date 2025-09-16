"""
Aggregator Node for LangGraph workflow
Compiles final results and prepares response
"""
import time
from typing import Dict, Any
from datetime import datetime
from ...utils.logger import setup_logger
from ...models.lead_models import EmailGenerationResult, AgentResult
from ..state import EmailGenerationState

logger = setup_logger(__name__)

async def aggregator_node(state: EmailGenerationState) -> Dict[str, Any]:
    """
    Aggregate all results and prepare final response.
    
    This node:
    - Compiles all agent results
    - Calculates total processing time
    - Generates recommendations
    - Prepares final EmailGenerationResult
    
    Args:
        state: Current workflow state
        
    Returns:
        Updated state with final results
    """
    start_time = time.time()
    logger.info(f"Starting result aggregation for request {state['request_id']}")
    
    try:
        # Calculate total processing time
        end_time = datetime.utcnow()
        start_time_str = state.get("start_time")
        if start_time_str:
            try:
                start_time = datetime.fromisoformat(start_time_str.replace('Z', '+00:00'))
                total_time = (end_time - start_time).total_seconds()
            except (ValueError, AttributeError):
                total_time = 0.0
        else:
            total_time = 0.0
        
        # Compile recommendations based on analysis
        recommendations = state.get("recommendations", [])
        relevance_score = state.get("relevance_score", 0)
        
        # Add automatic recommendations based on score
        if relevance_score >= 0.8:
            recommendations.append("High-priority lead - immediate follow-up recommended")
            recommendations.append("Consider personalized demo or consultation offer")
        elif relevance_score >= 0.6:
            recommendations.append("Qualified lead - standard nurturing sequence recommended")
            recommendations.append("Focus on value demonstration and case studies")
        elif relevance_score >= 0.4:
            recommendations.append("Moderate fit - educational content may build interest")
            recommendations.append("Long-term nurturing approach suggested")
        else:
            recommendations.append("Low relevance - consider deprioritizing")
            recommendations.append("Add to general marketing list for future campaigns")
        
        # Add timing recommendations
        relevance_analysis = state.get("relevance_analysis", {})
        timing = relevance_analysis.get("timing", "")
        if "urgent" in timing.lower() or "immediate" in timing.lower():
            recommendations.append("Time-sensitive opportunity detected - prioritize outreach")
        
        # Create final EmailGenerationResult
        result = EmailGenerationResult(
            request_id=state["request_id"],
            lead_analysis={
                "company_analysis": f"Analysis of {state['lead'].company_name}",
                "industry_insights": f"Insights for {state['lead'].industry or 'business'} sector",
                "qualification_factors": relevance_analysis.get("key_factors", []),
                "opportunities": relevance_analysis.get("opportunities", []),
                "red_flags": relevance_analysis.get("red_flags", [])
            },
            relevance_score=relevance_score,
            pain_points_identified=state.get("pain_points", []),
            value_matches=state.get("value_matches", []),
            primary_email=state.get("primary_email"),
            follow_up_sequence=state.get("follow_up_sequence"),
            agent_results=state.get("agent_results", []),
            processing_time=total_time,
            recommendations=recommendations[:5],  # Limit to top 5 recommendations
            # Deep research metadata
            deep_research_used=state.get("deep_research_triggered", False),
            deep_research_reason=state.get("deep_research_reason"),
            additional_credits_used=max(0, state.get("research_credit_cost", 0) - __import__('app.config', fromlist=['CREDIT_COSTS']).CREDIT_COSTS['AI_ANALYSIS']),  # Subtract base AI_ANALYSIS cost
            missing_data_points=state.get("missing_data_points", []),
            data_completeness_score=state.get("base_data_validation_score", 1.0)
        )
        
        execution_time = time.time() - start_time
        
        # Create aggregator result
        aggregator_result = AgentResult(
            agent_name="Result Aggregator",
            role="Final compilation and recommendations",
            output=f"Compiled results from {len(state.get('agent_results', []))} agents with {len(recommendations)} recommendations",
            confidence_score=0.95,
            execution_time=execution_time
        )
        
        # Log summary
        logger.info(f"Aggregation complete:")
        logger.info(f"  - Relevance Score: {relevance_score:.2f}")
        logger.info(f"  - Pain Points: {len(state.get('pain_points', []))}")
        logger.info(f"  - Value Matches: {len(state.get('value_matches', []))}")
        logger.info(f"  - Email Generated: {'Yes' if state.get('primary_email') else 'No'}")
        logger.info(f"  - Follow-ups: {'Yes' if state.get('follow_up_sequence') else 'No'}")
        logger.info(f"  - Total Time: {total_time:.2f}s")
        logger.info(f"  - Recommendations: {len(recommendations)}")
        
        # Update state with final results
        return {
            "end_time": end_time.isoformat(),  # Store as string
            "total_processing_time": total_time,
            "final_result": result,
            "agent_results": [*state.get("agent_results", []), aggregator_result],
            "processing_times": {
                **state.get("processing_times", {}),
                "aggregator": execution_time
            },
            "current_stage": "complete",
            "recommendations": recommendations
        }
        
    except Exception as e:
        logger.error(f"Error in aggregator: {str(e)}")
        execution_time = time.time() - start_time
        
        # Create minimal result on error
        minimal_result = EmailGenerationResult(
            request_id=state["request_id"],
            lead_analysis={"error": str(e)},
            relevance_score=state.get("relevance_score", 0.5),
            pain_points_identified=state.get("pain_points", []),
            value_matches=state.get("value_matches", []),
            primary_email=state.get("primary_email"),
            follow_up_sequence=None,
            agent_results=state.get("agent_results", []),
            processing_time=execution_time,
            recommendations=["Error during aggregation - manual review recommended"],
            # Deep research metadata (preserve whatever was collected)
            deep_research_used=state.get("deep_research_triggered", False),
            deep_research_reason=state.get("deep_research_reason"),
            additional_credits_used=max(0, state.get("research_credit_cost", 0) - __import__('app.config', fromlist=['CREDIT_COSTS']).CREDIT_COSTS['AI_ANALYSIS']),
            missing_data_points=state.get("missing_data_points", []),
            data_completeness_score=state.get("base_data_validation_score", 1.0)
        )
        
        return {
            "final_result": minimal_result,
            "errors": [*state.get("errors", []), f"Aggregator error: {str(e)}"],
            "current_stage": "error",
            "total_processing_time": execution_time
        }