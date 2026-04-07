"""Service Matcher Agent - pure transformer that maps BI pain points to sender services."""
import time
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field, ConfigDict
from langchain_core.prompts import ChatPromptTemplate
from ...utils.logger import setup_logger
from ...utils.config import get_settings
from ...utils.research_clients import ClientRegistry
from ...utils.analytics import capture_event
from ..state import EmailGenerationState

logger = setup_logger(__name__)
settings = get_settings()


class ServiceMatch(BaseModel):
    """A single pain point to service pairing."""
    model_config = ConfigDict(extra="forbid")
    pain_point: str = Field(..., description="Exact pain point string from BI output (verbatim)")
    service: str = Field(..., description="Exact service name from business_profile.services")
    rationale: str = Field(..., description="1-sentence why this pain point + service fit")
    confidence: float = Field(..., ge=0, le=1, description="Match confidence 0-1")


class ServiceMatcherOutput(BaseModel):
    """Ranked service matches with unmatched items."""
    model_config = ConfigDict(extra="forbid")
    ranked_matches: List[ServiceMatch] = Field(..., max_length=3, description="Up to 3 matches, descending confidence")
    unmatched_pain_points: List[str] = Field(default_factory=list, description="Pain points with no service fit")
    unmatched_services: List[str] = Field(default_factory=list, description="Services with no pain point match")


SERVICE_MATCHER_PROMPT = ChatPromptTemplate.from_messages([
    ("system", """You are a service-to-pain-point matcher. Your ONLY job is to map business pain points (from research) to the sender's services.

RULES:
1. Use the EXACT pain point string from the input — do not rephrase, summarize, or synthesize.
2. Use the EXACT service name from the sender's service list — do not rephrase.
3. Only include matches where the pain point genuinely supports that service. Confidence guide:
   - >0.7: strong, obvious fit (pain point directly describes the problem this service solves)
   - 0.4-0.7: plausible fit (pain point is in the same domain, service could help)
   - <0.4: do not include — weak or forced
4. If a pain point does not match any service, add it to unmatched_pain_points.
5. If a service has no matching pain point, add it to unmatched_services.
6. Do NOT force matches. An honest "no match" is better than a fabricated pairing.
7. Return at most 3 ranked matches, sorted by confidence descending.
8. The rationale must be one sentence explaining WHY this specific pain point maps to this specific service."""),
    ("human", """Match these pain points to these services.

PAIN POINTS (from prospect research):
{pain_points_list}

SENDER'S SERVICES:
{services_list}

CONTEXT:
- Prospect industry: {industry}
- Prospect company: {company_name}

Return ranked matches (up to 3), plus any unmatched pain points and unmatched services.""")
])


async def service_matcher_agent_node(state: EmailGenerationState) -> Dict[str, Any]:
    """
    Pure transformer node: maps BI pain points to sender's services.
    No external API calls — only reads state and runs one LLM call.
    """
    start_time = time.time()

    business_intelligence = state.get("business_intelligence", {})
    business_profile = state["business_profile"]
    lead = state["lead"]

    pain_points = business_intelligence.get("pain_points", [])
    services = business_profile.services or []

    # Fast path: if either side is empty, skip the LLM call
    if not pain_points or not services:
        empty_result = {
            "ranked_matches": [],
            "unmatched_pain_points": pain_points,
            "unmatched_services": list(services),
        }
        logger.warning(f"Service matcher skipped: pain_points={len(pain_points)}, services={len(services)}")
        return {
            "service_matches": empty_result,
            "processing_times": {**state.get("processing_times", {}), "service_matcher": time.time() - start_time},
        }

    # Build LLM with structured output
    provider_keys = state.get("provider_keys")
    using_user_keys = provider_keys is not None
    provider_key_map = provider_keys if isinstance(provider_keys, dict) else {}
    openai_api_key = provider_key_map.get("openai") if using_user_keys else None

    registry = ClientRegistry.get_instance()
    matcher_model = settings.default_model
    llm = registry.get_openai_client(
        api_key=openai_api_key,
        model=matcher_model,
        temperature=0.2,
        max_completion_tokens=settings.clamp_tokens(1000),
        require_user_key=using_user_keys,
    ).with_structured_output(ServiceMatcherOutput)

    callbacks = [state["llm_callback"]] if state.get("llm_callback") else []

    messages = SERVICE_MATCHER_PROMPT.format_messages(
        pain_points_list="\n".join(f"- {pp}" for pp in pain_points),
        services_list="\n".join(f"- {s}" for s in services),
        industry=getattr(lead, "industry", "") or "Not specified",
        company_name=lead.company_name,
    )

    try:
        matcher_output: ServiceMatcherOutput = await llm.ainvoke(
            messages, config={"callbacks": callbacks}
        )
        result_dict = matcher_output.model_dump()

        # Filter out low-confidence matches
        result_dict["ranked_matches"] = [
            m for m in result_dict["ranked_matches"] if m["confidence"] >= 0.4
        ]
        # Sort by confidence descending
        result_dict["ranked_matches"].sort(key=lambda m: m["confidence"], reverse=True)
        # Cap at 3
        result_dict["ranked_matches"] = result_dict["ranked_matches"][:3]

        logger.info(
            f"Service matcher: {len(result_dict['ranked_matches'])} matches, "
            f"{len(result_dict['unmatched_services'])} unmatched services"
        )
    except Exception as e:
        logger.error(f"Service matcher LLM call failed: {e}")
        result_dict = {
            "ranked_matches": [],
            "unmatched_pain_points": pain_points,
            "unmatched_services": list(services),
        }

    execution_time = time.time() - start_time
    capture_event("service_matcher_completed", {
        "request_id": state.get("request_id"),
        "matches_found": len(result_dict["ranked_matches"]),
        "unmatched_services": len(result_dict["unmatched_services"]),
        "execution_time_ms": execution_time * 1000,
    })

    return {
        "service_matches": result_dict,
        "processing_times": {**state.get("processing_times", {}), "service_matcher": execution_time},
    }
