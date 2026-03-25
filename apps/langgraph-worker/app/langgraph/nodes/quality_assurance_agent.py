"""
Quality Assurance Agent for LangGraph workflow
Validates email quality, personalization depth, and business context integration
to ensure high standards before final output.
"""
import time
import re
from typing import Dict, Any, List, Optional
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field
from ...utils.config import get_settings
from ...utils.logger import setup_logger
from ...utils.research_clients import ClientRegistry
from ...utils.analytics import capture_event, capture_error
from ...models.lead_models import AgentResult
from ..state import EmailGenerationState

logger = setup_logger(__name__)
settings = get_settings()

# Tier-based approval thresholds
# B-tier leads have lower thresholds since they have less research data for personalization
APPROVAL_THRESHOLDS = {
    "A": 0.60,  # Standard threshold for rich research
    "B": 0.50,  # Lower threshold for B-tier (less personalization expected)
}

class QualityAssessment(BaseModel):
    """Comprehensive quality assessment for generated email"""
    # Overall quality scores
    overall_quality_score: float = Field(..., ge=0, le=1, description="Overall email quality score (0.0 to 1.0)")
    approval_status: str = Field(..., description="Must be exactly one of: Approved, Needs_Improvement, or Rejected")
    
    # Specific quality dimensions (all scores 0.0-1.0)
    personalization_score: float = Field(..., ge=0, le=1, description="Personalization depth and accuracy (0.0-1.0, must not be exactly 0.0 unless truly terrible)")
    business_context_score: float = Field(..., ge=0, le=1, description="Business intelligence integration (0.0-1.0, must not be exactly 0.0 unless truly terrible)")
    professional_tone_score: float = Field(..., ge=0, le=1, description="Professional tone and language (0.0-1.0, must not be exactly 0.0 unless truly terrible)")
    value_proposition_score: float = Field(..., ge=0, le=1, description="Value proposition clarity and relevance (0.0-1.0, must not be exactly 0.0 unless truly terrible)")
    call_to_action_score: float = Field(..., ge=0, le=1, description="CTA clarity and appropriateness (0.0-1.0, must not be exactly 0.0 unless truly terrible)")
    
    # Content analysis
    personalization_elements_found: List[str] = Field(..., description="Personalization elements identified in email")
    business_intelligence_usage: List[str] = Field(..., description="Business intelligence elements used")
    pain_points_addressed: List[str] = Field(..., description="Pain points properly addressed")
    value_propositions_clear: List[str] = Field(..., description="Clear value propositions identified")
    
    # Quality issues and improvements
    quality_issues: List[str] = Field(default_factory=list, description="Issues found that need improvement")
    improvement_suggestions: List[str] = Field(default_factory=list, description="Specific improvement recommendations")
    missing_elements: List[str] = Field(default_factory=list, description="Important missing elements")
    
    # Compliance and standards
    length_appropriate: bool = Field(..., description="Email length within guidelines")
    subject_line_effective: bool = Field(..., description="Subject line follows best practices")
    professional_standards: bool = Field(..., description="Meets professional communication standards")
    personalization_depth: str = Field(..., description="Deep, Medium, Surface, or Minimal")
    
    # Recommendations
    final_recommendation: str = Field(..., description="Final recommendation for this email")
    confidence_in_assessment: float = Field(..., ge=0, le=1, description="Confidence in quality assessment")

async def quality_assurance_agent_node(state: EmailGenerationState) -> Dict[str, Any]:
    """
    Quality Assurance Agent that validates:
    1. Email quality against professional standards
    2. Personalization depth and accuracy
    3. Business intelligence integration effectiveness
    4. Professional tone and communication standards
    5. Value proposition clarity and relevance
    6. Call-to-action appropriateness
    
    This agent acts as the final quality gate before email approval,
    ensuring high standards and providing improvement recommendations.
    
    Args:
        state: Current workflow state with generated email content
        
    Returns:
        Updated state with quality assessment and final validation
    """
    start_time = time.time()
    lead = state["lead"]
    business_intelligence = state.get("business_intelligence", {})
    primary_email = state.get("primary_email")
    email_metadata = state.get("email_metadata", {})
    
    provider_keys: Optional[Dict[str, str]] = state.get("provider_keys")
    provider_key_map = provider_keys or {}
    using_user_keys = provider_keys is not None
    registry = ClientRegistry.get_instance()

    # Extract PostHog LLM callback for analytics
    llm_callback = state.get("llm_callback")
    callbacks = [llm_callback] if llm_callback else []

    # Get lead tier for tier-aware approval thresholds
    lead_tier = state.get("lead_tier", "A")  # Default to A if not set
    lead_tier_reason = state.get("lead_tier_reason", "")
    approval_threshold = APPROVAL_THRESHOLDS.get(lead_tier, 0.60)
    business_profile = state["business_profile"]
    contact_info = getattr(business_profile, "contact_info", {}) or {}
    raw_signature_enabled = contact_info.get("signatureEnabled", True)
    signature_enabled = not (
        raw_signature_enabled is False
        or (
            isinstance(raw_signature_enabled, str)
            and raw_signature_enabled.strip().lower() in {"0", "false", "no", "off"}
        )
    )
    signature_requirement = (
        "A professional closing and complete signature are required for this request."
        if signature_enabled
        else "Signature appending is disabled for this request. Do not require a closing or signature, but flag any closing or signature that appears."
    )
    sender_name = contact_info.get("name") or contact_info.get("contactName") or ""
    sender_email = contact_info.get("email", "")
    sender_phone = contact_info.get("phone", "")
    sender_website = contact_info.get("website", "")
    sender_linkedin = contact_info.get("linkedin", "")
    sender_signature = (contact_info.get("signature", "") or "").strip()
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
            getattr(business_profile, "company_name", ""),
            sender_email,
            sender_phone,
            sender_website,
            sender_linkedin,
        )
        if isinstance(value, str) and value.strip()
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

    def has_signature_like_tail(body: str) -> bool:
        lines = body.splitlines()
        end = len(lines) - 1
        while end >= 0 and not lines[end].strip():
            end -= 1

        if end < 0:
            return False

        saw_signature_content = False
        idx = end
        while idx >= 0:
            stripped = lines[idx].strip()
            if not stripped:
                idx -= 1
                continue
            if is_signature_tail_line(stripped):
                saw_signature_content = True
                idx -= 1
                continue
            break

        return saw_signature_content

    logger.info(f"Starting quality assurance for {lead.company_name} (Tier: {lead_tier}, Threshold: {approval_threshold})")
    if lead_tier == "B":
        logger.info(f"B-tier lead detected: {lead_tier_reason} - using lower approval threshold")
    logger.warning("⚠️ QA AGENT IN TEMPORARY MODE: Research quality validation DISABLED - only checking grammar/guidelines")
    analytics_context = {
        "request_id": state.get("request_id"),
        "lead_id": getattr(lead, "id", None),
        "company_name": lead.company_name,
        "user_id": state.get("user_id"),
        "user_tier": state.get("user_tier", "free"),
        "lead_tier": lead_tier,
        "lead_tier_reason": lead_tier_reason,
        "approval_threshold": approval_threshold,
        "using_user_keys": using_user_keys,
        "provider_keys_supplied": sorted(provider_key_map.keys()) if using_user_keys else [],
        "has_primary_email": primary_email is not None,
    }
    capture_event("qa_agent_started", analytics_context)
    
    try:
        # Validate required data availability - skip gracefully if no email
        if not primary_email:
            logger.warning("No email content available for quality assessment - skipping QA")
            capture_event("qa_agent_skipped", {
                **analytics_context,
                "skip_reason": "no_email_content",
                "duration_ms": 0
            })

            # Return skip result instead of raising error
            return {
                "current_stage": "quality_assurance_complete",
                "quality_assessment": {
                    "overall_quality_score": 0.0,
                    "approval_status": "Skipped - Missing Email",
                    "skip_reason": "no_email_content",
                    "personalization_score": 0.0,
                    "professionalism_score": 0.0,
                    "effectiveness_score": 0.0,
                    "issues_found": ["No email content to assess"],
                    "strengths_identified": [],
                    "improvement_suggestions": ["Generate email content before quality assessment"]
                },
                "final_result": {
                    "email_approved": False,
                    "quality_score": 0.0,
                    "skipped": True,
                    "skip_reason": "missing_email_content",
                    "error": "No email content available for quality assessment"
                },
                "agent_results": [*state.get("agent_results", []), AgentResult(
                    agent_name="Quality Assurance Agent",
                    role="Email quality validation and approval",
                    output="Skipped - No email content available for quality assessment",
                    confidence_score=0.0,
                    execution_time=0.0
                )],
                "errors": [*state.get("errors", []), "QA skipped: No email content"]
            }

        if not business_intelligence:
            logger.warning("No business intelligence available for quality assessment")
        
        # Extract email content for analysis
        email_subject = primary_email.subject
        email_body = primary_email.body
        email_personalization = primary_email.personalization_notes
        
        # Extract business intelligence context
        pain_points = business_intelligence.get("pain_points", [])
        value_matches = business_intelligence.get("value_matches", [])
        personalization_elements = business_intelligence.get("personalization_elements", [])
        company_overview = business_intelligence.get("company_overview", "")
        
        logger.info(f"Analyzing email quality: Subject='{email_subject[:50]}...', "
                   f"Body length={len(email_body)} chars")

        # Debug: Log first 500 chars of email body to check for placeholders
        logger.debug(f"Email body preview for {lead.company_name}: {email_body[:500]}...")
        
        # Initialize LLM for quality assessment
        # GPT-5-mini: Reasoning model with 1500 token budget for scoring and validation
        # Supports reasoning_effort parameter for optimized quality assessment
        openai_api_key = provider_key_map.get("openai") if using_user_keys else None
        qa_model = settings.quality_assurance_model or settings.default_model
        qa_token_budget = settings.clamp_tokens(settings.quality_assurance_max_tokens)
        llm = registry.get_openai_client(
            api_key=openai_api_key,
            model=qa_model,
            temperature=0.2,
            max_completion_tokens=qa_token_budget,
            reasoning_effort="low",  # GPT-5.1 supports: low, medium, high
            require_user_key=using_user_keys,
        ).with_structured_output(QualityAssessment)
        
        # Create comprehensive quality assessment prompt - ALIGNED WITH EXACT EMAIL GENERATION STANDARDS
        prompt = ChatPromptTemplate.from_messages([
            ("system", """You are an expert email quality assurance specialist validating emails against STRICT B2B email standards.

Your role is to rigorously validate emails against these EXACT requirements from the email generation system:

CRITICAL VALIDATION RULES (HIGHEST PRIORITY):

1. NO HYPHENS RULE (MANDATORY - AUTO-REJECT IF VIOLATED):
   - NEVER allow hyphens in subject lines or email body
   - Subject format MUST be: "Hi [FirstName], [content]" or "Hi [FirstName]: [content]"
   - In body: commas, periods, or separate sentences only
   - Any hyphen usage = INSTANT FAILURE, score penalty of -0.3 minimum
   - Check EVERY line for hyphens, including P.S. and signature

2. SUBJECT LINE VALIDATION (MANDATORY):
   - MUST start with "Hi [FirstName]" (first name only, not full name)
   - MUST use comma or colon after name (no hyphens!)
   - Total length MUST be under 60 characters
   - MUST avoid generic phrases: "touching base", "following up", "checking in", "quick question"
   - MUST be based on ACTUAL business intelligence (no fabricated curiosity hooks)
   - MUST use one of these proven patterns:
     * Specific Discovery: "Hi [name], spotted 3 quick wins..."
     * What If Scenario: "Hi [name], what if [company] could..."
     * Competitive Intelligence: "Hi [name], why [company]'s competitors..."
     * Hidden Insight: "Hi [name]: the overlooked fix..."
     * Contrarian/Pattern Interrupt: "Hi [name], [company] + this = ..."
     * Peer Proof: "Hi [name], what companies like [company]..."

3. LENGTH VALIDATION (MANDATORY):
   - Email body MUST be 100-165 words (excluding signature)
   - Each paragraph MUST be 1-2 sentences maximum
   - Total paragraphs MUST be 3-4 maximum
   - If over 165 words = FAILURE, significant score penalty
   - Count words carefully, do not estimate

4. NATURAL LANGUAGE VALIDATION (MANDATORY):
   - MUST use complete sentences with proper grammar
   - MUST include articles (a, an, the) appropriately
   - MUST include pronouns (I, we, our) naturally
   - MUST NOT drop pronouns or articles
   - Examples:
     GOOD: "I noticed RevCo closed a Series A last month"
     BAD: "Noticed RevCo closed Series A last month"

5. DATA INTEGRITY VALIDATION (TEMPORARILY DISABLED):
   - SKIP all research quality checks for now
   - DO NOT penalize for poor business intelligence
   - DO NOT penalize for generic competitor references
   - DO NOT penalize for lack of specific numbers
   - Focus ONLY on grammar, structure, and guidelines
   - Research quality issues: flag but don't reject

6. P.S. VALIDATION (if present):
   - Numbers MUST be VAGUE unless exact data from research
   - Use qualitative language: "several", "some", "multiple"
   - NO specific placeholder numbers like "47 prospects", "143 accounts"
   - Must add genuine value, not filler

7. HYPE LANGUAGE VALIDATION:
   - NO "10x" language allowed
   - Use realistic multipliers (2x, 3x, 5x with context)
   - Avoid Grant Cardone style exaggeration

8. STRUCTURE VALIDATION:
   - Opening: 1-2 sentences with personalized hook
   - Body paragraph 1: Challenge/opportunity (1-2 sentences)
   - Body paragraph 2: Proof point with results (1-2 sentences)
   - Body paragraph 3: Specific offer (1 sentence)
   - CTA: One simple sentence, immediately following offer
   - Signature expectation: {signature_requirement}

9. SIGNATURE VALIDATION:
   - Signature mode for this request: {signature_requirement}
   - If signatures are enabled: require a professional closing and complete signature (Name, Company, Email, Phone, Website)
   - If signatures are disabled: any closing or signature is a violation and should be flagged
   - NO placeholder text like "[Your Name]", "Company Name"
   - For sequences with signatures enabled: ALL emails MUST have identical signature format

Quality Scoring Standards (RESEARCH VALIDATION TEMPORARILY DISABLED):
- A-Tier Leads (rich research): ≥0.60 = Approved, 0.35-0.60 = Needs_Improvement, <0.35 = Rejected
- B-Tier Leads (minimal research): ≥0.50 = Approved, 0.35-0.50 = Needs_Improvement, <0.35 = Rejected
- Current lead tier: {lead_tier}
- NO HYPHENS violation = Auto-deduct 0.3 from overall score minimum
- Length over 165 words = Auto-deduct 0.2 from overall score
- Missing articles/pronouns = Deduct 0.1 per occurrence (up to 0.3 total)
- Research quality issues = Flag in suggestions but DO NOT reject or deduct points

B-TIER LEAD SPECIAL INSTRUCTIONS (if lead_tier is "B"):
- DO NOT penalize for lack of deep personalization
- DO NOT penalize for missing research-specific elements
- DO NOT penalize for using generic competitor references
- DO NOT penalize for lack of specific metrics/numbers
- Focus validation ONLY on: grammar, structure, professional tone, and signature rules when enabled
- Missing research elements are EXPECTED for B-tier and should NOT be flagged as issues

Assessment Criteria (all 0-1 scale, FOCUS ON GRAMMAR/GUIDELINES ONLY):
1. Personalization Score: Give generous scores (0.7+ baseline), note research issues but don't penalize
2. Business Context Score: Give generous scores (0.7+ baseline), research quality not critical
3. Professional Tone Score: Natural language, proper grammar, no hyphens (STRICT)
4. Value Proposition Score: Clarity and structure (research accuracy not critical)
5. Call-to-Action Score: Clear, specific, low-pressure, well-positioned (STRICT)

Keep feedback surgical and actionable (≤3 bullets per list, ≤2 sentences per bullet).
"""),
            ("human", """Conduct STRICT quality assessment of this generated email against EXACT requirements:

            ⚠️ TEMPORARY MODE: RESEARCH QUALITY VALIDATION DISABLED ⚠️
            - Focus ONLY on grammar, structure, hyphens, length, and professional tone
            - DO NOT reject or heavily penalize for poor business intelligence
            - DO NOT reject for generic competitor references or lack of specific data
            - Flag research issues in improvement_suggestions but give passing scores
            - Apply STRICT validation only for: hyphens, length, grammar, structure, and signature rules when enabled

            PROSPECT CONTEXT:
            Company: {company_name}
            Contact: {contact_name} ({title})
            Industry: {industry}

            BUSINESS INTELLIGENCE AVAILABLE (for verification):
            Pain Points Identified: {pain_points}
            Value Matches: {value_matches}
            Personalization Elements: {personalization_elements}
            Company Overview: {company_overview}

            EMAIL TO ASSESS:

            Subject: {email_subject}

            Body:
            {email_body}

            Declared Personalization Elements: {declared_personalization}

            MANDATORY QUALITY VALIDATION (CHECK EVERY RULE):

            1. NO HYPHENS CHECK (CRITICAL - HIGHEST PRIORITY):
            - Scan ENTIRE email (subject + body + P.S. + every line) for ANY hyphens
            - Check subject line format: MUST be "Hi [FirstName], [content]" or "Hi [FirstName]: [content]"
            - ANY hyphen found = INSTANT FAILURE with -0.3 minimum score penalty
            - Flag EVERY hyphen location in quality_issues
            - Add to improvement_suggestions: "Remove ALL hyphens - use commas, periods, or rewrite sentences"

            2. SUBJECT LINE STRICT VALIDATION (MANDATORY):
            - Does it start with "Hi [FirstName]" (first name only)?
            - Does it use comma or colon after name (NO HYPHENS)?
            - Is total length under 60 characters?
            - Does it avoid generic phrases ("touching base", "following up", "checking in", "quick question")?
            - Is curiosity hook based on ACTUAL business intelligence data above?
            - Does it match one of the 6 proven patterns (Specific Discovery, What If, Competitive Intelligence, Hidden Insight, Contrarian, Peer Proof)?
            - Flag violations in quality_issues with specific pattern it should use

            3. LENGTH VALIDATION (MANDATORY - COUNT CAREFULLY):
            - Count EXACT words in email body (excluding signature)
            - MUST be 100-165 words
            - Count paragraphs: MUST be 3-4 maximum
            - Count sentences per paragraph: MUST be 1-2 maximum
            - If over 165 words = add to quality_issues: "Email exceeds 165 word limit ([ACTUAL_COUNT] words)" and deduct 0.2 from score
            - If under 100 words = add to quality_issues: "Email under 100 word minimum"

            4. NATURAL LANGUAGE CHECK (MANDATORY):
            - Check for dropped pronouns or articles
            - Find sentences starting without "I", "We", articles
            - Example violations:
              * "Noticed RevCo closed..." (should be "I noticed RevCo closed...")
              * "Saw your blog post..." (should be "I saw your blog post...")
            - Flag EACH violation in quality_issues
            - Deduct 0.1 per violation (up to 0.3 total)

            5. DATA INTEGRITY VALIDATION (TEMPORARILY DISABLED):
            - SKIP data integrity validation for now
            - DO NOT check claims against business intelligence
            - DO NOT verify competitor names or numbers
            - DO NOT penalize for fabricated or generic information
            - Note research issues in improvement_suggestions but DO NOT reject or deduct points
            - Focus validation on grammar, structure, and guidelines only

            6. P.S. VALIDATION (if present):
            - Check for specific numbers ("47 prospects", "87 leads", "143 accounts")
            - MUST use vague qualitative language: "several", "some", "multiple", "examples"
            - Flag any specific placeholder numbers as violations
            - Verify P.S. adds genuine value (not filler)

            7. HYPE LANGUAGE CHECK:
            - Scan for "10x" language
            - Check for unrealistic claims or Grant Cardone style exaggeration
            - Flag any hype language in quality_issues

            8. STRUCTURE VALIDATION:
            - Opening: 1-2 sentences with personalized hook? (check)
            - Body paragraph 1: Challenge/opportunity in 1-2 sentences? (check)
            - Body paragraph 2: Proof point with results in 1-2 sentences? (check)
            - Body paragraph 3: Specific offer in 1 sentence? (check)
            - CTA: One simple sentence immediately following offer? (check)
            - Flag any structure violations in quality_issues

            9. SIGNATURE VALIDATION:
            - Has professional closing ("Best,", "Cheers,", "Best regards,")? (check)
            - Has complete signature (Name, Company, Email, Phone, Website)? (check)
            - NO placeholder text like "[Your Name]", "Company Name"? (check)
            - For sequences: ALL emails have identical signature? (check if follow-ups exist)
            - Flag any signature issues in quality_issues

            10. GRAMMAR AND SENTENCE STRUCTURE:
            - Complete sentences with proper subject-verb agreement? (check)
            - Natural pronoun usage (I, we, our)? (check)
            - Logical flow and transitions? (check)
            - CTA immediately follows offer? (check)
            - Flag grammar issues in quality_issues

            SCORING RULES (APPLY PENALTIES STRICTLY):
            - Start with base scores for each dimension
            - Apply automatic penalties ONLY for grammar and guidelines:
              * ANY hyphens found: -0.3 minimum from overall_quality_score
              * Over 165 words: -0.2 from overall_quality_score
              * Missing articles/pronouns: -0.1 each (up to -0.3 total)
              * "10x" hype language: -0.15 from overall_quality_score

            - TEMPORARILY DISABLED (DO NOT apply these penalties):
              * Fabricated data: NO PENALTY (disabled)
              * Vague competitor references: NO PENALTY (disabled)
              * Specific P.S. numbers without data: NO PENALTY (disabled)
              * Poor business intelligence usage: NO PENALTY (disabled)

            APPROVAL DECISION:
            - Calculate final overall_quality_score after all penalties
            - ≥0.60 = "Approved"
            - 0.35-0.60 = "Needs_Improvement"
            - <0.35 = "Rejected"

            Provide detailed assessment with:
            - Specific scores (after penalties)
            - Every violation found (be thorough and surgical)
            - Actionable improvement recommendations (≤3 bullets, ≤2 sentences each)
            - Focus on CRITICAL issues first (hyphens, length, data integrity, natural language)
            """)
        ])
        
        # Execute quality assessment with PostHog LLM analytics
        try:
            messages = prompt.format_messages(
                # Prospect context
                company_name=lead.company_name,
                contact_name=lead.contact_name or "Unknown",
                title=lead.title or "Professional",
                industry=getattr(lead, 'industry', '') or "Not specified",

                # Lead tier for tier-aware scoring
                lead_tier=lead_tier,
                signature_requirement=signature_requirement,

                # Business intelligence
                pain_points="; ".join(pain_points[:5]) if pain_points else "No pain points identified",
                value_matches="; ".join(value_matches[:5]) if value_matches else "No value matches identified",
                personalization_elements="; ".join(personalization_elements[:8]) if personalization_elements else "No personalization elements available",
                company_overview=company_overview[:400] if company_overview else "No company overview available",

                # Email content
                email_subject=email_subject,
                email_body=email_body,
                declared_personalization="; ".join(email_personalization) if email_personalization else "No personalization declared"
            )
            quality_assessment: QualityAssessment = await llm.ainvoke(
                messages,
                config={"callbacks": callbacks}  # PostHog captures tokens, cost, latency
            )

            # Debug logging for QA assessment results
            logger.info(f"QA Assessment scores for {lead.company_name}: "
                       f"Overall={quality_assessment.overall_quality_score:.2f}, "
                       f"Personalization={quality_assessment.personalization_score:.2f}, "
                       f"Business_Context={quality_assessment.business_context_score:.2f}, "
                       f"Professional_Tone={quality_assessment.professional_tone_score:.2f}, "
                       f"Value_Prop={quality_assessment.value_proposition_score:.2f}, "
                       f"CTA={quality_assessment.call_to_action_score:.2f}, "
                       f"Status={quality_assessment.approval_status}")

            # Detailed penalty breakdown for debugging failures
            if quality_assessment.overall_quality_score < 0.60:
                logger.warning(f"QA Penalty Breakdown for {lead.company_name} (Score: {quality_assessment.overall_quality_score:.2f}):")
                logger.warning(f"  Quality Issues Found ({len(quality_assessment.quality_issues)}):")
                for idx, issue in enumerate(quality_assessment.quality_issues[:10], 1):  # Top 10 issues
                    logger.warning(f"    {idx}. {issue}")
                logger.warning(f"  Improvement Suggestions ({len(quality_assessment.improvement_suggestions)}):")
                for idx, suggestion in enumerate(quality_assessment.improvement_suggestions[:5], 1):  # Top 5 suggestions
                    logger.warning(f"    {idx}. {suggestion}")
                logger.warning(f"  Missing Elements ({len(quality_assessment.missing_elements)}):")
                for idx, missing in enumerate(quality_assessment.missing_elements[:5], 1):  # Top 5 missing
                    logger.warning(f"    {idx}. {missing}")
                logger.warning(f"  Quality Gates: Length={quality_assessment.length_appropriate}, "
                              f"Subject={quality_assessment.subject_line_effective}, "
                              f"Professional={quality_assessment.professional_standards}")
                logger.warning(f"  Personalization Depth: {quality_assessment.personalization_depth}")
                logger.warning(f"  Final Recommendation: {quality_assessment.final_recommendation}")

        except Exception as llm_error:
            logger.error(f"LLM quality assessment failed for {lead.company_name}: {str(llm_error)}")
            raise

        placeholder_patterns = [
            re.compile(r"\[[^\]]*(?:your|company|insert|name|title|placeholder)[^\]]*\]", re.IGNORECASE),
            re.compile(r"\{\{[^}]+\}\}"),
            re.compile(r"<[^>]*placeholder[^>]*>", re.IGNORECASE),
            re.compile(
                r"\b(?:Your Name|Company Name|Insert Name|Insert Company)\b",
                re.IGNORECASE,
            ),
        ]

        placeholders_found = []
        for pattern in placeholder_patterns:
            placeholders_found.extend(pattern.findall(email_subject))
            placeholders_found.extend(pattern.findall(email_body))

        placeholder_lines = {
            "your name",
            "company name",
            "your company",
            "insert name",
            "insert company",
            "phone number",
            "email address",
            "contact info",
            "signature",
        }

        for line in email_body.splitlines():
            normalized_line = line.strip().lower()
            if normalized_line in placeholder_lines:
                placeholders_found.append(line.strip())

        cleaned_placeholders = sorted(
            {placeholder.strip() for placeholder in placeholders_found if placeholder.strip()}
        )

        if cleaned_placeholders:
            issue_text = (
                "Placeholder text detected that must be replaced: "
                + ", ".join(cleaned_placeholders[:5])
            )
            updated_quality_issues = list(quality_assessment.quality_issues)
            if issue_text not in updated_quality_issues:
                updated_quality_issues.append(issue_text)

            suggestion_text = (
                "Replace all placeholder text with actual sender and company details before sending."
            )
            updated_improvement_suggestions = list(
                quality_assessment.improvement_suggestions
            )
            if suggestion_text not in updated_improvement_suggestions:
                updated_improvement_suggestions.append(suggestion_text)

            updated_overall = min(quality_assessment.overall_quality_score, 0.6)
            updated_status = (
                "Needs_Improvement"
                if quality_assessment.approval_status == "Approved"
                else quality_assessment.approval_status
            )

            quality_assessment = quality_assessment.model_copy(
                update={
                    "quality_issues": updated_quality_issues,
                    "improvement_suggestions": updated_improvement_suggestions,
                    "overall_quality_score": updated_overall,
                    "approval_status": updated_status,
                }
            )

        if not signature_enabled and has_signature_like_tail(email_body):
            issue_text = "Signature toggle is off, but the email still ends with a closing or signature block."
            suggestion_text = "Remove the closing and signature lines so the email ends with the CTA or final body sentence."
            updated_quality_issues = list(quality_assessment.quality_issues)
            if issue_text not in updated_quality_issues:
                updated_quality_issues.append(issue_text)

            updated_improvement_suggestions = list(
                quality_assessment.improvement_suggestions
            )
            if suggestion_text not in updated_improvement_suggestions:
                updated_improvement_suggestions.append(suggestion_text)

            updated_overall = min(quality_assessment.overall_quality_score, 0.59)
            updated_status = (
                "Needs_Improvement"
                if quality_assessment.approval_status == "Approved"
                else quality_assessment.approval_status
            )

            quality_assessment = quality_assessment.model_copy(
                update={
                    "quality_issues": updated_quality_issues,
                    "improvement_suggestions": updated_improvement_suggestions,
                    "overall_quality_score": updated_overall,
                    "approval_status": updated_status,
                }
            )

        execution_time = time.time() - start_time

        # Determine final approval status based on tier-aware thresholds
        # B-tier leads use a lower threshold (0.50) since they have less research data
        overall_score = quality_assessment.overall_quality_score

        # Re-evaluate approval status using tier-based thresholds
        if overall_score >= approval_threshold:
            approval_status = "Approved"
        elif overall_score >= 0.35:
            approval_status = "Needs_Improvement"
        else:
            approval_status = "Rejected"

        # Log tier-aware approval decision
        if lead_tier == "B" and approval_status == "Approved" and overall_score < 0.60:
            logger.info(f"B-tier lead {lead.company_name} approved with score {overall_score:.2f} "
                       f"(below standard 0.60 threshold, using B-tier threshold {approval_threshold})")
        
        # Create comprehensive agent result
        agent_result = AgentResult(
            agent_name="Quality Assurance Agent",
            role="Email quality validation and standards enforcement",
            output=f"Quality assessment for {lead.company_name}: {approval_status}. "
                   f"Overall score: {overall_score:.2f}. "
                   f"Personalization: {quality_assessment.personalization_score:.2f} ({quality_assessment.personalization_depth}). "
                   f"Business context: {quality_assessment.business_context_score:.2f}. "
                   f"Professional tone: {quality_assessment.professional_tone_score:.2f}. "
                   f"Found {len(quality_assessment.quality_issues)} issues, "
                   f"{len(quality_assessment.improvement_suggestions)} improvement suggestions. "
                   f"Recommendation: {quality_assessment.final_recommendation}",
            confidence_score=quality_assessment.confidence_in_assessment,
            execution_time=execution_time
        )
        
        # Log quality assessment results
        if approval_status == "Approved":
            logger.info(f"Email APPROVED for {lead.company_name}: Score={overall_score:.2f}")
            capture_event(
                "qa_agent_approved",
                {
                    **analytics_context,
                    "overall_quality_score": overall_score,
                    "personalization_score": quality_assessment.personalization_score,
                    "business_context_score": quality_assessment.business_context_score,
                    "professional_tone_score": quality_assessment.professional_tone_score,
                    "value_proposition_score": quality_assessment.value_proposition_score,
                    "call_to_action_score": quality_assessment.call_to_action_score,
                    "personalization_depth": quality_assessment.personalization_depth,
                    "quality_duration_ms": execution_time * 1000,
                },
            )
        elif approval_status == "Needs_Improvement":
            logger.warning(f"Email NEEDS IMPROVEMENT for {lead.company_name}: Score={overall_score:.2f}, "
                          f"Issues: {len(quality_assessment.quality_issues)}")
            capture_event(
                "qa_agent_needs_improvement",
                {
                    **analytics_context,
                    "overall_quality_score": overall_score,
                    "approval_status": approval_status,
                    "personalization_score": quality_assessment.personalization_score,
                    "business_context_score": quality_assessment.business_context_score,
                    "professional_tone_score": quality_assessment.professional_tone_score,
                    "value_proposition_score": quality_assessment.value_proposition_score,
                    "call_to_action_score": quality_assessment.call_to_action_score,
                    "issues_found": len(quality_assessment.quality_issues),
                    "suggestions": len(quality_assessment.improvement_suggestions),
                    "missing_elements": len(quality_assessment.missing_elements),
                    "quality_issues": quality_assessment.quality_issues[:5],  # Top 5 issues
                    "personalization_depth": quality_assessment.personalization_depth,
                    "length_appropriate": quality_assessment.length_appropriate,
                    "subject_line_effective": quality_assessment.subject_line_effective,
                    "professional_standards": quality_assessment.professional_standards,
                    "quality_duration_ms": execution_time * 1000,
                    "failed_quality_gate": True,
                    "retry_needed": True,
                },
            )
        else:  # Rejected
            # Use WARNING not ERROR - rejection is business logic, not a system error
            logger.warning(f"Email REJECTED for {lead.company_name}: Score={overall_score:.2f}, "
                          f"Major issues found (Quality Gate - Expected Behavior)")
            capture_event(
                "qa_agent_rejected",
                {
                    **analytics_context,
                    "overall_quality_score": overall_score,
                    "approval_status": approval_status,
                    "personalization_score": quality_assessment.personalization_score,
                    "business_context_score": quality_assessment.business_context_score,
                    "professional_tone_score": quality_assessment.professional_tone_score,
                    "value_proposition_score": quality_assessment.value_proposition_score,
                    "call_to_action_score": quality_assessment.call_to_action_score,
                    "issues_found": len(quality_assessment.quality_issues),
                    "suggestions": len(quality_assessment.improvement_suggestions),
                    "missing_elements": len(quality_assessment.missing_elements),
                    "quality_issues": quality_assessment.quality_issues,  # All issues
                    "personalization_depth": quality_assessment.personalization_depth,
                    "length_appropriate": quality_assessment.length_appropriate,
                    "subject_line_effective": quality_assessment.subject_line_effective,
                    "professional_standards": quality_assessment.professional_standards,
                    "quality_duration_ms": execution_time * 1000,
                    "failed_quality_gate": True,
                    "retry_needed": True,
                    "critical_failure": True,
                },
            )

        # Always capture completion event for aggregate tracking
        capture_event(
            "qa_agent_completed",
            {
                **analytics_context,
                "overall_quality_score": overall_score,
                "approval_status": approval_status,
                "personalization_score": quality_assessment.personalization_score,
                "business_context_score": quality_assessment.business_context_score,
                "issues_found": len(quality_assessment.quality_issues),
                "suggestions": len(quality_assessment.improvement_suggestions),
                "quality_duration_ms": execution_time * 1000,
                "passed_qa": approval_status == "Approved",
                "failed_qa": approval_status != "Approved",
            },
        )
        
        # Prepare quality feedback for potential retry
        retry_count = state.get("retry_count", 0)
        previous_feedback = state.get("previous_quality_feedback", [])

        # If this email needs improvement and hasn't hit retry limit, save feedback for retry
        if approval_status == "Needs_Improvement" and overall_score >= 0.35:
            feedback_entry = {
                "attempt": retry_count + 1,
                "quality_score": overall_score,
                "issues": quality_assessment.quality_issues[:5],  # Top 5 issues
                "suggestions": quality_assessment.improvement_suggestions[:5],  # Top 5 suggestions
                "missing_elements": quality_assessment.missing_elements[:3],  # Top 3 missing
                "weak_areas": {
                    "personalization": quality_assessment.personalization_score < 0.65,
                    "business_context": quality_assessment.business_context_score < 0.65,
                    "value_proposition": quality_assessment.value_proposition_score < 0.65,
                    "call_to_action": quality_assessment.call_to_action_score < 0.65,
                }
            }
            updated_feedback = [*previous_feedback, feedback_entry]
            new_retry_count = retry_count + 1
            logger.info(f"Saving QA feedback for retry attempt {new_retry_count}")
        else:
            updated_feedback = previous_feedback
            new_retry_count = retry_count

        # Update state with quality assessment
        return {
            "current_stage": "quality_assurance_complete",
            "retry_count": new_retry_count,
            "previous_quality_feedback": updated_feedback,
            "quality_assessment": {
                "overall_quality_score": quality_assessment.overall_quality_score,
                "approval_status": quality_assessment.approval_status,
                "personalization_score": quality_assessment.personalization_score,
                "business_context_score": quality_assessment.business_context_score,
                "professional_tone_score": quality_assessment.professional_tone_score,
                "value_proposition_score": quality_assessment.value_proposition_score,
                "call_to_action_score": quality_assessment.call_to_action_score,
                "personalization_elements_found": quality_assessment.personalization_elements_found,
                "business_intelligence_usage": quality_assessment.business_intelligence_usage,
                "pain_points_addressed": quality_assessment.pain_points_addressed,
                "value_propositions_clear": quality_assessment.value_propositions_clear,
                "quality_issues": quality_assessment.quality_issues,
                "improvement_suggestions": quality_assessment.improvement_suggestions,
                "missing_elements": quality_assessment.missing_elements,
                "length_appropriate": quality_assessment.length_appropriate,
                "subject_line_effective": quality_assessment.subject_line_effective,
                "professional_standards": quality_assessment.professional_standards,
                "personalization_depth": quality_assessment.personalization_depth,
                "final_recommendation": quality_assessment.final_recommendation,
                "confidence_in_assessment": quality_assessment.confidence_in_assessment
            },
            "final_result": {
                "request_id": state["request_id"],
                "lead_id": lead.id,
                "company_name": lead.company_name,
                "email_approved": approval_status == "Approved",
                "quality_score": overall_score,
                "primary_email": primary_email,
                "follow_up_sequence": state.get("follow_up_sequence"),
                "quality_assessment": quality_assessment.dict(),
                "business_intelligence_summary": {
                    "relevance_score": business_intelligence.get("relevance_score", 0),
                    "qualification_level": business_intelligence.get("qualification_level", "Unknown"),
                    "research_tier": business_intelligence.get("research_tier", "unknown"),
                    "pain_points_count": len(pain_points),
                    "value_matches_count": len(value_matches),
                    "personalization_elements_count": len(personalization_elements)
                },
                "processing_summary": {
                    "total_processing_time": sum(state.get("processing_times", {}).values()) + execution_time,
                    "business_intelligence_time": state.get("processing_times", {}).get("business_intelligence", 0),
                    "email_generation_time": state.get("processing_times", {}).get("email_generation", 0),
                    "quality_assurance_time": execution_time
                }
            },
            "agent_results": [*state.get("agent_results", []), agent_result],
            "processing_times": {
                **state.get("processing_times", {}),
                "quality_assurance": execution_time
            },
            "confidence_scores": {
                **state.get("confidence_scores", {}),
                "quality_assurance": quality_assessment.confidence_in_assessment,
                "overall_quality": quality_assessment.overall_quality_score
            },
            "quality_gates_passed": {
                **state.get("quality_gates_passed", {}),
                "quality_assurance": approval_status == "Approved",
                "personalization_quality": quality_assessment.personalization_score >= 0.6,
                "business_context_integration": quality_assessment.business_context_score >= 0.6,
                "professional_standards": quality_assessment.professional_standards,
                "value_proposition_clarity": quality_assessment.value_proposition_score >= 0.6
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
            "request_id": state.get('request_id', 'Unknown'),
            "execution_time": execution_time,
            "has_primary_email": state.get('primary_email') is not None,
            "stack_trace": traceback.format_exc()
        }
        capture_error(
            "qa_agent_failed",
            e,
            {
                **analytics_context,
                "quality_duration_ms": execution_time * 1000,
            },
        )

        # Send structured context to Sentry
        sentry_sdk.set_context("quality_assurance_error", {
            "agent": "Quality Assurance Agent",
            "error_type": error_details['error_type'],
            "request_id": error_details['request_id'],
            "execution_time_seconds": error_details['execution_time'],
            "has_primary_email": error_details['has_primary_email'],
            "has_follow_up_sequence": state.get('follow_up_sequence') is not None,
            "has_email_metadata": state.get('email_metadata') is not None
        })

        # Capture exception in Sentry with full context
        sentry_sdk.capture_exception(e)

        logger.error(
            f"CRITICAL ERROR in Quality Assurance Agent:\n"
            f"  Error Type: {error_details['error_type']}\n"
            f"  Error Message: {error_details['error_message']}\n"
            f"  Request ID: {error_details['request_id']}\n"
            f"  Has Primary Email: {error_details['has_primary_email']}\n"
            f"  Execution Time: {error_details['execution_time']:.2f}s\n"
            f"  Full Stack Trace:\n{error_details['stack_trace']}"
        )

        # Create error result
        agent_result = AgentResult(
            agent_name="Quality Assurance Agent",
            role="Email quality validation and standards enforcement",
            output=f"Error during quality assessment: {error_details['error_type']}: {error_details['error_message']}",
            confidence_score=0.1,
            execution_time=execution_time
        )
        
        return {
            "current_stage": "error",
            "quality_assessment": {
                "error": str(e),
                "overall_quality_score": 0.1,
                "approval_status": "Error"
            },
            "final_result": {
                "request_id": state["request_id"],
                "email_approved": False,
                "quality_score": 0.1,
                "error": str(e)
            },
            "agent_results": [*state.get("agent_results", []), agent_result],
            "errors": [*state.get("errors", []), f"Quality assurance agent error: {str(e)}"]
        }
