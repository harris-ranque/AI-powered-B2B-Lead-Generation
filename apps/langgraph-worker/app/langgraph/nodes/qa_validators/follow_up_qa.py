"""Follow-Up Sequence QA Validator - focused on ~6 follow-up-specific rules."""
from typing import List, Any, Dict
from langchain_core.prompts import ChatPromptTemplate
from .models import FollowUpQAResult

FOLLOW_UP_QA_PROMPT = ChatPromptTemplate.from_messages([
    ("system", """You are a follow-up email sequence specialist. Validate ONLY the follow-up emails against these rules.

RULES (apply penalties to follow_up_score starting from 1.0):

1. COMPANY NAME IN EVERY FOLLOW-UP (-0.1 capped):
   - Every follow-up subject AND body MUST include: {company_short_name}
   - Set company_name_present per follow-up
   - NEVER allow street addresses or sub-location labels as substitutes

2. WORD ORDER IN SUBJECTS:
   - "{{idea/hook}} for {{company_short_name}}" - idea first, company at end
   - WRONG: "Hi Sarah, RevCo follow-up idea"
   - RIGHT: "Hi Sarah, one follow-up idea for RevCo"

3. USE-CASE FAMILY CONSISTENCY (set use_case_consistent):
   - Follow-ups MUST stay in the same use-case family as the primary email
   - Follow-up 1: sharpen cost of delay inside same problem
   - Follow-up 2: narrower angle or close-the-loop on same problem
   - Flag follow-ups that introduce a new service family or product angle

4. FOLLOW-UP LENGTH:
   - Target: 60-110 words per follow-up
   - Flag overlength follow-ups

5. NO HYPHENS (set has_hyphens=true if ANY found):
   - Same rule as primary: no hyphens anywhere

6. FOLLOW-UP STRUCTURE:
   - Opening: 1 sentence personalized hook
   - Body: 2-3 short sentences
   - CTA: 1 sentence direct ask
   - No closing or signature in generated content

B-TIER ({lead_tier}): If B-tier, skip deep consistency checks. Company name rule still active."""),
    ("human", """Validate these follow-up emails:

Company Short Name: {company_short_name}
Contact First Name: {contact_first_name}
Lead Tier: {lead_tier}

PRIMARY EMAIL (read-only, for consistency check):
Subject: {primary_subject}
Body: {primary_body}

FOLLOW-UP EMAILS:
{follow_ups_text}

Check every rule per follow-up. Flag every issue.""")
])


async def run_follow_up_qa(
    llm: Any,
    follow_ups: List[Dict[str, str]],
    primary_subject: str,
    primary_body: str,
    company_short_name: str,
    contact_first_name: str,
    lead_tier: str,
    callbacks: List,
) -> FollowUpQAResult:
    """Run focused follow-up QA. Returns FollowUpQAResult.

    If no follow-ups exist, returns a passing default without calling the LLM.
    """
    if not follow_ups:
        return FollowUpQAResult(
            follow_up_score=1.0,
            has_hyphens=False,
            company_name_present=[],
            use_case_consistent=True,
            issues=[],
            suggestions=[],
        )

    follow_ups_text = ""
    for i, fu in enumerate(follow_ups, 1):
        follow_ups_text += f"Follow-Up {i}:\n"
        follow_ups_text += f"  Subject: {fu.get('subject', '')}\n"
        follow_ups_text += f"  Body: {fu.get('body', '')}\n\n"

    messages = FOLLOW_UP_QA_PROMPT.format_messages(
        company_short_name=company_short_name,
        contact_first_name=contact_first_name,
        lead_tier=lead_tier,
        primary_subject=primary_subject,
        primary_body=primary_body,
        follow_ups_text=follow_ups_text,
    )
    result: FollowUpQAResult = await llm.ainvoke(
        messages, config={"callbacks": callbacks}
    )
    return result
