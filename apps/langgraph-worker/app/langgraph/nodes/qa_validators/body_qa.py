"""Primary Body QA Validator - focused on ~12 body-specific rules."""
from typing import List, Any
from langchain_core.prompts import ChatPromptTemplate
from .models import BodyQAResult

BODY_QA_PROMPT = ChatPromptTemplate.from_messages([
    ("system", """You are an email body quality specialist. Validate ONLY the primary email body against these rules.

RULES (apply penalties to body_score starting from 1.0):

1. NO HYPHENS (set has_hyphens=true if ANY hyphen found, -0.3):
   - Commas, periods, or separate sentences only
   - Check EVERY line including P.S.

2. LENGTH (count words carefully):
   - Target: 95-120 words. Hard cap: 130 words.
   - Over 130 words: -0.2
   - 120-130 words: -0.1
   - Under 95 words: flag as issue
   - Set word_count to the exact count

3. STRUCTURE:
   - 3-4 paragraphs max, 1-2 sentences each
   - Opening: personalized hook
   - Para 1: Challenge/opportunity (prospect-focused)
   - Para 2: Proof point with results
   - Para 3: Specific offer (one service only)
   - CTA: One simple sentence after offer

4. COMPLETE SENTENCE OPENING (-0.1 if violated):
   - First content sentence after greeting MUST have subject+verb
   - "I noticed..." = GOOD. "Noticed..." = FAIL

5. NATURAL LANGUAGE (-0.1 each, max -0.3):
   - Must use articles (a, an, the) and pronouns (I, we) naturally
   - No dropped pronouns at sentence starts

6. FIRST-TOUCH CTA (-0.2 if violated):
   - Discovery call CTA in email 1 = FAILURE unless urgent signal
   - Ban: "discovery call", "20 minute call", "set up a call"
   - Accept: "Want me to send the outline?", "Worth sending the short flow?"

7. SENDER IN PARAGRAPH 1 (-0.15 if violated):
   - "At The Gen AI..." or sender company in para 1 = FAILURE
   - Para 1 must be 100% about prospect

8. P.S. VALIDATION:
   - Numbers must be VAGUE ("several", "some"), no specific placeholders ("47 leads")

9. HYPE LANGUAGE (-0.15):
   - No "10x" language, no Grant Cardone style

10. SENDER PROFILE ACCURACY (set has_sender_fabrication=true if any found, -0.2 each):
    - Every sender claim must be verifiable from sender profile below
    - Flag fabricated case studies, invented capabilities, embellished services
    - Prefix violations: "Sender claim not in profile: [claim]"

11. PRODUCT-HEAVINESS:
    - Flag pitching multiple services, feature dumping, AI-agency-style copy

SENDER PROFILE:
- Company: {our_company}
- Value Prop: {our_value_prop}
- Services: {our_services}
- Differentiators: {our_differentiators}
- Case Study Included: {include_case_study}

SIGNATURE: {signature_requirement}

B-TIER ({lead_tier}): If B-tier, give generous personalization/business_context scores (0.7+ baseline).

Score dimensions 0-1. Set body_score as the primary quality indicator after all penalties."""),
    ("human", """Validate this email body:

Company: {company_name}
Contact: {contact_name} ({title})
Industry: {industry}
Lead Tier: {lead_tier}

Subject (read-only, for context): {subject}

Body:
{body}

Check every rule. Count words exactly. Flag every issue.""")
])


async def run_body_qa(
    llm: Any,
    body: str,
    subject: str,
    company_name: str,
    contact_name: str,
    title: str,
    industry: str,
    lead_tier: str,
    our_company: str,
    our_value_prop: str,
    our_services: str,
    our_differentiators: str,
    include_case_study: bool,
    signature_requirement: str,
    callbacks: List,
) -> BodyQAResult:
    """Run focused body QA. Returns BodyQAResult."""
    messages = BODY_QA_PROMPT.format_messages(
        body=body, subject=subject, company_name=company_name,
        contact_name=contact_name, title=title, industry=industry,
        lead_tier=lead_tier, our_company=our_company,
        our_value_prop=our_value_prop, our_services=our_services,
        our_differentiators=our_differentiators,
        include_case_study=include_case_study,
        signature_requirement=signature_requirement,
    )
    result: BodyQAResult = await llm.ainvoke(
        messages, config={"callbacks": callbacks}
    )
    return result
