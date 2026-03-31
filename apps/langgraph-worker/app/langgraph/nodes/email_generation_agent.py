"""
Email Generation Agent for LangGraph workflow
Consolidates email writing and follow-up strategy into unified email generation
with rich business intelligence integration.
"""
import re
import time
from typing import Dict, Any, List, Optional
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field, ConfigDict
from ...utils.config import get_settings
from ...utils.logger import setup_logger
from ...utils.research_clients import ClientRegistry
from ...utils.analytics import capture_event, capture_error
from ...models.lead_models import (
    AgentResult,
    BusinessProfile,
    EmailContent,
    FollowUpSequence,
    Lead,
)
from ..state import EmailGenerationState

logger = setup_logger(__name__)
settings = get_settings()

MIN_FOLLOW_UP_EMAILS = 2
MAX_FOLLOW_UP_EMAILS = 2  # Limit to exactly 2 follow-ups

class FollowUpEmailPlan(BaseModel):
    """Structured follow-up email draft returned by the LLM"""

    model_config = ConfigDict(extra="forbid")

    subject: str = Field(..., description="Subject line for the follow-up email")
    body: str = Field(..., description="Full body content for the follow-up email. Do NOT include a closing or signature. Signature handling is managed separately.")
    objective: str = Field(
        default="",
        description="Goal or focus for this follow-up touch point",
    )
    call_to_action: str = Field(
        default="",
        description="Call to action or next step requested",
    )


class EmailSequence(BaseModel):
    """Complete email sequence with primary email and follow-ups"""
    model_config = ConfigDict(extra="forbid")

    # Primary email - CRITICAL: Each field contains ONLY its specific content, NO overlap
    primary_subject: str = Field(..., description="Subject line ONLY - format: 'Hi [Name], [curiosity hook]'")
    primary_opening: str = Field(..., description="GREETING + FIRST SENTENCE ONLY - Start with 'Hi [Name],' followed by ONE personalized research hook sentence. DO NOT include any body paragraphs here.")
    primary_body: str = Field(..., description="BODY PARAGRAPHS ONLY (2-3 paragraphs) - NO greeting, NO CTA. Contains: challenge/opportunity paragraph, proof point paragraph, specific offer paragraph.")
    primary_cta: str = Field(..., description="SINGLE CTA SENTENCE ONLY - NO duplicates. One clear ask for a 15-30 minute call.")
    primary_ps: str = Field(default="", description="Optional P.S. - ONE sentence max, additional value hook")
    
    # Personalization elements
    personalization_elements: List[str] = Field(..., description="Specific personalization used")
    business_context_usage: List[str] = Field(..., description="How business intelligence was used")
    competitor_references: List[str] = Field(default_factory=list, description="Competitor insights used")
    industry_insights_used: List[str] = Field(default_factory=list, description="Industry trends referenced")
    
    # Follow-up sequence (if requested)
    follow_up_emails: List[FollowUpEmailPlan] = Field(
        default_factory=list,
        description="Follow-up email sequence",
    )
    follow_up_strategy: str = Field(default="", description="Overall follow-up strategy")
    timing_schedule: List[int] = Field(default_factory=list, description="Days between emails")
    
    # Quality metrics
    estimated_effectiveness: float = Field(..., ge=0, le=1, description="Estimated email effectiveness")
    engagement_probability: float = Field(..., ge=0, le=1, description="Estimated engagement probability")
    personalization_depth: str = Field(..., description="Deep, Medium, or Surface personalization")
    
    # Content analysis
    key_value_propositions: List[str] = Field(..., description="Key value props highlighted")
    pain_points_addressed: List[str] = Field(..., description="Pain points directly addressed")
    proof_points_included: List[str] = Field(..., description="Proof points and credibility elements")


def _generate_fallback_followups(
    lead: Lead,
    business_profile: BusinessProfile,
    pain_points: List[str],
    value_matches: List[str],
    follow_up_strategy: str,
    call_to_action: str,
) -> List[FollowUpEmailPlan]:
    """Create deterministic follow-up plans when the LLM returns too few."""

    contact_name = lead.contact_name or "there"
    company_name = lead.company_name
    our_company = business_profile.company_name
    primary_value = value_matches[0] if value_matches else business_profile.value_proposition
    primary_service = business_profile.services[0] if business_profile.services else "our solution"
    pressing_pain_point = pain_points[0] if pain_points else "the priorities you mentioned"
    primary_value_text = primary_value if isinstance(primary_value, str) else str(primary_value)
    pressing_pain_point_text = (
        pressing_pain_point if isinstance(pressing_pain_point, str) else str(pressing_pain_point)
    )
    primary_service_text = primary_service if isinstance(primary_service, str) else str(primary_service)
    case_study = next((cs for cs in business_profile.case_studies if cs.get("title")), None)

    fallback_followups: List[FollowUpEmailPlan] = []

    # Follow-up 1: Share a resource or case study that reinforces value
    if case_study:
        resource_body = (
            f"Hi {contact_name},\n\n"
            f"I was thinking more about {pressing_pain_point_text} at {company_name} and how others have tackled it. "
            f"We recently partnered with {case_study.get('client', 'a peer in your space')} and helped them {case_study.get('outcome', 'achieve measurable results')}.\n\n"
            f"I've attached a short overview that highlights the approach and the impact it delivered. "
            f"Would it be helpful to walk through the playbook together?"
        )
    else:
        resource_body = (
            f"Hi {contact_name},\n\n"
            f"Wanted to send over a concise breakdown of how teams similar to {company_name} are using {primary_service_text} "
            f"to stay ahead. It outlines how the approach maps directly to {pressing_pain_point_text}.\n\n"
            f"Happy to unpack anything that stands out or tailor a quick walkthrough for you."
        )

    fallback_followups.append(
        FollowUpEmailPlan(
            subject=f"Resource that helped other {lead.industry or 'teams'}",
            body=resource_body,
            objective="Share social proof and reinforce value",
            call_to_action=call_to_action,
        )
    )

    # Follow-up 2: Collaborative check-in with a new angle
    new_angle_body = (
        f"Hi {contact_name},\n\n"
        f"Wanted to make sure this stayed on your radar. We mapped out a lightweight, 30-day rollout plan "
        f"showing how {our_company} could support {primary_value_text.lower()} without adding work to your team.\n\n"
        f"Could we compare notes on where {company_name} is focusing this quarter and see if the plan aligns?"
    )

    fallback_followups.append(
        FollowUpEmailPlan(
            subject=f"Re: {primary_value} at {company_name}",
            body=new_angle_body,
            objective="Re-engage with collaborative planning angle",
            call_to_action=call_to_action,
        )
    )

    # Only return exactly 2 follow-ups (removed optional third follow-up)
    return fallback_followups


def _clean_duplicate_content(email_sequence: "EmailSequence", contact_first_name: str) -> "EmailSequence":
    """
    Post-process email sequence to remove duplicate content between fields.

    This is a safety net for when the LLM mistakenly includes:
    - Greeting in both primary_opening and primary_body
    - CTA in both primary_body and primary_cta
    - Research hook repeated across fields
    """
    import re

    # Common greeting patterns to detect
    greeting_pattern = rf"^Hi\s+{re.escape(contact_first_name)}\s*[,:]?\s*\n*"

    opening = email_sequence.primary_opening.strip()
    body = email_sequence.primary_body.strip()
    cta = email_sequence.primary_cta.strip()

    # 1. Remove duplicate greeting from body if opening already has it
    if opening.lower().startswith(f"hi {contact_first_name.lower()}"):
        # Body should NOT start with a greeting
        body = re.sub(greeting_pattern, "", body, count=1, flags=re.IGNORECASE).strip()

    # 2. Remove CTA from body if it's duplicated
    if cta:
        # Check if CTA appears at end of body
        cta_normalized = cta.lower().strip().rstrip('?').rstrip('.')
        body_lines = body.split('\n')
        cleaned_lines = []
        for line in body_lines:
            line_normalized = line.lower().strip().rstrip('?').rstrip('.')
            # Skip line if it's essentially the same as CTA
            if line_normalized and cta_normalized and (
                line_normalized == cta_normalized or
                (len(cta_normalized) > 20 and cta_normalized in line_normalized) or
                (len(line_normalized) > 20 and line_normalized in cta_normalized)
            ):
                continue
            cleaned_lines.append(line)
        body = '\n'.join(cleaned_lines).strip()

    # 3. Check for duplicated first sentence between opening and body
    opening_lines = opening.split('\n')
    if len(opening_lines) >= 2:
        # Get the research hook (first sentence after greeting)
        research_hook = opening_lines[-1].strip() if opening_lines[-1].strip() else (
            opening_lines[1].strip() if len(opening_lines) > 1 else ""
        )
        if research_hook and len(research_hook) > 30:
            # Check if this exact sentence appears at start of body
            hook_normalized = research_hook.lower()
            body_start = body[:len(research_hook) + 50].lower() if body else ""
            if hook_normalized in body_start:
                # Remove the duplicate from body
                body = body.replace(research_hook, "", 1).strip()
                # Clean up any resulting double newlines
                body = re.sub(r'\n{3,}', '\n\n', body)

    # Return updated email sequence
    return email_sequence.model_copy(update={
        "primary_opening": opening,
        "primary_body": body,
        "primary_cta": cta
    })


async def email_generation_agent_node(state: EmailGenerationState) -> Dict[str, Any]:
    """
    Comprehensive Email Generation Agent that consolidates:
    1. Email Writing (personalized primary email with rich business context)
    2. Follow-up Strategy (multi-touch sequence planning and execution)
    
    This agent uses the comprehensive business intelligence from the previous agent
    to create highly personalized, context-rich email content that demonstrates
    deep understanding of the prospect's business situation.
    
    Args:
        state: Current workflow state with business intelligence
        
    Returns:
        Updated state with generated email sequence
    """
    start_time = time.time()
    lead = state["lead"]
    business_profile = state["business_profile"]
    requirements = state["requirements"]
    business_intelligence = state.get("business_intelligence", {})

    provider_keys: Optional[Dict[str, str]] = state.get("provider_keys")
    provider_key_map = provider_keys or {}
    using_user_keys = provider_keys is not None
    registry = ClientRegistry.get_instance()

    # Extract PostHog LLM callback for analytics
    llm_callback = state.get("llm_callback")
    callbacks = [llm_callback] if llm_callback else []

    # Get lead tier for B-tier handling
    lead_tier = state.get("lead_tier", "A")
    lead_tier_reason = state.get("lead_tier_reason", "")
    is_b_tier = lead_tier == "B"

    logger.info(f"Starting email generation for {lead.company_name} (Tier: {lead_tier})")
    if is_b_tier:
        logger.info(f"B-tier lead detected: {lead_tier_reason} - using generic template approach")

    analytics_context = {
        "request_id": state.get("request_id"),
        "lead_id": getattr(lead, "id", None),
        "company_name": lead.company_name,
        "user_id": state.get("user_id"),
        "user_tier": state.get("user_tier", "free"),
        "lead_tier": lead_tier,
        "lead_tier_reason": lead_tier_reason,
        "using_user_keys": using_user_keys,
        "provider_keys_supplied": sorted(provider_key_map.keys()) if using_user_keys else [],
        "follow_up_sequence": requirements.follow_up_sequence,
    }
    capture_event("email_agent_started", analytics_context)
    
    try:
        # Validate business intelligence availability
        if not business_intelligence:
            raise ValueError("Business intelligence not available - cannot generate personalized email")
        
        # Extract key intelligence data
        company_overview = business_intelligence.get("company_overview", "")
        pain_points = business_intelligence.get("pain_points", [])
        value_matches = business_intelligence.get("value_matches", [])
        competitors = business_intelligence.get("competitors", [])
        industry_insights = business_intelligence.get("industry_insights", "")
        personalization_elements = business_intelligence.get("personalization_elements", [])
        messaging_strategy = business_intelligence.get("messaging_strategy", "")
        engagement_hooks = business_intelligence.get("engagement_hooks", [])
        relevance_score = business_intelligence.get("relevance_score", 0.5)
        qualification_level = business_intelligence.get("qualification_level", "Medium")

        # CRITICAL: Extract raw research data with ALL bullet points from Tavily/Perplexity
        # This contains the full, unfiltered research results before LLM summarization
        research_metadata = business_intelligence.get("research_metadata", {})
        recent_news = research_metadata.get("recent_news", [])
        competitor_mentions = research_metadata.get("competitor_mentions", [])
        quantifiable_metrics = research_metadata.get("quantifiable_metrics", [])
        pain_point_research = research_metadata.get("pain_points", [])
        industry_benchmarks = research_metadata.get("industry_benchmarks", [])
        technology_stack = research_metadata.get("technology_stack", [])

        logger.info(f"Raw research data available: {len(recent_news)} news items, "
                   f"{len(competitor_mentions)} competitor refs, {len(quantifiable_metrics)} metrics, "
                   f"{len(pain_point_research)} pain point refs, {len(industry_benchmarks)} benchmarks")

        # TODO: REMOVE BEFORE PRODUCTION - Detailed logging of raw research data for verification
        logger.info("=" * 80)
        logger.info(f"DETAILED RAW RESEARCH DATA FOR {lead.company_name}")
        logger.info("=" * 80)

        logger.info("\n📰 RECENT NEWS & MILESTONES:")
        for i, item in enumerate(recent_news[:10], 1):
            logger.info(f"  {i}. {item[:200]}...")

        logger.info("\n🏢 COMPETITOR REFERENCES:")
        for i, item in enumerate(competitor_mentions[:10], 1):
            logger.info(f"  {i}. {item[:200]}...")

        logger.info("\n📊 QUANTIFIABLE METRICS:")
        for i, item in enumerate(quantifiable_metrics[:10], 1):
            logger.info(f"  {i}. {item[:200]}...")

        logger.info("\n⚠️ PAIN POINTS RESEARCH:")
        for i, item in enumerate(pain_point_research[:10], 1):
            logger.info(f"  {i}. {item[:200]}...")

        logger.info("\n📈 INDUSTRY BENCHMARKS:")
        for i, item in enumerate(industry_benchmarks[:10], 1):
            logger.info(f"  {i}. {item[:200]}...")

        logger.info("\n💻 TECHNOLOGY STACK:")
        for i, item in enumerate(technology_stack[:10], 1):
            logger.info(f"  {i}. {item[:200]}...")

        logger.info("=" * 80)
        # END TODO: REMOVE DETAILED LOGGING

        logger.info(f"Using business intelligence: {len(pain_points)} pain points, "
                   f"{len(value_matches)} value matches, relevance {relevance_score:.2f}")

        contact_info = getattr(business_profile, "contact_info", {}) or {}
        sender_name = contact_info.get("name") or contact_info.get("contactName") or ""
        sender_email = contact_info.get("email", "")
        sender_phone = contact_info.get("phone", "")
        sender_website = contact_info.get("website", "")
        sender_linkedin = contact_info.get("linkedin", "")
        sender_signature = (contact_info.get("signature", "") or "").strip()
        raw_signature_enabled = contact_info.get("signatureEnabled", True)
        sender_signature_enabled = not (
            raw_signature_enabled is False
            or (
                isinstance(raw_signature_enabled, str)
                and raw_signature_enabled.strip().lower() in {"0", "false", "no", "off"}
            )
        )
        closing_phrases = {
            "best",
            "best regards",
            "kind regards",
            "warm regards",
            "regards",
            "sincerely",
            "sincerely yours",
            "yours sincerely",
            "thanks",
            "thank you",
            "many thanks",
            "thanks again",
            "cheers",
            "looking forward",
            "looking forward to hearing from you",
            "talk soon",
            "speak soon",
        }
        sender_signature_lines = {
            line.strip().lower()
            for line in sender_signature.splitlines()
            if line.strip()
        }
        sender_identity_lines = {
            value.strip().lower()
            for value in (
                sender_name,
                business_profile.company_name,
                sender_email,
                sender_phone,
                sender_website,
                sender_linkedin,
            )
            if value and value.strip()
        }

        def is_signature_tail_line(line: str) -> bool:
            normalized = line.strip().lower()
            compact = normalized.rstrip(" ,.!:")
            if compact in closing_phrases:
                return True
            if normalized in sender_signature_lines or normalized in sender_identity_lines:
                return True
            if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", line.strip()):
                return True
            if re.fullmatch(r"(?:https?://|www\.)\S+", line.strip(), re.IGNORECASE):
                return True

            digits = sum(ch.isdigit() for ch in line)
            if digits >= 7 and re.fullmatch(r"[\d\s()+\-./xXextEXT]+", line.strip()):
                return True

            return False

        def strip_signature_like_tail(body: str) -> str:
            """Remove trailing closings/signature lines when signatures are disabled."""

            lines = body.splitlines()
            end = len(lines) - 1
            while end >= 0 and not lines[end].strip():
                end -= 1

            if end < 0:
                return ""

            start = end
            saw_signature_content = False
            while start >= 0:
                stripped = lines[start].strip()
                if not stripped:
                    start -= 1
                    continue
                if is_signature_tail_line(stripped):
                    saw_signature_content = True
                    start -= 1
                    continue
                break

            if not saw_signature_content:
                return body.strip()

            cleaned_lines = lines[: start + 1]
            while cleaned_lines and not cleaned_lines[-1].strip():
                cleaned_lines.pop()
            return "\n".join(cleaned_lines).strip()

        def append_signature(body: str) -> str:
            """Append sender signature details if they're not already present."""

            if not sender_signature_enabled:
                return strip_signature_like_tail(body)

            if sender_signature:
                normalized_sig = "\n".join(
                    line.strip() for line in sender_signature.splitlines()
                ).lower()

                # If the full custom signature is already verbatim in the body,
                # skip appending to avoid duplication.
                normalized_body = "\n".join(line.strip() for line in body.splitlines()).lower()
                if normalized_sig and normalized_sig in normalized_body:
                    return body

                return f"{body}\n\n{sender_signature}"

            signature_lines = []
            lower_body = body.lower()

            def add_line(value: str):
                if value and value.lower() not in lower_body and value not in signature_lines:
                    signature_lines.append(value)

            if sender_name:
                add_line(sender_name)

            company_line = business_profile.company_name
            if company_line and company_line.lower() != sender_name.lower():
                add_line(company_line)

            add_line(sender_email)
            add_line(sender_phone)
            add_line(sender_website)
            add_line(sender_linkedin)

            if not signature_lines:
                return body

            cleaned_body = strip_signature_like_tail(body)
            return f"{cleaned_body}\n\nBest,\n" + "\n".join(signature_lines)
        
        # Initialize LLM for email generation
        # GPT-5-mini: 128K max output, optimized for fast generation with 3000 token budget
        openai_api_key = provider_key_map.get("openai") if using_user_keys else None
        email_model = settings.email_generation_model or settings.default_model
        email_token_budget = settings.clamp_tokens(settings.email_generation_max_tokens)
        email_model_lower = email_model.lower()
        is_reasoning_model = "o1" in email_model_lower or "gpt-5" in email_model_lower
        email_llm_kwargs = {
            "api_key": openai_api_key,
            "model": email_model,
            "temperature": 0.4,
            "max_completion_tokens": email_token_budget,
            "require_user_key": using_user_keys,
        }
        if is_reasoning_model:
            email_llm_kwargs["reasoning_effort"] = "low"
        llm = registry.get_openai_client(**email_llm_kwargs).with_structured_output(EmailSequence)
        
        # Create comprehensive email generation prompt - EXACT VERBATIM from master prompt
        prompt = ChatPromptTemplate.from_messages([
            ("system", """You are an elite B2B email copywriter and sales strategist with expertise in:
- Highly personalized business email creation
- Multi-touch email sequence development
- Business intelligence integration for maximum relevance
- Industry-specific messaging and positioning
- Competitive differentiation and value proposition communication

Your emails consistently achieve exceptional results because they:
- Are SHORT, CONCISE, and SCANNABLE (100-150 words max)
- Get to the point immediately with no fluff
- Demonstrate deep research in few words
- Address specific pain points with relevant solutions
- Use industry insights and competitive intelligence strategically
- Feel personal and conversational, never templated
- Include compelling proof points without verbosity
- Have clear, low-pressure calls to action

Email best practices:

SUBJECT LINES (CRITICAL - HIGHEST PRIORITY):
- Format: MUST start with "Hi {contact_first_name}" then add curiosity-provoking content
- NEVER use hyphens in subject lines
- Use comma or colon after name: "Hi {contact_first_name}, [statement]" or "Hi {contact_first_name}: [statement]"
- Create strong curiosity gaps that make recipients want to open
- Use specific numbers, stats, and concrete details from research
- Reference competitors, peers, or insider insights when relevant
- Keep under 60 characters total including greeting
- Never use generic phrases: "touching base", "following up", "checking in", "quick question"

Subject Line Patterns (Choose based on context and available research data):
  1. Specific Discovery: "Hi [name], spotted 3 pipeline gaps at [company]"
     → Requires: 3+ identifiable opportunities from research
  2. What If Scenario: "Hi [name], what if [company] could cut churn by 30%?"
     → Requires: Specific metrics or pain points from research
  3. Competitive Intelligence: "Hi [name], why [company]'s competitors switched from [tool]"
     → Requires: Real competitor names from research (NEVER use without data)
  4. Hidden Insight: "Hi [name]: the overlooked fix for [company]'s [challenge]"
     → Requires: Specific identified challenge from research
  5. Contrarian/Pattern Interrupt: "Hi [name], [company] + this = [outcome]"
     → Requires: Specific data point from research
  6. Peer Proof: "Hi [name], what companies like [company] are doing now"
     → Requires: Peer examples from research
  7. Limited Data Approach (USE WHEN RESEARCH IS SPARSE):
     → Use when: Missing competitor names, metrics, or recent news
     → Focus: Confirmed data only (bootstrapped status, employee range, founder role, stage)

     Pattern 7A - Company Insight:
     "Hi [name], bootstrapped agencies like [company] miss this"
     "Hi [name], [verified fact about company] + this = [outcome]"
     Example: "Hi Ziad, bootstrapped agencies like yours miss this growth hack"

     Pattern 7B - Stage/Size Focus:
     "Hi [name], [company] at the [size/stage] inflection point"
     "Hi [name], most [role] at [company size] hit this wall"
     Example: "Hi Ziad, Cedarsphere at the 40-person inflection point"

     Pattern 7C - Role/Industry Specific:
     "Hi [name], founder-led [industry] face this [challenge]"
     "Hi [name]: the [industry] scaling challenge no one talks about"
     Example: "Hi Ziad, founder-led agencies face this ops challenge"

Curiosity Triggers to Use:
  - Specific numbers/stats from research (3 quick wins, 40% faster, 15hrs/week saved)
  - Competitor/peer insights (competitors are doing this, others learned)
  - "What if" scenarios (what if you could double pipeline)
  - Hidden/overlooked/unconventional angles
  - Contrarian takes (why teams are ditching X)
  - Pattern interrupts (Company + this = outcome)
  - Thought-provoking questions (are you seeing this too?)
  - Power words: spotted, unconventional, hidden, overlooked, discovered

EMAIL STRUCTURE (CRITICAL - KEEP IT SHORT):
- Total length: 100-150 words maximum (excluding signature)
- Paragraphs: 1-2 sentences each, maximum 3-4 paragraphs total
- Opening: 1 sentence with personalized hook
- Body: 2-3 short paragraphs with key points
- No lengthy explanations, just core value and proof
- Use white space generously for scannability
- Get to the value proposition in first 3 lines
- NEVER use hyphens anywhere in the email body
- Use commas, periods, or separate sentences instead of hyphens

OPENING (greeting + 1-2 sentences):
- MUST start with "Hi {contact_first_name}," on first line
- Then quick personalized reference (recent news, growth stage, challenge)
- Must be immediately relevant to their business
- Use proper grammar with pronouns and articles
- Examples:
  GOOD: "Hi Sarah,\n\nI noticed RevCo closed a Series A last month"
  BAD: "I noticed RevCo closed a Series A last month" (missing greeting)
  BAD: "Noticed RevCo closed Series A last month" (missing greeting and article)
- No long-winded context setting

BODY (2-3 short paragraphs):
- Paragraph 1: Their challenge or opportunity (1-2 sentences)
- Paragraph 2: Proof point with specific results (1-2 sentences with numbers)
- Paragraph 3: What you can offer them (1 sentence)
- NO feature lists, NO lengthy explanations
- Lead with outcomes and specific metrics
- Every sentence must earn its place
- Use commas and periods, never hyphens for breaks

PERSONALIZATION:
- Use business intelligence strategically, not exhaustively
- Pick the 1-2 most compelling personalization elements
- Quality over quantity, make every detail count
- Show research without listing everything you know
- Always use REAL data from business intelligence
- Never fabricate or assume information not in research

DATA INTEGRITY - CRITICAL CONSTRAINTS (HIGHEST PRIORITY):
⚠️ ZERO FABRICATION TOLERANCE - ALL CLAIMS MUST BE VERIFIED ⚠️

1. ONLY use data explicitly provided in the business intelligence section below
2. Competitor References - CRITICAL ALIGNMENT WITH QA:
   - ONLY use competitor names explicitly mentioned in business intelligence
   - If NO competitor names in research → DO NOT reference competitors at all
   - Instead: Focus on industry trends, general challenges, or the prospect's specific situation
   - NEVER use vague references: "similar companies", "industry peers", "competitors in your space"
   - QA will penalize vague competitor references with -0.2 score penalty
3. If specific metrics/numbers not provided → use qualitative language: "several", "some", "multiple", "many"
4. If funding details not in research → reference general "growth stage" or omit entirely
5. If employee counts not in research → use "team", "organization" without numbers
6. If specific pain points not researched → reference general industry challenges only
7. Subject line curiosity hooks MUST reflect actual research findings, not assumptions

Examples of CORRECT data usage when research is limited:
- GOOD: "I noticed your team has been growing" (when no numbers available)
- BAD: "I noticed you doubled from 50 to 100 employees" (fabricated numbers)
- GOOD: "Most bootstrapped agencies at your stage hit scaling challenges" (when no competitor names)
- BAD: "Acme Corp and Beta Inc switched from [tool]" (fabricated competitor names)
- BAD: "Similar companies in your space are switching from [tool]" (vague competitor reference - QA penalty)
- GOOD: "Many teams at your stage face [challenge]" (generic industry insight)
- BAD: "Your Q3 numbers show 30% churn" (fabricated metric)

HANDLING LIMITED RESEARCH DATA (CRITICAL FOR QA PASS RATE):

When business intelligence is sparse (missing competitors, metrics, or recent news):

1. Subject Line Strategy - Use Pattern #7 (Limited Data Approach):
   - Focus on confirmed data: bootstrapped status, employee range, founder role, company stage
   - Avoid patterns requiring competitors (#3), specific metrics (#2), or recent news (#1)
   - See Pattern #7 in Subject Line Patterns section below for specific examples

2. Email Body Strategy:
   - Open with verified company fact (employee count, bootstrapped status, founder role)
   - Address industry-level challenge relevant to their stage/size
   - Use vague social proof: "a [location] [type] company", "teams at your stage"
   - Keep proof point generic but relevant
   - Example opening: "I noticed [Company] bootstrapped to 40+ employees..."

3. Competitor Reference Strategy - NEVER FABRICATE:
   - NO competitor names available → DO NOT reference competitors
   - Focus on industry trends or stage-based challenges
   - Examples:
     ✅ "Most bootstrapped agencies at 40+ people hit this wall"
     ✅ "We worked with a Waco service company to solve this"
     ✅ "Founder-led teams at your stage face operations complexity"
     ❌ "Companies like HubSpot and Salesforce switched from X" (fabricated)
     ❌ "Similar agencies in your space are doing Y" (vague - QA penalty)
     ❌ "Competitors like yours..." (vague - QA penalty)

4. P.S. Strategy for Sparse Data:
   - Keep numbers VAGUE unless exact data from research
   - Use qualitative language: "several", "some", "multiple", "a number of"
   - NEVER use specific placeholder numbers: 47, 87, 143, etc.
   - Examples:
     ✅ "I've worked with several [location]-based service companies..."
     ✅ "Happy to share examples from bootstrapped agencies..."
     ✅ "I have case studies from companies at your stage..."
     ❌ "I found 47 agencies matching your profile..." (placeholder number)
     ❌ "The system identified 143 prospects like yours..." (placeholder number)

5. Metrics Strategy:
   - NO specific numbers in research → Use qualitative language only
   - Never fabricate ROI, time savings, or growth percentages
   - Use conservative estimates based on industry norms
   - Always prefer vague over specific when data is missing

REMEMBER: QA agent will penalize fabricated data with -0.3 score deduction per violation:
- Vague competitor references ("similar companies"): -0.2 penalty
- Fabricated data (metrics, funding, competitors): -0.3 penalty
- Placeholder numbers in P.S.: -0.1 penalty
- Total penalties can cause automatic "Needs_Improvement" or "Rejected" status

B-TIER LEAD SPECIAL HANDLING (lead_tier: {lead_tier}):
When lead_tier is "B" (minimal research data available):
1. DO NOT fail or reject - B-tier leads are still valuable and should get emails
2. Use Pattern #7 (Limited Data Approach) for subject lines
3. Focus on verified facts only: company name, location, industry, role
4. Use industry-level insights instead of company-specific claims
5. Lead with curiosity about THEIR situation, not claims about data you found
6. Do NOT fabricate any research-backed claims
7. Keep email structure professional and focused
8. QA will use lower approval threshold (0.50) for B-tier leads
9. Missing research elements are EXPECTED and will NOT be penalized

B-tier email priorities:
- Professional tone and structure over deep personalization
- Generic industry value propositions over specific competitor insights
- Clear CTA and concise body over research-heavy content

SENDER PROFILE INTEGRITY (SAME PRIORITY AS PROSPECT DATA):

The sender's business profile is the ONLY source of truth for what they offer.
Apply the same zero-fabrication standard you use for prospect data.

Rules:
- Only reference services listed in {our_services}. If it's not listed, don't pitch it.
- Only reference differentiators listed in {our_differentiators}. Don't invent advantages.
- Describe the sender's offering using the SAME words and SAME level of specificity as
  {our_value_prop}. Do NOT invent the mechanism, methodology, or specific deliverable.
  If the profile says "marketing consulting", say "marketing consulting" — not "workshops",
  "funnels", "campaigns", "CRM tracking", or any other specific tactic unless it is
  explicitly in {our_services} or {our_value_prop}.
- ROI numbers, percentages, and outcome metrics: NEVER cite these unless they appear
  verbatim in {our_differentiators} or a verified case study. This includes numbers
  framed as "typical", "achievable", or "industry average" — if the sender's profile
  does not contain the number, it must not appear in the email. Do NOT borrow numbers
  from the prospect's industry research to imply the sender's results (e.g., "companies
  like yours achieve X%" from research data cannot be rephrased as a sender outcome).
- Case studies and proof points: ONLY include if {include_case_study} is true AND actual
  case study content is listed in the sender profile below. If {include_case_study} is
  true but no case study data appears in the profile, treat it as false — do not fabricate
  a case study. Never invent a case study, client name, or result metric.
- Integrations, partnerships, certifications: Only mention if explicitly stated in the
  sender profile. "Works with your existing HubSpot" is only valid if the sender's profile
  mentions HubSpot compatibility.
- If the sender profile is vague (e.g., "we help businesses grow"), keep the email's claims
  equally vague. Do NOT sharpen a vague profile into specific tactics, tools, or numbers.

What this looks like in practice:
- Profile services = "marketing consulting" → Say "marketing consulting." You cannot say
  "marketing workshops", "traffic campaigns", "lead funnels", or "CRM setup" — those are
  invented specifics not in the profile.
- Profile value prop = "get more customers into their space" → You can echo that framing.
  You cannot translate it into "boost inquiry rates to 3-5%" or "5-15x ROI" — those numbers
  don't exist in the profile.
- Profile lists no case studies → You cannot write "We helped [Company] achieve [result]"
  and you cannot write "typical results are X%" either. Use the offer framing instead:
  "I built a quick plan showing how this could work for [prospect]."
- Profile says "smart locks for real estate" → You can pitch smart locks to real estate
  leads. You cannot add "with biometric scanning and cloud-based access management" unless
  those features are stated.

SERVICE-TO-VERTICAL MATCHING:
When the sender's profile lists multiple services for different verticals:
- Match the service most relevant to this lead's industry, size, and pain points.
- Pitch only that service. Don't list the full catalog.
- If no clear match exists, lead with the service closest to the lead's industry and
  keep the pitch general.

CALL TO ACTION:
- One simple sentence
- Specific time ask (15-30 minutes)
- Clear value exchange
- Low pressure
- Should immediately follow the value proposition

SIGNATURE:
- Clean and professional
- Include all provided contact details
- No extra text or placeholder names

P.S. (Optional, 1 sentence max):
- Additional value or curiosity hook
- Must be genuinely useful, not filler
- Keep numbers VAGUE unless exact data from research
- Use qualitative language: "several", "some", "multiple"
- Never use specific placeholder numbers

FOLLOW-UPS (if requested):
- Same brevity rules apply (100-150 words max)
- Each follow-up must have unique angle
- Different curiosity hook in each subject line
- No hyphens in follow-up subject lines or bodies
- Provide at least two distinct follow-up emails when a sequence is requested
- Vary the proof points and value angles
- Never repeat content from previous emails

WRITING TONE:
- Conversational but professional
- Confident, not desperate
- Peer-to-peer, not vendor-to-buyer
- Specific, not vague
- Punchy, not wordy
- Scannable, not dense
- Natural and human, not robotic

CRITICAL WRITING REQUIREMENTS:

OUTPUT FIELD STRUCTURE (CRITICAL - PREVENTS DUPLICATION):
- primary_opening: ONLY the greeting + ONE research hook sentence
  Example: "Hi Sarah,\n\nI noticed RevCo closed a Series A last month."
- primary_body: ONLY the 2-3 body paragraphs, NO greeting, NO CTA
  Example: "Series A companies typically face X challenge.\n\nWe helped Company Y achieve Z result.\n\nOur solution could help RevCo with..."
- primary_cta: ONLY ONE sentence asking for a call
  Example: "Would a 15-minute call next week work to explore this?"

DUPLICATION PREVENTION (CRITICAL):
- NEVER repeat the greeting in primary_body (it's already in primary_opening)
- NEVER repeat the CTA in primary_body (it goes in primary_cta only)
- NEVER repeat the research hook from primary_opening in primary_body
- NEVER include a closing or signature in any generated field
- Each field contains UNIQUE content with ZERO overlap

Natural, Human Language:
- Write like a real person, not a bot
- Use complete sentences with proper grammar
- The greeting "Hi {contact_first_name}," goes in primary_opening ONLY
- Always use articles (a, an, the) where grammatically appropriate
- Include pronouns (I, we, our) naturally
- Examples of what the ASSEMBLED email looks like:
  GOOD: "Hi Sarah,\n\nI noticed RevCo closed a Series A last month"
  BAD: "I noticed RevCo closed a Series A last month" (missing greeting)
  BAD: "Noticed RevCo closed Series A last month" (missing greeting and article)
  GOOD: "Hi John,\n\nI saw Q3 numbers posted"
  BAD: "Q3 numbers posted" (missing greeting and article)
- Proofread for natural flow and correctness

NO HYPHENS RULE (CRITICAL):
- NEVER use hyphens anywhere in subject lines or email body
- This is non-negotiable
- Subject format: "Hi [Name], [statement]" or "Hi [Name]: [statement]"
- In body: use commas, periods, or separate sentences instead
- Examples:
  GOOD: "The agent runs 24/7, finds leads matching your ICP, and verifies contact info"
  BAD: "The agent runs 24/7 - finds leads - verifies contact info"
  GOOD: "I built a demo. It shows how this works for your ICP."
  BAD: "I built a demo - shows how this works for your ICP"
  GOOD: "I mapped out 3 quick wins for your setup. Works with existing tools."
  BAD: "I mapped out 3 quick wins for your setup - works with existing tools"

NEVER Make Up Information:
- Every claim about the prospect MUST come from business intelligence data
- If research shows they closed Series A, reference it
- If research doesn't show it, don't mention it
- Use REAL competitor names from research, never "a similar company"
- Use REAL numbers from research, never estimated or placeholder numbers
- If you don't have the data, don't make the claim
- All personalization must be verifiable from provided business intelligence

Subject Line Data Requirements:
- Subject line curiosity hooks must be based on actual research findings
- Only reference challenges/opportunities identified in business intelligence
- Don't assume or fabricate prospect situations
- Must reflect real data from pain points, personalization elements, or company overview

Avoid Dated/Hype Language:
- Never use "10x" language (sounds like 2022 hype)
- Avoid Grant Cardone style exaggeration
- Use realistic, credible multipliers (2x, 3x, 5x with context)
- Prefer: "What would it mean if [Company] could double revenue by increasing lead gen 5 fold?"
- Avoid: "10x your lead gen without hiring"

Grammar and Sentence Structure:
- Complete sentences with proper subject verb agreement
- Natural pronoun usage (I, we, our)
- Logical sentence flow and paragraph transitions
- CTA should immediately follow the offer when possible
- Use commas and periods, never hyphens for breaks or pauses

WHAT TO AVOID:
- Long paragraphs (max 2 sentences)
- Feature dumps
- Unnecessary adjectives
- Fluffy language
- Multiple asks in one email
- Overselling or hype
- Generic value propositions
- Lengthy case study descriptions (keep to 1 sentence with results)
- Hyphens anywhere in the email
- Dropping pronouns or articles
- Made up or assumed information
- Vague competitor references

Integration requirements:
- Use business intelligence data selectively for maximum impact
- Reference competitor landscape only when it adds clear value
- Include industry trends if directly relevant
- Address the top 1-2 pain points, not all of them
- Leverage only the most compelling personalization elements
- Follow recommended messaging strategy but keep it tight
- Always use real competitor names from research data
- Base all claims on provided business intelligence
"""),
            ("human", """Create a highly personalized email sequence using comprehensive business intelligence:

{qa_improvement_context}

PROSPECT INFORMATION:
Company: {company_name}
Contact: {contact_name} ({title})
Contact First Name: {contact_first_name}
Industry: {industry}
Company Size: {company_size}
Qualification: {qualification_level}
Relevance Score: {relevance_score}

BUSINESS INTELLIGENCE INSIGHTS:
Company Overview: {company_overview}

Pain Points Identified:
{pain_points_list}

Value Propositions Aligned:
{value_matches_list}

Personalization Elements:
{personalization_elements_list}

Engagement Hooks:
{engagement_hooks_list}

Messaging Strategy: {messaging_strategy}

Industry Insights: {industry_insights}

Competitor Context: {competitor_context}

RAW RESEARCH DATA (Complete Tavily/Perplexity Search Results):
Use this comprehensive research data for maximum personalization depth and accuracy.
These bullet points contain ALL discovered information before AI summarization.

Recent News & Milestones:
{recent_news_raw}

Competitor References & Case Studies:
{competitor_mentions_raw}

Quantifiable Metrics & Results:
{quantifiable_metrics_raw}

Pain Points Research:
{pain_points_raw}

Industry Benchmarks & Standards:
{industry_benchmarks_raw}

Technology Stack & Tools:
{technology_stack_raw}

OUR COMPANY PROFILE:
Company: {our_company}
Primary Contact Name: {our_contact_name}
Contact Email: {our_contact_email}
Contact Phone: {our_contact_phone}
Company Website: {our_contact_website}
Value Proposition: {our_value_prop}
Services: {our_services}
Differentiators: {our_differentiators}

EMAIL REQUIREMENTS:
Tone: {tone}
Length: SHORT AND CONCISE (100-150 words max, excluding signature)
Call to Action: {cta}
Include Case Study: {include_case_study}
Personalization Level: {personalization_level}
Follow-up Sequence: {follow_up_sequence}
Follow-up Expectation: Include exactly TWO follow-up emails with unique angles and CTAs when follow_up_sequence is true (no more, no less)

CRITICAL DATA INTEGRITY REQUIREMENTS:

You have access to comprehensive business intelligence. USE IT EXCLUSIVELY.

1. ONLY Use Real Research Data:
   - Every personalization element must come from business intelligence provided
   - Company overview, pain points, value matches, competitors, industry insights
   - If business intelligence mentions Series A funding, use it
   - If business intelligence shows specific growth metrics, use them
   - If research doesn't contain the information, DON'T make it up
   - Never assume or fabricate prospect situations

2. Competitor References - CRITICAL ALIGNMENT WITH QA:
   - Business intelligence includes: {competitor_context}
   - ONLY use competitor names explicitly mentioned in business intelligence
   - If NO competitor names in research → DO NOT reference competitors at all
   - NEVER use vague references: "similar companies", "industry peers", "competitors in your space"
   - QA will penalize vague competitor references with -0.2 score penalty
   - Instead: Focus on industry trends, stage-based challenges, or verified company facts
   - Examples:
     ✅ GOOD: "Salesforce customers switched to HubSpot" (if competitors explicitly listed in research)
     ✅ GOOD: "Most bootstrapped agencies at your stage hit this wall" (industry trend, no competitor fabrication)
     ✅ GOOD: "We worked with a [location] service company to solve this" (vague but not claiming competitor knowledge)
     ❌ BAD: "A similar CRM company made the switch" (vague competitor reference - QA penalty)
     ❌ BAD: "Companies like [prospect] are switching..." (fabricated competitor behavior)
   - Using real competitor names builds credibility, but fabricating them destroys it

3. Subject Line Accuracy:
   - Subject curiosity hooks must reflect ACTUAL research findings
   - Only mention challenges/opportunities identified in business intelligence
   - Pain points from: {pain_points_list}
   - Personalization elements from: {personalization_elements_list}
   - Don't assume situations not in the data
   - NEVER use hyphens in subject lines
   - Format options:
     * "Hi {contact_first_name}, [statement]"
     * "Hi {contact_first_name}: [statement]"
     * "Hi {contact_first_name} [question]?"

4. Numbers and Statistics:
   - Use REAL metrics from business intelligence when available
   - If claiming "3 quick wins", ensure you can identify 3 from research
   - If claiming time/cost savings, base on industry insights provided
   - Never use placeholder numbers in P.S. statements
   - If no specific numbers available, use qualitative approach
   - Keep P.S. numbers vague unless exact data exists

5. P.S. Content Rules:
   - Only mention deliverables you can actually provide based on data
   - Keep numbers and quantities VAGUE unless you have exact real data
   - Never use specific placeholder numbers in P.S. statements
   - Examples of valid P.S. approaches:
     GOOD: "I can share the competitor analysis I pulled on [ActualCompetitors]"
     GOOD: "I have the breakdown of how [ActualCompetitor] approaches this"
     GOOD: "Happy to send over the industry benchmark data I found"
     GOOD: "The system identified prospects matching your criteria. Want to see some examples?"
     GOOD: "I found several companies in your space using this approach. Want the details?"
     BAD: "Agent found 87 qualified leads in 48 hours"
     BAD: "I identified 143 accounts matching your ICP"
     BAD: "The system found 47 Shopify merchants matching your criteria"
   - If you don't have exact numbers from research, use qualitative language like:
     * "several", "some", "multiple", "a number of"
     * "examples", "instances", "cases"
     * Avoid any specific counts unless they come directly from business intelligence data

6. Grammar and Natural Language:
   - Use proper grammar and complete sentences
   - Include pronouns (I, we, our) naturally
   - Use articles (a, an, the) appropriately
   - MUST start body with "Hi {contact_first_name},"
   - NEVER use hyphens for pauses, breaks, or emphasis
   - Use commas, periods, or rewrite sentences instead
   - Examples:
     GOOD: "Hi Sarah,\n\nI noticed RevCo closed a Series A last month"
     BAD: "I noticed RevCo closed a Series A last month" (missing greeting)
     BAD: "Noticed RevCo closed Series A last month" (missing greeting and article)
     GOOD: "Hi John,\n\nI saw Q3 numbers posted"
     BAD: "Q3 numbers posted" (missing greeting and article)
     GOOD: "The agent runs on autopilot. It finds leads, verifies contact info, and filters out junk."
     BAD: "The agent runs on autopilot - finds leads - verifies contact info - filters junk"
   - Proofread for natural flow

7. Sentence Structure and Flow:
   - CTA should immediately follow the value proposition
   - Avoid awkward standalone CTAs
   - Example:
     GOOD: "I built a 30 day pilot plan for DataFlow. Want 25 minutes to review it?"
     BAD: "I built a 30 day pilot plan for DataFlow. [paragraph break] 25 minutes to review it?"
   - Never break up thoughts with hyphens
   - Use separate sentences or commas for clarity

8. Avoid Hype Language:
   - No "10x" claims (dated, 2022 era language)
   - Use realistic multipliers with context
   - Examples:
     GOOD: "What would it mean if BrightPath could double revenue by increasing lead gen 5 fold?"
     BAD: "What if BrightPath could 10x lead gen?"
     GOOD: "increase qualified leads by 3x"
     BAD: "10x your pipeline"

9. NO HYPHENS RULE (CRITICAL):
   - NEVER use hyphens anywhere in the email (subject or body)
   - Subject line format: "Hi {contact_first_name}, [statement]" or "Hi {contact_first_name}: [statement]"
   - In body: use commas, periods, or separate sentences
   - This is non-negotiable
   - Examples:
     GOOD: "I mapped out 3 quick wins for CloudCo's setup. Works with your existing HubSpot data, zero workflow disruption."
     BAD: "I mapped out 3 quick wins for CloudCo's setup - works with your existing HubSpot data, zero workflow disruption."
     GOOD: "Three marketing automation companies at your stage cut churn from 8% to under 5%."
     BAD: "Three companies at your stage - marketing automation - cut churn from 8% to under 5%."

10. Sender Profile Accuracy (SAME STANDARD AS PROSPECT DATA):
    - Only pitch services listed in OUR COMPANY PROFILE above — use the same words, not
      invented sub-services (e.g., if profile says "marketing consulting", say that — not
      "workshops", "funnels", "campaigns", or "CRM setup")
    - Never cite ROI numbers, percentages, or outcome metrics that are not explicitly in
      the sender profile — this includes numbers framed as "typical" or "industry average"
    - Never invent case studies, client names, results, or capabilities not in the profile
    - Never add integrations, features, or certifications the sender didn't list
    - If {include_case_study} is false or no case study data is provided, don't fabricate one
    - If the sender profile is vague, keep your claims vague to match — do not translate a
      vague value prop into specific tactics or specific measurable outcomes
    - When multiple services are listed, pitch ONLY the one most relevant to this lead's
      {industry} and pain points — not the full catalog
    - The sender's profile deserves the same respect as the prospect's research:
      if it's not in the data, it's not in the email

SUBJECT LINE REQUIREMENTS (HIGHEST PRIORITY):

MANDATORY Format: "Hi {contact_first_name}, [curiosity-provoking content]" OR "Hi {contact_first_name}: [curiosity-provoking content]"

You MUST:
- Start every subject line with "Hi {contact_first_name}"
- Use first name only (e.g., "Hi Sarah" not "Hi Sarah Johnson")
- Follow with comma or colon, then curiosity-provoking content
- NEVER use hyphens in subject lines
- Keep total length under 60 characters
- Make recipients want to click to learn more
- Base all curiosity hooks on ACTUAL business intelligence data

Choose ONE of these proven patterns:

Pattern 1 - Specific Discovery:
"Hi {contact_first_name}, spotted 3 quick wins for {company_name}"
"Hi {contact_first_name}: found 2 pipeline gaps at {company_name}"

Pattern 2 - What If Scenario:
"Hi {contact_first_name}, what if {company_name} could cut [Metric] by 30%?"
"Hi {contact_first_name}, what if {company_name} could double pipeline in 60 days?"

Pattern 3 - Competitive Intelligence:
"Hi {contact_first_name}, why {company_name}'s competitors switched from [Competitor]"
"Hi {contact_first_name}: what [CompetitorCustomer] learned about [PainPoint]"

Pattern 4 - Hidden Insight:
"Hi {contact_first_name}, the overlooked fix for {company_name}'s [PainPoint]"
"Hi {contact_first_name}: unconventional [Solution] for {company_name}"

Pattern 5 - Contrarian/Pattern Interrupt:
"Hi {contact_first_name}, {company_name} + this = [SpecificOutcome]"
"Hi {contact_first_name}: why [Industry] teams are ditching [OldApproach]"

Pattern 6 - Peer Proof:
"Hi {contact_first_name}, what companies like {company_name} are doing now"
"Hi {contact_first_name}: how teams like {company_name} solved [PainPoint]"

EMAIL GENERATION REQUIREMENTS:

CRITICAL LENGTH REQUIREMENT:
- Email body: 100-150 words MAXIMUM (excluding signature)
- Each paragraph: 1-2 sentences maximum
- Total paragraphs: 3-4 maximum
- If you write more than 150 words, you have failed the task
- Every word must justify its existence
- Cut ruthlessly, brevity is the priority

Signature Handling:
- Do NOT include any closing or signature in the model output
- Signature handling is managed separately after generation
- Never include placeholder signature text such as [Your Name]

1. PRIMARY EMAIL CREATION:

Subject line (CRITICAL):
- MUST follow format: "Hi {contact_first_name}, [curiosity-provoking content]" or "Hi {contact_first_name}: [curiosity-provoking content]"
- NEVER use hyphens after name or anywhere in subject
- Select the pattern that best matches the business intelligence gathered
- Use specific numbers, competitor names, or concrete details from RESEARCH ONLY
- Create strong curiosity that makes them want to read more
- Maximum 60 characters total
- Reference company name when space allows and it flows naturally
- Base all hooks on actual business intelligence data

Email Structure (100-150 words max):

MANDATORY Greeting:
- MUST start with "Hi {contact_first_name},"
- This is the very first line of the email body
- Matches the format used in follow-up emails
- Example: "Hi Sarah,"

Opening (1-2 sentences after greeting):
- Quick personalized reference based on business intelligence
- Must use proper grammar with pronouns and articles
- Examples:
  GOOD: "Hi Sarah,\n\nI noticed RevCo closed a Series A last month"
  BAD: "I noticed RevCo closed a Series A last month" (missing greeting)
  GOOD: "Hi John,\n\nI saw your blog post about manual prospecting challenges"
  BAD: "Noticed RevCo closed Series A last month" (missing greeting and article)
- Must be immediately relevant
- Full examples of complete openings:
  * "Hi Sarah,\n\nI noticed [Company] closed a Series A last month"
  * "Hi John,\n\nI saw [Company] posted several SDR roles recently"
  * "Hi David,\n\nI read your earnings call transcript mentioning pipeline challenges"

Body Paragraph 1 (1-2 sentences):
- State their challenge or opportunity identified in business intelligence
- Be specific, use actual research data
- Example: "That growth usually creates a lead quality challenge when scaling the sales team."

Body Paragraph 2 (1-2 sentences):
- Quick proof point with specific results
- Reference REAL competitors ONLY if they're in business intelligence
- If NO competitor names available → use vague social proof: "a [location] [type] company", "teams at your stage"
- Include concrete numbers from research or industry data
- Example with competitors: "Mixpanel and Amplitude both solved this by automating lead generation. Amplitude saw their SDR team focus 80% of time on qualified conversations instead of list building."
- Example without competitors: "We worked with a Waco service company to solve this. They reclaimed 15 hours per week without hiring."
- NEVER fabricate competitor names or use "similar companies" as placeholder

Body Paragraph 3 (1 sentence):
- What you can offer them specifically
- Example: "I built a demo showing how an AI agent would work for MetricFlow's ICP."

Call to Action (1 sentence):
- Simple, direct ask
- Specific time commitment (15-30 minutes)
- Should immediately follow the offer
- Example: "Want 20 minutes to see it in action?"

P.S. (Optional, 1 sentence):
- Additional value hook or proof element
- Must add genuine value, not filler
- Keep numbers VAGUE unless exact data from research
- Use qualitative language: "several", "some", "multiple", "examples"
- Never use specific placeholder numbers
- **CRITICAL: DO NOT include "P.S." prefix in your output - it will be added automatically**
- Examples of CONTENT ONLY (no "P.S." prefix):
  GOOD: "I can share the competitor analysis I pulled on Mixpanel and Amplitude"
  GOOD: "The system identified prospects matching your criteria. Want to see some examples?"
  BAD: "P.S. I can share..." (prefix will be duplicated - just write the content)
  BAD: "Agent found 87 qualified leads in 48 hours"
  BAD: "I identified 143 accounts matching your ICP"

2. PERSONALIZATION INTEGRATION:

Be selective with business intelligence:
- Pick the 1-2 MOST compelling personalization elements
- Don't list everything you know
- Quality beats quantity
- Use specific numbers and company names when possible from research
- Show research without being exhaustive
- Make every detail count
- All personalization must come from provided business intelligence

Focus areas:
- Most pressing pain point (pick ONE from research)
- Most relevant value proposition (pick ONE from research)
- Most compelling proof point (pick ONE, use ONLY real competitor names from research)
- Strongest competitive or peer insight (ONLY if competitor names are in research)
- If NO competitor data → use stage/size-based insights or vague social proof instead

3. FOLLOW-UP SEQUENCE (if requested):

CRITICAL: Follow-ups must be even MORE concise and punchy than primary email.
Target: 80-120 words maximum (excluding any signature block if one is added later). Do NOT include a closing or signature in follow-up body content.

Follow-up Email Structure Template:

Opening (1 sentence):
"Hi {contact_first_name},"

Body (2-3 short sentences):
- New angle or value point (1 sentence)
- Quick proof or insight (1 sentence)
- Specific offer or next step (1 sentence)

Call-to-Action (1 sentence):
- Direct, specific ask with timeframe
- End the generated body here. Do not add a closing or signature.

Example Follow-up:
"Hi Sarah,

Quick note on the pipeline gaps we discussed. Three RevOps teams at your stage cut manual work by 40% using automated lead scoring.

Want 15 minutes to see how it works for MetricFlow?"

Follow-up Timing and Angles:

Email 1 (3-5 days after primary):
- New angle, different curiosity hook
- 80-120 words max (EXCLUDING signature)
- Different proof point than primary (use different real competitors)
- Value-added content or resource
- Different CTA
- NO hyphens in subject or body

Email 2 (1 week after Email 1):
- Another unique curiosity-driven subject line (no hyphens)
- 80-120 words max (EXCLUDING signature)
- Social proof or peer comparison focus (real company names)
- Different value angle
- Collaborative next step CTA
- NO hyphens anywhere


MANDATORY Requirements for ALL follow-ups:

LENGTH REQUIREMENTS (CRITICAL):
- Body: 80-120 words MAXIMUM (excluding signature)
- Even shorter and punchier than primary email
- Every single word must justify its existence
- Cut ruthlessly - extreme brevity is the priority
- If longer than 120 words (excluding signature), you have FAILED

FORMAT REQUIREMENTS (CRITICAL):
- Do NOT include a professional closing in the generated body
- Do NOT include a signature in the generated body
- End the generated body with the CTA

CONTENT REQUIREMENTS:
- Each must have UNIQUE subject line following "Hi {contact_first_name}, " or "Hi {contact_first_name}: " format
- NEVER use hyphens in any follow-up subject lines or bodies
- Each must use DIFFERENT curiosity pattern from primary and other follow-ups
- No repeated content or angles
- Use different real competitor names in each follow-up ONLY if available in research
- If NO competitor data → vary the industry/stage-based insights across follow-ups
- Every follow-up should feel fresh and provide new value
- Keep the same tight, punchy writing style
- All information must come from business intelligence

CONSISTENCY REQUIREMENTS:
- Maintain professional tone throughout sequence
- Match primary email's level of personalization
- Keep brand voice consistent

4. QUALITY STANDARDS:

DO:
- Write 100-150 words max (excluding signature)
- Use 1-2 sentence paragraphs
- Get to the point in first 3 lines
- Include specific numbers and results from research
- Use white space generously
- Make every word count
- Be conversational and confident
- Lead with outcomes, not features
- Use proper grammar with pronouns and articles
- Use ONLY real competitor names explicitly in business intelligence
- If NO competitor names → focus on stage/size/industry insights
- Base all claims on business intelligence data
- Keep P.S. numbers vague unless exact data exists

DON'T:
- Write long paragraphs (max 2 sentences)
- Exceed 150 words
- Include feature lists or descriptions
- Use unnecessary adjectives or fluff
- Repeat yourself
- Over-explain
- List all the research you did
- Include multiple CTAs
- Use hyphens anywhere in email or subject
- Drop pronouns or articles
- Say "a similar company" instead of real names
- Make up information not in business intelligence
- Use specific numbers in P.S. without real data

FINAL INSTRUCTION:
Create an email that is SHORT, PUNCHY, and SCANNABLE (100-150 words max excluding any signature block if one is added later). MANDATORY: Start the email body with "Hi {contact_first_name}," - this is non-negotiable. Do NOT include any closing or signature in the generated content. Every sentence must justify its existence. Use ONLY real data from the business intelligence provided. Use real competitor names, never vague references. Never use hyphens anywhere. The subject line should make {contact_first_name} think "I need to read this" while the body gets straight to the value without wasting their time. Write like you're texting a colleague who respects research and specificity, not pitching a stranger. If your email is longer than 150 words, cut it down ruthlessly until it is. Base every claim on the business intelligence data provided.
""")
        ])
        
        # Format competitor context
        competitor_context = ""
        if competitors:
            top_competitors = competitors[:3]
            competitor_context = "; ".join([
                f"{comp.get('name', 'Unknown')}" for comp in top_competitors
            ])

        # Extract contact first name for subject line personalization
        contact_first_name = (lead.contact_name or "there").split()[0] if lead.contact_name else "there"

        # Check if this is a retry attempt with previous QA feedback
        retry_count = state.get("retry_count", 0)
        previous_feedback = state.get("previous_quality_feedback", [])

        # Build QA improvement context for retry attempts
        qa_improvement_context = ""
        if retry_count > 0 and previous_feedback:
            latest_feedback = previous_feedback[-1]
            qa_improvement_context = f"""
IMPORTANT - QUALITY IMPROVEMENT REQUIRED (Retry Attempt {retry_count}):

Previous Email Issues:
{chr(10).join(f"- {issue}" for issue in latest_feedback.get("issues", [])[:5])}

Required Improvements:
{chr(10).join(f"- {suggestion}" for suggestion in latest_feedback.get("suggestions", [])[:5])}

Missing Elements:
{chr(10).join(f"- {element}" for element in latest_feedback.get("missing_elements", [])[:3])}

Weak Areas to Strengthen:
{chr(10).join(f"- {area.replace('_', ' ').title()}" for area, is_weak in latest_feedback.get("weak_areas", {}).items() if is_weak)}

You MUST address all issues and incorporate all suggestions to create a significantly improved email.
Focus especially on the weak areas identified above. Previous quality score: {latest_feedback.get("quality_score", 0):.2f}
Target score: ≥0.65 for approval.
"""
            logger.info(f"Retry {retry_count}: Using QA feedback to improve email generation")

        # Execute email generation with optional QA feedback and PostHog LLM analytics
        messages = prompt.format_messages(
            # Quality improvement context (for retries)
            qa_improvement_context=qa_improvement_context,

            # Prospect information
            company_name=lead.company_name,
            contact_name=lead.contact_name or "there",
            contact_first_name=contact_first_name,
            title=lead.title or "professional",
            industry=getattr(lead, 'industry', '') or "your industry",
            company_size=getattr(lead, 'company_size', '') or "your organization",
            qualification_level=qualification_level,
            relevance_score=relevance_score,

            # Lead tier for B-tier handling
            lead_tier=lead_tier,

            # Business intelligence
            company_overview=company_overview[:500],  # Limit length for prompt
            pain_points_list="\n".join(f"- {pp}" for pp in pain_points[:5]),
            value_matches_list="\n".join(f"- {vm}" for vm in value_matches[:5]),
            personalization_elements_list="\n".join(f"- {pe}" for pe in personalization_elements[:8]),
            engagement_hooks_list="\n".join(f"- {eh}" for eh in engagement_hooks[:5]),
            messaging_strategy=messaging_strategy,
            industry_insights=industry_insights[:300] if industry_insights else "No specific industry insights available",
            competitor_context=competitor_context or "No competitor data available",

            # RAW RESEARCH DATA - ALL bullet points from Tavily/Perplexity searches
            # This ensures COMPLETE research results are available for email personalization
            recent_news_raw="\n".join(f"- {item}" for item in recent_news[:10]) or "No recent news available",
            competitor_mentions_raw="\n".join(f"- {item}" for item in competitor_mentions[:10]) or "No competitor mentions available",
            quantifiable_metrics_raw="\n".join(f"- {item}" for item in quantifiable_metrics[:10]) or "No quantifiable metrics available",
            pain_points_raw="\n".join(f"- {item}" for item in pain_point_research[:10]) or "No pain point research available",
            industry_benchmarks_raw="\n".join(f"- {item}" for item in industry_benchmarks[:10]) or "No industry benchmarks available",
            technology_stack_raw="\n".join(f"- {item}" for item in technology_stack[:10]) or "No technology stack data available",

            # Our company profile
            our_company=business_profile.company_name,
            our_contact_name=sender_name or business_profile.company_name,
            our_contact_email=sender_email or "",
            our_contact_phone=sender_phone or "",
            our_contact_website=sender_website or sender_linkedin or "",
            our_value_prop=business_profile.value_proposition,
            our_services=", ".join(business_profile.services[:5]) if business_profile.services else "No services listed",
            our_differentiators=", ".join(business_profile.key_differentiators[:3]) if business_profile.key_differentiators else "No differentiators listed",

            # Requirements
            tone=requirements.tone,
            length=requirements.length,
            cta=requirements.call_to_action,
            include_case_study=requirements.include_case_study,
            personalization_level=requirements.personalization_level,
            follow_up_sequence=requirements.follow_up_sequence,
        )
        email_sequence: EmailSequence = await llm.ainvoke(
            messages,
            config={"callbacks": callbacks}  # PostHog captures tokens, cost, latency
        )

        # Post-process to clean up any duplicate content between fields
        # This is a safety net for when the LLM includes greeting/CTA in multiple fields
        email_sequence = _clean_duplicate_content(email_sequence, contact_first_name)

        execution_time = time.time() - start_time

        # Create primary email content
        primary_email = EmailContent(
            subject=email_sequence.primary_subject,
            body=f"{email_sequence.primary_opening}\n\n{email_sequence.primary_body}\n\n{email_sequence.primary_cta}",
            personalization_notes=email_sequence.personalization_elements + email_sequence.business_context_usage,
            estimated_effectiveness=email_sequence.estimated_effectiveness
        )

        primary_email.body = append_signature(primary_email.body)
        
        # Add P.S. if provided
        if email_sequence.primary_ps:
            primary_email.body += f"\n\nP.S. {email_sequence.primary_ps}"
        
        # Create follow-up sequence if requested
        follow_up_sequence = None
        follow_up_plans: List[FollowUpEmailPlan] = list(email_sequence.follow_up_emails)
        if requirements.follow_up_sequence and follow_up_plans:
            contact_name = lead.contact_name or "there"
            company_name = lead.company_name
            primary_value = (
                value_matches[0]
                if value_matches
                else business_profile.value_proposition
            )

            follow_up_emails: List[EmailContent] = []
            personalization_notes = list(
                dict.fromkeys(
                    email_sequence.personalization_elements
                    + email_sequence.business_context_usage
                )
            )

            for index, follow_up in enumerate(follow_up_plans):
                subject = (follow_up.subject or "").strip() or f"Follow-up {index + 1}"

                # Follow-up body already contains greeting, body, and CTA from LLM
                # Just use it directly and add signature
                email_body = follow_up.body.strip() if follow_up.body else f"Hi {contact_name},\n\nFollowing up on our previous conversation."
                email_body = append_signature(email_body)

                estimated_effectiveness = max(
                    email_sequence.estimated_effectiveness * 0.8 - (index * 0.05),
                    0.3,
                )

                follow_up_emails.append(
                    EmailContent(
                        subject=subject,
                        body=email_body,
                        personalization_notes=personalization_notes,
                        estimated_effectiveness=estimated_effectiveness,
                    )
                )

            default_schedule = email_sequence.timing_schedule or [3, 7, 14]
            if len(default_schedule) < len(follow_up_emails):
                last_interval = default_schedule[-1] if default_schedule else 7
                default_schedule = default_schedule + [
                    last_interval
                ] * (len(follow_up_emails) - len(default_schedule))

            follow_up_sequence = FollowUpSequence(
                sequence_id=f"sequence_{state['request_id']}",
                emails=follow_up_emails,
                timing_schedule=default_schedule[: len(follow_up_emails)],
                conversion_strategy=email_sequence.follow_up_strategy or messaging_strategy,
            )
            primary_value_text = (
                primary_value
                if isinstance(primary_value, str)
                else str(primary_value)
            )

            # Ensure we have enough distinct follow-up plans with meaningful variation
            deduped_plans: List[FollowUpEmailPlan] = []
            seen_subjects = set()

            def _add_plan(plan: FollowUpEmailPlan) -> None:
                subject = (plan.subject or "").strip()
                normalized = subject.lower()

                if not subject:
                    base_subject = f"Follow-up {len(deduped_plans) + 1}"
                    candidate = base_subject
                    suffix = 1
                    while candidate.lower() in seen_subjects:
                        suffix += 1
                        candidate = f"{base_subject} ({suffix})"
                    plan = plan.model_copy(update={"subject": candidate})
                    subject = candidate
                    normalized = subject.lower()

                if normalized in seen_subjects:
                    return

                seen_subjects.add(normalized)
                deduped_plans.append(plan)

            for plan in follow_up_plans:
                _add_plan(plan)
                # Stop if we've reached the maximum
                if len(deduped_plans) >= MAX_FOLLOW_UP_EMAILS:
                    break

            if len(deduped_plans) < MIN_FOLLOW_UP_EMAILS:
                fallback_plans = _generate_fallback_followups(
                    lead=lead,
                    business_profile=business_profile,
                    pain_points=pain_points,
                    value_matches=value_matches,
                    follow_up_strategy=email_sequence.follow_up_strategy,
                    call_to_action=requirements.call_to_action,
                )

                for fallback_plan in fallback_plans:
                    subject = (fallback_plan.subject or "").strip()
                    if subject and subject.lower() in seen_subjects:
                        unique_subject = (
                            f"{subject} ({len(deduped_plans) + 1})"
                        )
                        fallback_plan = fallback_plan.model_copy(
                            update={"subject": unique_subject}
                        )

                    _add_plan(fallback_plan)

                    # Stop if we've reached minimum OR maximum
                    if len(deduped_plans) >= MAX_FOLLOW_UP_EMAILS:
                        break
                    if len(deduped_plans) >= MIN_FOLLOW_UP_EMAILS:
                        break

            # Only add automatic follow-ups if we're still below minimum AND below maximum
            while len(deduped_plans) < MIN_FOLLOW_UP_EMAILS and len(deduped_plans) < MAX_FOLLOW_UP_EMAILS:
                index = len(deduped_plans) + 1
                auto_subject = f"Follow-up {index}"
                if auto_subject.lower() in seen_subjects:
                    auto_subject = f"Follow-up {index} ({company_name})"

                auto_plan = FollowUpEmailPlan(
                    subject=auto_subject,
                    body=(
                        f"Hi {contact_name},\n\n"
                        "Just wanted to keep the conversation going around how we can "
                        f"support {primary_value_text.lower()}. "
                        "Let me know if there's someone else on the team I should loop in "
                        "or if there's a better time to reconnect."
                    ),
                    objective="Maintain momentum and confirm next steps",
                    call_to_action=requirements.call_to_action,
                )

                seen_subjects.add(auto_subject.lower())
                deduped_plans.append(auto_plan)

            if deduped_plans:
                # Enforce maximum follow-up limit
                final_plans = deduped_plans[:MAX_FOLLOW_UP_EMAILS]

                follow_up_emails: List[EmailContent] = []
                for i, follow_up in enumerate(final_plans):
                    subject = follow_up.subject or f"Follow-up {i + 1}"
                    # Follow-up body already contains the CTA from LLM
                    # Just use it directly and add signature
                    body_text = follow_up.body.strip()
                    body_text = append_signature(body_text)

                    follow_up_email = EmailContent(
                        subject=subject,
                        body=body_text,
                        personalization_notes=email_sequence.personalization_elements,
                        estimated_effectiveness=email_sequence.estimated_effectiveness * 0.8,
                    )
                    follow_up_emails.append(follow_up_email)

                timing_schedule = email_sequence.timing_schedule or [3, 7, 14]
                if len(timing_schedule) < len(follow_up_emails):
                    default_timings = [3, 7, 14, 21, 28]
                    timing_schedule = (timing_schedule + default_timings)[
                        : len(follow_up_emails)
                    ]
                else:
                    timing_schedule = timing_schedule[:len(follow_up_emails)]

                follow_up_sequence = FollowUpSequence(
                    sequence_id=f"sequence_{state['request_id']}",
                    emails=follow_up_emails,
                    timing_schedule=timing_schedule,
                    conversion_strategy=email_sequence.follow_up_strategy or "Multi-touch nurture",
                )
        
        # Create comprehensive agent result
        agent_result = AgentResult(
            agent_name="Email Generation Agent",
            role="Personalized email writing and sequence strategy",
            output=f"Generated highly personalized email for {lead.company_name}. "
                   f"Subject: '{email_sequence.primary_subject}'. "
                   f"Personalization depth: {email_sequence.personalization_depth}. "
                   f"Used {len(email_sequence.business_context_usage)} business intelligence elements. "
                   f"Addressed {len(email_sequence.pain_points_addressed)} pain points. "
                   f"Effectiveness score: {email_sequence.estimated_effectiveness:.2f}. "
                   f"{'Follow-up sequence included.' if follow_up_sequence else 'Primary email only.'}",
            confidence_score=email_sequence.estimated_effectiveness,
            execution_time=execution_time
        )
        
        logger.info(f"Email generation completed for {lead.company_name}: "
                   f"Effectiveness={email_sequence.estimated_effectiveness:.2f}, "
                   f"Personalization={email_sequence.personalization_depth}, "
                   f"Time={execution_time:.2f}s")
        capture_event(
            "email_agent_completed",
            {
                **analytics_context,
                "estimated_effectiveness": email_sequence.estimated_effectiveness,
                "personalization_depth": email_sequence.personalization_depth,
                "personalization_elements": len(email_sequence.personalization_elements),
                "pain_points_addressed": len(email_sequence.pain_points_addressed),
                "follow_up_count": len(follow_up_sequence.emails) if follow_up_sequence else 0,
                "has_follow_up_sequence": bool(follow_up_sequence),
                "competitor_references": len(email_sequence.competitor_references),
                "industry_insights_used": len(email_sequence.industry_insights_used),
                "generation_duration_ms": execution_time * 1000,
            },
        )
        
        # Update state with generated email content
        return {
            "current_stage": "email_generation_complete",
            "primary_email": primary_email,
            "follow_up_sequence": follow_up_sequence,
            "email_metadata": {
                "personalization_depth": email_sequence.personalization_depth,
                "estimated_effectiveness": email_sequence.estimated_effectiveness,
                "engagement_probability": email_sequence.engagement_probability,
                "personalization_elements": email_sequence.personalization_elements,
                "business_context_usage": email_sequence.business_context_usage,
                "competitor_references": email_sequence.competitor_references,
                "industry_insights_used": email_sequence.industry_insights_used,
                "key_value_propositions": email_sequence.key_value_propositions,
                "pain_points_addressed": email_sequence.pain_points_addressed,
                "proof_points_included": email_sequence.proof_points_included
            },
            "agent_results": [*state.get("agent_results", []), agent_result],
            "processing_times": {
                **state.get("processing_times", {}),
                "email_generation": execution_time
            },
            "confidence_scores": {
                **state.get("confidence_scores", {}),
                "email_generation": email_sequence.estimated_effectiveness
            },
            "quality_gates_passed": {
                **state.get("quality_gates_passed", {}),
                "email_generation": email_sequence.estimated_effectiveness >= 0.6,
                "personalization_depth": email_sequence.personalization_depth in ["Deep", "Medium"]
            }
        }
        
    except Exception as e:
        import traceback
        import sentry_sdk
        execution_time = time.time() - start_time

        # Comprehensive error logging with full context
        error_details = {
            "error_type": type(e).__name__,
            "error_message": str(e),
            "lead_company": lead.company_name if lead else "Unknown",
            "lead_id": getattr(lead, 'id', 'Unknown'),
            "request_id": state.get('request_id', 'Unknown'),
            "execution_time": execution_time,
            "stack_trace": traceback.format_exc()
        }
        capture_error(
            "email_agent_failed",
            e,
            {
                **analytics_context,
                "generation_duration_ms": execution_time * 1000,
            },
        )

        # Send structured context to Sentry
        sentry_sdk.set_context("email_generation_error", {
            "agent": "Email Generation Agent",
            "error_type": error_details['error_type'],
            "lead_company": error_details['lead_company'],
            "lead_id": error_details['lead_id'],
            "request_id": error_details['request_id'],
            "execution_time_seconds": error_details['execution_time'],
            "has_business_intelligence": state.get('business_intelligence') is not None,
            "has_requirements": requirements is not None,
            "has_business_profile": business_profile is not None
        })

        # Capture exception in Sentry with full context
        sentry_sdk.capture_exception(e)

        logger.error(
            f"CRITICAL ERROR in Email Generation Agent:\n"
            f"  Error Type: {error_details['error_type']}\n"
            f"  Error Message: {error_details['error_message']}\n"
            f"  Lead: {error_details['lead_company']} (ID: {error_details['lead_id']})\n"
            f"  Request ID: {error_details['request_id']}\n"
            f"  Execution Time: {error_details['execution_time']:.2f}s\n"
            f"  Full Stack Trace:\n{error_details['stack_trace']}"
        )

        # Create error result
        agent_result = AgentResult(
            agent_name="Email Generation Agent",
            role="Personalized email writing and sequence strategy",
            output=f"Error during email generation: {error_details['error_type']}: {error_details['error_message']}",
            confidence_score=0.1,
            execution_time=execution_time
        )
        
        return {
            "current_stage": "error",
            "primary_email": None,
            "email_metadata": {
                "error": str(e),
                "estimated_effectiveness": 0.1
            },
            "agent_results": [*state.get("agent_results", []), agent_result],
            "errors": [*state.get("errors", []), f"Email generation agent error: {str(e)}"]
        }
