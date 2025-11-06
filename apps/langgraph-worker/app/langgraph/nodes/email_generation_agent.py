"""
Email Generation Agent for LangGraph workflow
Consolidates email writing and follow-up strategy into unified email generation
with rich business intelligence integration.
"""
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

class FollowUpEmailPlan(BaseModel):
    """Structured follow-up email draft returned by the LLM"""

    model_config = ConfigDict(extra="forbid")

    subject: str = Field(..., description="Subject line for the follow-up email")
    body: str = Field(..., description="Full body content for the follow-up email")
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

    # Primary email
    primary_subject: str = Field(..., description="Primary email subject line")
    primary_opening: str = Field(..., description="Personalized opening that shows research")
    primary_body: str = Field(..., description="Main email body content")
    primary_cta: str = Field(..., description="Clear call to action")
    primary_closing: str = Field(..., description="Professional closing")
    primary_ps: str = Field(default="", description="Optional P.S. for additional engagement")
    
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

    # Optionally add a third follow-up aligned to strategy if needed later
    if follow_up_strategy:
        strategy_body = (
            f"Hi {contact_name},\n\n"
            f"Following the {follow_up_strategy.lower()} we discussed, I captured a few quick wins your team "
            f"could activate immediately. They focus on {pressing_pain_point_text.lower()} and leverage {primary_service_text.lower()}.\n\n"
            f"Open to a brief sync to prioritize which one makes the most sense to pilot first?"
        )
        fallback_followups.append(
            FollowUpEmailPlan(
                subject=f"Quick wins for {pressing_pain_point_text}",
                body=strategy_body,
                objective="Deliver actionable next steps",
                call_to_action=call_to_action,
            )
        )

    return fallback_followups


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

    logger.info(f"Starting email generation for {lead.company_name}")
    analytics_context = {
        "request_id": state.get("request_id"),
        "lead_id": getattr(lead, "id", None),
        "company_name": lead.company_name,
        "user_id": state.get("user_id"),
        "user_tier": state.get("user_tier", "free"),
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

        logger.info(f"Using business intelligence: {len(pain_points)} pain points, "
                   f"{len(value_matches)} value matches, relevance {relevance_score:.2f}")

        contact_info = getattr(business_profile, "contact_info", {}) or {}
        sender_name = contact_info.get("name") or contact_info.get("contactName") or ""
        sender_email = contact_info.get("email", "")
        sender_phone = contact_info.get("phone", "")
        sender_website = contact_info.get("website", "")
        sender_linkedin = contact_info.get("linkedin", "")

        def append_signature(body: str) -> str:
            """Append sender signature details if they're not already present."""

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

            return f"{body}\n\n" + "\n".join(signature_lines)
        
        # Initialize LLM for email generation
        # gpt-5-nano uses max_completion_tokens instead of max_tokens
        openai_api_key = provider_key_map.get("openai") if using_user_keys else None
        llm = registry.get_openai_client(
            api_key=openai_api_key,
            model=settings.default_model,
            temperature=0.4,
            max_completion_tokens=settings.max_tokens,
            reasoning_effort="minimal",
            require_user_key=using_user_keys,
        ).with_structured_output(EmailSequence)
        
        # Create comprehensive email generation prompt
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
- Format: MUST start with "Hi [FirstName]" then add curiosity-provoking content
- NEVER use hyphens in subject lines
- Use comma or colon after name: "Hi [FirstName], [statement]" or "Hi [FirstName]: [statement]"
- Create strong curiosity gaps that make recipients want to open
- Use specific numbers, stats, and concrete details from research
- Reference competitors, peers, or insider insights when relevant
- Keep under 60 characters total including greeting
- Never use generic phrases: "touching base", "following up", "checking in", "quick question"

Subject Line Patterns (Choose based on context):
  1. Specific Discovery: "Hi [Name], spotted 3 pipeline gaps at [Company]"
  2. What If Scenario: "Hi [Name], what if [Company] could cut churn by 30%?"
  3. Competitive Intelligence: "Hi [Name], why [Company]'s competitors switched from [Tool]"
  4. Hidden Insight: "Hi [Name]: the overlooked fix for [Company]'s [Challenge]"
  5. Contrarian/Pattern Interrupt: "Hi [Name], [Company] + this = [Outcome]"
  6. Peer Proof: "Hi [Name], what companies like [Company] are doing now"

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

OPENING (1-2 sentences):
- Quick personalized reference (recent news, growth stage, challenge)
- Must be immediately relevant to their business
- Use proper grammar with pronouns and articles
- Examples:
  GOOD: "I noticed RevCo closed a Series A last month"
  BAD: "Noticed RevCo closed Series A last month"
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

Natural, Human Language:
- Write like a real person, not a bot
- Use complete sentences with proper grammar
- Always use articles (a, an, the) where grammatically appropriate
- Include pronouns (I, we, our) naturally
- Examples:
  GOOD: "I noticed RevCo closed a Series A last month"
  BAD: "Noticed RevCo closed Series A last month"
  GOOD: "I saw Q3 numbers posted"
  BAD: "Q3 numbers posted"
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
Follow-up Expectation: Always include at least two follow-up emails with unique angles and CTAs when follow_up_sequence is true

CRITICAL DATA INTEGRITY REQUIREMENTS:

You have access to comprehensive business intelligence. USE IT EXCLUSIVELY.

1. ONLY Use Real Research Data:
   - Every personalization element must come from business intelligence provided
   - Company overview, pain points, value matches, competitors, industry insights
   - If business intelligence mentions Series A funding, use it
   - If business intelligence shows specific growth metrics, use them
   - If research doesn't contain the information, DON'T make it up
   - Never assume or fabricate prospect situations

2. Competitor References:
   - Business intelligence includes: {competitor_context}
   - When referencing competitors, use REAL names from this data
   - Never say "a similar company" or use vague references
   - Always use actual competitor names from the research
   - If no competitor data available, use industry peer approach with real company names
   - Example:
     GOOD: "Salesforce customers switched to HubSpot" (if competitors show this)
     BAD: "A similar CRM company made the switch"
   - Using real competitor names builds credibility and shows research depth

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
   - NEVER use hyphens for pauses, breaks, or emphasis
   - Use commas, periods, or rewrite sentences instead
   - Examples:
     GOOD: "I noticed RevCo closed a Series A last month"
     BAD: "Noticed RevCo closed Series A last month"
     GOOD: "I saw Q3 numbers posted"
     BAD: "Q3 numbers posted"
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

Sender & Signature:
- Use the provided sender name and contact details in the closing signature
- Ensure the signature never contains placeholder text (e.g., [Your Name])
- Keep signature clean and minimal
- Include all provided contact details

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

Opening (1-2 sentences):
- Quick personalized reference based on business intelligence
- Must use proper grammar with pronouns and articles
- Examples:
  GOOD: "I noticed RevCo closed a Series A last month"
  BAD: "Noticed RevCo closed Series A last month"
  GOOD: "I saw your blog post about manual prospecting challenges"
  BAD: "Saw your blog post"
- Must be immediately relevant
- Examples of openings:
  * "I noticed [Company] closed a Series A last month"
  * "I saw [Company] posted several SDR roles recently"
  * "I read your earnings call transcript mentioning pipeline challenges"

Body Paragraph 1 (1-2 sentences):
- State their challenge or opportunity identified in business intelligence
- Be specific, use actual research data
- Example: "That growth usually creates a lead quality challenge when scaling the sales team."

Body Paragraph 2 (1-2 sentences):
- Quick proof point with specific results
- Reference REAL competitors from business intelligence
- Include concrete numbers from research or industry data
- Example: "Mixpanel and Amplitude both solved this by automating lead generation. Amplitude saw their SDR team focus 80% of time on qualified conversations instead of list building."
- NEVER say "a similar company", always use real competitor names

Body Paragraph 3 (1 sentence):
- What you can offer them specifically
- Example: "I built a demo showing how an AI agent would work for MetricFlow's ICP."

Call to Action (1 sentence):
- Simple, direct ask
- Specific time commitment (15-30 minutes)
- Should immediately follow the offer
- Example: "Want 20 minutes to see it in action?"

Closing (1 line):
- Simple professional closing (Best, Cheers, Best regards)

Signature:
- Sender name
- Company name
- Email
- Phone
- Website/LinkedIn

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
- Most compelling proof point (pick ONE, use real competitor names)
- Strongest competitive or peer insight (if relevant, use real names)

3. FOLLOW-UP SEQUENCE (if requested):

CRITICAL: Follow-ups must be even MORE concise and punchy than primary email.
Target: 80-120 words maximum (excluding signature). Every follow-up MUST include closing + signature.

Follow-up Email Structure Template:

Opening (1 sentence):
"Hi {contact_first_name},"

Body (2-3 short sentences):
- New angle or value point (1 sentence)
- Quick proof or insight (1 sentence)
- Specific offer or next step (1 sentence)

Call-to-Action (1 sentence):
- Direct, specific ask with timeframe

Closing (1 line):
"Best," OR "Cheers," OR "Best regards,"

Signature (REQUIRED - identical to primary email):
{Sender Name}
{Company Name}
{Email}
{Phone}
{Website/LinkedIn}

Example Follow-up:
"Hi Sarah,

Quick note on the pipeline gaps we discussed. Three RevOps teams at your stage cut manual work by 40% using automated lead scoring.

Want 15 minutes to see how it works for MetricFlow?

Best,

John Smith
DataFlow Solutions
john@dataflow.com
(555) 123-4567"

Follow-up Timing and Angles:

Email 1 (3-5 days after primary):
- New angle, different curiosity hook
- 80-120 words max (EXCLUDING signature)
- Different proof point than primary (use different real competitors)
- Value-added content or resource
- Different CTA
- NO hyphens in subject or body
- MUST include closing + full signature

Email 2 (1 week after Email 1):
- Another unique curiosity-driven subject line (no hyphens)
- 80-120 words max (EXCLUDING signature)
- Social proof or peer comparison focus (real company names)
- Different value angle
- Collaborative next step CTA
- NO hyphens anywhere
- MUST include closing + full signature

Email 3 (2 weeks after Email 2, optional):
- Soft breakup or final value offer
- 80-120 words max (EXCLUDING signature)
- Summary approach
- Last chance, low-pressure CTA
- NO hyphens anywhere
- MUST include closing + full signature

MANDATORY Requirements for ALL follow-ups:

LENGTH REQUIREMENTS (CRITICAL):
- Body: 80-120 words MAXIMUM (excluding signature)
- Even shorter and punchier than primary email
- Every single word must justify its existence
- Cut ruthlessly - extreme brevity is the priority
- If longer than 120 words (excluding signature), you have FAILED

FORMAT REQUIREMENTS (CRITICAL):
- MUST include professional closing: "Best,", "Cheers,", or "Best regards,"
- MUST include COMPLETE signature (identical format to primary email)
- Signature must include: Name, Company, Email, Phone, Website/LinkedIn
- Signature format must be IDENTICAL across entire sequence

CONTENT REQUIREMENTS:
- Each must have UNIQUE subject line following "Hi {contact_first_name}, " or "Hi {contact_first_name}: " format
- NEVER use hyphens in any follow-up subject lines or bodies
- Each must use DIFFERENT curiosity pattern from primary and other follow-ups
- No repeated content or angles
- Use different real competitor names in each follow-up when possible
- Every follow-up should feel fresh and provide new value
- Keep the same tight, punchy writing style
- All information must come from business intelligence

CONSISTENCY REQUIREMENTS:
- Maintain professional tone throughout sequence
- Use consistent signature formatting
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
- Use real competitor names from research
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
Create an email that is SHORT, PUNCHY, and SCANNABLE (100-150 words max excluding signature). Every sentence must justify its existence. Use ONLY real data from the business intelligence provided. Use real competitor names, never vague references. Never use hyphens anywhere. The subject line should make {contact_first_name} think "I need to read this" while the body gets straight to the value without wasting their time. Write like you're texting a colleague who respects research and specificity, not pitching a stranger. If your email is longer than 150 words, cut it down ruthlessly until it is. Base every claim on the business intelligence data provided.
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

        # Execute email generation
        email_sequence: EmailSequence = await llm.ainvoke(prompt.format_messages(
            # Prospect information
            company_name=lead.company_name,
            contact_name=lead.contact_name or "there",
            contact_first_name=contact_first_name,
            title=lead.title or "professional",
            industry=getattr(lead, 'industry', '') or "your industry",
            company_size=getattr(lead, 'company_size', '') or "your organization",
            qualification_level=qualification_level,
            relevance_score=relevance_score,
            
            # Business intelligence
            company_overview=company_overview[:500],  # Limit length for prompt
            pain_points_list="\n".join(f"- {pp}" for pp in pain_points[:5]),
            value_matches_list="\n".join(f"- {vm}" for vm in value_matches[:5]),
            personalization_elements_list="\n".join(f"- {pe}" for pe in personalization_elements[:8]),
            engagement_hooks_list="\n".join(f"- {eh}" for eh in engagement_hooks[:5]),
            messaging_strategy=messaging_strategy,
            industry_insights=industry_insights[:300] if industry_insights else "No specific industry insights available",
            competitor_context=competitor_context or "No competitor data available",
            
            # Our company profile
            our_company=business_profile.company_name,
            our_contact_name=sender_name or business_profile.company_name,
            our_contact_email=sender_email or "not provided",
            our_contact_phone=sender_phone or "not provided",
            our_contact_website=sender_website or sender_linkedin or "not provided",
            our_value_prop=business_profile.value_proposition,
            our_services=", ".join(business_profile.services[:5]),
            our_differentiators=", ".join(business_profile.key_differentiators[:3]),
            
            # Requirements
            tone=requirements.tone,
            length=requirements.length,
            cta=requirements.call_to_action,
            include_case_study=requirements.include_case_study,
            personalization_level=requirements.personalization_level,
            follow_up_sequence=requirements.follow_up_sequence
        ))
        
        execution_time = time.time() - start_time
        
        # Create primary email content
        primary_email = EmailContent(
            subject=email_sequence.primary_subject,
            body=f"{email_sequence.primary_opening}\n\n{email_sequence.primary_body}\n\n{email_sequence.primary_cta}\n\n{email_sequence.primary_closing}",
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

                email_body_sections = [
                    f"Hi {contact_name},",
                    "",
                    follow_up.body.strip() if follow_up.body else "",
                ]

                if follow_up.objective:
                    email_body_sections.extend([
                        "",
                        f"Objective: {follow_up.objective.strip()}",
                    ])

                if follow_up.call_to_action:
                    email_body_sections.extend([
                        "",
                        follow_up.call_to_action.strip(),
                    ])
                elif primary_value:
                    email_body_sections.extend([
                        "",
                        f"Let's revisit how {primary_value} can help {company_name}.",
                    ])

                email_body = "\n".join(
                    section for section in email_body_sections if section
                )
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

                    if len(deduped_plans) >= MIN_FOLLOW_UP_EMAILS:
                        break

            while len(deduped_plans) < MIN_FOLLOW_UP_EMAILS:
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
                follow_up_emails: List[EmailContent] = []
                for i, follow_up in enumerate(deduped_plans):
                    subject = follow_up.subject or f"Follow-up {i + 1}"
                    body_parts = [follow_up.body.strip()]
                    if follow_up.call_to_action:
                        body_parts.append(follow_up.call_to_action.strip())
                    body_text = "\n\n".join(part for part in body_parts if part)

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
