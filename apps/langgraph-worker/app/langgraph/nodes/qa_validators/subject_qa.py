"""Subject Line QA Validator - focused on ~10 subject-specific rules."""
from typing import List, Any
from langchain_core.prompts import ChatPromptTemplate
from .models import SubjectQAResult

SUBJECT_QA_PROMPT = ChatPromptTemplate.from_messages([
    ("system", """You are a subject line quality specialist. Validate ONLY the email subject line against these rules.

RULES (apply penalties to subject_score starting from 1.0):

1. NO HYPHENS (set has_hyphens=true if ANY hyphen found, -0.3):
   - Format MUST be "Hi [FirstName]," or "Hi [FirstName]:"
   - Any hyphen = instant failure

2. FORMAT:
   - MUST start with "Hi [FirstName]" (first name only)
   - MUST use comma or colon after name
   - Total length MUST be under 60 characters (set under_60_chars accordingly)

3. COMPANY IDENTITY (set has_company_identity, -0.15 if missing):
   - MUST include company short name: {company_short_name}

4. WORD ORDER (set correct_word_order, -0.1 if wrong):
   - Structure: "{{idea/hook}} for {{company_short_name}}"
   - Idea FIRST, company at END
   - WRONG: "Hi Sarah, RevCo onboarding gap"
   - RIGHT: "Hi Sarah, one onboarding gap for RevCo"

5. SUBJECT-BODY ALIGNMENT (set alignment_with_body, -0.1 if misaligned):
   - Subject MUST preview the same specific problem angle as the body
   - Vague subjects that could apply to any email = misaligned

6. NO GENERIC PHRASES (-0.1):
   - Ban: "touching base", "following up", "follow up", "checking in", "quick question"

7. NATURALNESS:
   - Should sound like a natural email note, not a marketing headline
   - Penalize over-constructed, compressed, or overly clever subjects

8. CERTAINTY LANGUAGE:
   - Prefer "potential", "possible", "may be" when research is limited
   - Penalize "found", "spotted", "discovered" when unsupported

9. VAGUE SUBJECT PENALTY (-0.1):
   - Generic stems like "one thing that may be slipping" without specificity

B-TIER ({lead_tier}): If B-tier, skip personalization depth checks. Company identity still required.

Score subject_score from 0-1 after all penalties. Set subject_effective=true if score >= 0.60."""),
    ("human", """Validate this subject line:

Subject: {subject}
Company Short Name: {company_short_name}
Contact First Name: {contact_first_name}
Lead Tier: {lead_tier}

Body (read-only, for alignment check):
{body}

Check every rule. Flag every issue.""")
])


async def run_subject_qa(
    llm: Any,
    subject: str,
    body: str,
    company_short_name: str,
    contact_first_name: str,
    lead_tier: str,
    callbacks: List,
) -> SubjectQAResult:
    """Run focused subject line QA. Returns SubjectQAResult."""
    messages = SUBJECT_QA_PROMPT.format_messages(
        subject=subject,
        body=body,
        company_short_name=company_short_name,
        contact_first_name=contact_first_name,
        lead_tier=lead_tier,
    )
    result: SubjectQAResult = await llm.ainvoke(
        messages, config={"callbacks": callbacks}
    )

    # Programmatic check: contact name vs company name collision
    if (
        contact_first_name
        and company_short_name
        and contact_first_name.lower().strip() in company_short_name.lower().strip()
    ):
        result = result.model_copy(update={
            "subject_score": min(result.subject_score, 0.30),
            "subject_effective": False,
            "issues": [
                *result.issues,
                f"Contact name '{contact_first_name}' matches company name '{company_short_name}' — likely bad lead data",
            ],
        })

    return result
