"""
Aggregator Node for LangGraph workflow
Compiles final results and prepares response
"""
import time
from typing import Dict, Any, List
from datetime import datetime
from ...utils.logger import setup_logger
from ...utils.analytics import capture_event, capture_error
from ...models.lead_models import EmailGenerationResult, AgentResult
from ..state import EmailGenerationState

logger = setup_logger(__name__)


def _first_non_empty_string(values: List[Any]) -> str:
    """Return the first non-empty string from the provided values."""

    for value in values:
        if isinstance(value, str):
            text = value.strip()
            if text:
                return text
    return ""


def _ensure_str_list(value: Any) -> List[str]:
    """Convert the provided value into a clean list of strings."""

    if isinstance(value, list):
        cleaned = [str(item).strip() for item in value if isinstance(item, str) and item.strip()]
        return cleaned

    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []

    return []


def _normalize_competitors(value: Any) -> List[Dict[str, Any]]:
    """Normalize competitor insights into serializable dictionaries."""

    normalized: List[Dict[str, Any]] = []

    if not isinstance(value, list):
        return normalized

    for item in value:
        if hasattr(item, "model_dump"):
            normalized.append(item.model_dump())
        elif isinstance(item, dict):
            normalized.append(item)
        elif isinstance(item, str) and item.strip():
            normalized.append({"name": item.strip()})

    return normalized

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
    perf_start = time.time()
    logger.info(f"Starting result aggregation for request {state['request_id']}")
    lead = state["lead"]
    analytics_context = {
        "request_id": state.get("request_id"),
        "lead_id": getattr(lead, "id", None),
        "company_name": getattr(lead, "company_name", None),
        "user_id": state.get("user_id"),
        "user_tier": state.get("user_tier", "free"),
    }
    capture_event("aggregator_started", analytics_context)
    
    try:
        # Calculate total processing time
        end_time = datetime.utcnow()
        start_time_str = state.get("start_time")
        if start_time_str:
            try:
                workflow_start = datetime.fromisoformat(start_time_str.replace('Z', '+00:00'))
                total_time = (end_time - workflow_start).total_seconds()
            except (ValueError, AttributeError):
                total_time = 0.0
        else:
            total_time = 0.0
        
        # Compile recommendations based on analysis
        recommendations = list(state.get("recommendations", []))
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
        
        business_context_raw = state.get("business_context") or {}
        business_context: Dict[str, Any] = (
            business_context_raw.copy() if isinstance(business_context_raw, dict) else {}
        )

        business_intelligence_raw = state.get("business_intelligence") or {}
        if isinstance(business_intelligence_raw, dict) and business_intelligence_raw:
            normalized_bi = business_intelligence_raw.copy()

            # Ensure list fields are consistently formatted
            normalized_bi["key_services"] = _ensure_str_list(normalized_bi.get("key_services"))
            normalized_bi["recent_news"] = _ensure_str_list(normalized_bi.get("recent_news"))
            normalized_bi["pain_points"] = _ensure_str_list(normalized_bi.get("pain_points"))
            normalized_bi["technology_stack"] = _ensure_str_list(normalized_bi.get("technology_stack"))
            normalized_bi["data_sources"] = _ensure_str_list(normalized_bi.get("data_sources"))

            # Normalize competitors into serializable dictionaries
            normalized_bi["competitors"] = _normalize_competitors(
                normalized_bi.get("competitors", [])
            )

            # Ensure research metadata is a dictionary
            research_metadata = normalized_bi.get("research_metadata")
            if not isinstance(research_metadata, dict):
                normalized_bi["research_metadata"] = {}

            # Provide fallbacks for tier and confidence
            if not normalized_bi.get("research_tier") and state.get("research_tier"):
                normalized_bi["research_tier"] = state.get("research_tier")

            confidence_scores = state.get("confidence_scores")
            if (
                not normalized_bi.get("confidence_score")
                and isinstance(confidence_scores, dict)
                and confidence_scores.get("research_confidence") is not None
            ):
                normalized_bi["confidence_score"] = confidence_scores["research_confidence"]

            # Align overview fields used by downstream consumers
            company_overview = normalized_bi.get("company_overview") or ""
            if company_overview:
                normalized_bi.setdefault("summary", company_overview)
                normalized_bi.setdefault("company_profile", company_overview)

            business_context.update(normalized_bi)

        lead = state["lead"]
        lead_description = getattr(lead, "description", "") or ""
        lead_industry = getattr(lead, "industry", "") or ""

        company_overview = _first_non_empty_string(
            [
                business_context.get("company_overview"),
                business_context.get("summary"),
                business_context.get("company_profile"),
                business_context.get("comprehensive_report"),
                lead_description,
            ]
        )

        industry_focus = _first_non_empty_string(
            [
                business_context.get("industry_focus"),
                business_context.get("industry_insights"),
                lead_industry,
            ]
        )

        business_model = _first_non_empty_string([business_context.get("business_model")])
        target_customers = _first_non_empty_string([business_context.get("target_customers")])
        competitive_landscape = _first_non_empty_string(
            [business_context.get("competitive_landscape"), business_context.get("industry_insights")]
        )
        growth_stage = _first_non_empty_string([business_context.get("growth_stage")])
        industry_insights_text = _first_non_empty_string([business_context.get("industry_insights")])

        recent_news = _ensure_str_list(business_context.get("recent_news"))
        pain_points = _ensure_str_list(business_context.get("pain_points"))
        technology_stack = _ensure_str_list(business_context.get("technology_stack"))
        key_services = business_context.get("key_services")
        if not isinstance(key_services, list):
            key_services = _ensure_str_list(key_services)

        data_sources = _ensure_str_list(business_context.get("data_sources"))
        research_metadata = business_context.get("research_metadata")
        if not isinstance(research_metadata, dict):
            research_metadata = {}

        lead_analysis: Dict[str, Any] = {
            "company_analysis": company_overview or f"Analysis of {lead.company_name}",
            "company_profile": company_overview,
            "company_overview": company_overview,
            "summary": company_overview,
            "description": company_overview,
            "industry_focus": industry_focus,
            "business_model": business_model,
            "key_services": key_services,
            "target_customers": target_customers,
            "pain_points": pain_points,
            "technology_stack": technology_stack,
            "competitive_landscape": competitive_landscape,
            "growth_stage": growth_stage,
            "recent_news": recent_news,
            "industry_insights": industry_insights_text,
            "competitors": business_context.get("competitors", []),
            "research_tier": business_context.get("research_tier"),
            "confidence_score": business_context.get("confidence_score"),
            "data_sources": data_sources,
            "research_metadata": research_metadata,
            "qualification_factors": relevance_analysis.get("key_factors", []),
            "opportunities": relevance_analysis.get("opportunities", []),
            "red_flags": relevance_analysis.get("red_flags", []),
        }

        if business_context.get("comprehensive_report"):
            lead_analysis["comprehensive_report"] = business_context.get("comprehensive_report")

        # Preserve the full business context for downstream consumers that rely on nested data
        lead_analysis["business_context"] = business_context

        # Create final EmailGenerationResult
        result = EmailGenerationResult(
            request_id=state["request_id"],
            lead_analysis=lead_analysis,
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
        
        execution_time = time.time() - perf_start
        
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
        capture_event(
            "aggregator_completed",
            {
                **analytics_context,
                "total_duration_ms": total_time * 1000,
                "relevance_score": relevance_score,
                "recommendations_count": len(recommendations),
                "email_generated": bool(state.get("primary_email")),
                "follow_up_generated": bool(state.get("follow_up_sequence")),
                "aggregator_duration_ms": execution_time * 1000,
                "deep_research_used": state.get("deep_research_triggered", False),
            },
        )
        
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
        execution_time = time.time() - perf_start
        capture_error(
            "aggregator_failed",
            e,
            {
                **analytics_context,
                "aggregator_duration_ms": execution_time * 1000,
            },
        )
        
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
