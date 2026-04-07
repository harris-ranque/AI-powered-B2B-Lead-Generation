"""Service Match QA Validator - ensures email uses the assigned service/pain point."""
from typing import List, Any
from langchain_core.prompts import ChatPromptTemplate
from .models import ServiceMatchQAResult

SERVICE_MATCH_QA_PROMPT = ChatPromptTemplate.from_messages([
    ("system", """You are a service-match compliance validator. Check whether the email uses the ASSIGNED service and pain point.

RULES (apply penalties to service_match_score starting from 1.0):

1. SERVICE MENTIONED (set service_mentioned, -0.20 if false):
   - The email body must reference the assigned service concept.
   - Does NOT need to be the exact string — a natural synonym or description of the service is fine.
   - Example: assigned "voice agent" — email says "phone answering assistant" = mentioned.
   - Example: assigned "accounting AI" — email says "voice agent for FAQ calls" = NOT mentioned.

2. PAIN POINT GROUNDED (set pain_point_grounded, -0.15 if false):
   - The email must connect to the assigned pain point, not a different one.
   - The email should address the specific problem described, not a generic or tangential one.

3. NO FABRICATION (set has_fabrication=true, -0.15 if true):
   - The email must not introduce pain points or claims not present in the BI research output.
   - Referencing the assigned pain point is fine — inventing new, unsupported claims is not.

Score service_match_score from 0-1 after all penalties."""),
    ("human", """Validate this email against the assigned angle.

ASSIGNED SERVICE: {assigned_service}
ASSIGNED PAIN POINT: {assigned_pain_point}
MATCH RATIONALE: {match_rationale}

EMAIL BODY:
{body}

EMAIL SUBJECT:
{subject}

BI PAIN POINTS (for fabrication check):
{bi_pain_points}

Check every rule. Flag every issue.""")
])


def _neutral_result() -> ServiceMatchQAResult:
    """Return a neutral pass when no service was assigned (legacy fallback)."""
    return ServiceMatchQAResult(
        service_match_score=0.80,
        service_mentioned=True,
        pain_point_grounded=True,
        has_fabrication=False,
        assigned_service="",
        assigned_pain_point="",
        issues=[],
        suggestions=[],
    )


async def run_service_match_qa(
    llm: Any,
    body: str,
    subject: str,
    assigned_service: str,
    assigned_pain_point: str,
    match_rationale: str,
    bi_pain_points: List[str],
    callbacks: List,
) -> ServiceMatchQAResult:
    """Run service match QA. Returns ServiceMatchQAResult."""
    # If no assigned service (matcher fallback), return neutral pass
    if not assigned_service:
        return _neutral_result()

    messages = SERVICE_MATCH_QA_PROMPT.format_messages(
        assigned_service=assigned_service,
        assigned_pain_point=assigned_pain_point,
        match_rationale=match_rationale or "No rationale provided",
        body=body,
        subject=subject,
        bi_pain_points="\n".join(f"- {pp}" for pp in bi_pain_points[:5]) or "No pain points available",
    )
    result: ServiceMatchQAResult = await llm.ainvoke(
        messages, config={"callbacks": callbacks}
    )
    return result
