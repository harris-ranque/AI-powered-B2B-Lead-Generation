"""
Email Generation Agent for LangGraph workflow
Consolidates email writing and follow-up strategy into unified email generation
with rich business intelligence integration.
"""
import time
from typing import Dict, Any, List
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field, ConfigDict
from ...utils.config import get_settings
from ...utils.logger import setup_logger
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
    
    logger.info(f"Starting email generation for {lead.company_name}")
    
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
        llm = ChatOpenAI(
            model=settings.default_model,
            temperature=0.4,  # Slightly higher for creative email writing
            max_completion_tokens=settings.max_tokens,  # Use Railway MAX_TOKENS_OPTIONAL config (10000)
            model_kwargs={"reasoning_effort": "minimal"},  # Optimize for speed with gpt-5-nano
            openai_api_key=settings.openai_api_key
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
            - Demonstrate deep research and business understanding
            - Address specific pain points with relevant solutions
            - Use industry insights and competitive intelligence
            - Feel personal and conversational, never templated
            - Include compelling proof points and credibility elements
            - Have clear, low-pressure calls to action
            
            Email best practices:
            - Subject lines: Under 50 characters, specific and intriguing
            - Opening: Reference specific research or recent company news
            - Body: 150-250 words, conversational professional tone
            - Value focus: Lead with benefits, not features
            - Personalization: Use multiple specific elements from research
            - Proof: Include relevant metrics, case studies, or social proof
            - CTA: Clear, specific, low-pressure next step
            - Follow-ups: Varied approaches, value-added content
            - Follow-ups: Provide at least two distinct follow-up emails when a sequence is requested
            
            Integration requirements:
            - Use business intelligence data extensively
            - Reference competitor landscape when relevant
            - Include industry trends and insights
            - Address specific pain points identified in research
            - Leverage personalization elements discovered
            - Follow recommended messaging strategy
            """),
            ("human", """Create a highly personalized email sequence using comprehensive business intelligence:
            
            PROSPECT INFORMATION:
            Company: {company_name}
            Contact: {contact_name} ({title})
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
            Length: {length}
            Call to Action: {cta}
            Include Case Study: {include_case_study}
            Personalization Level: {personalization_level}
            Follow-up Sequence: {follow_up_sequence}
            Follow-up Expectation: Always include at least two follow-up emails with unique angles and CTAs when follow_up_sequence is true

            EMAIL GENERATION REQUIREMENTS:

            Sender & Signature:
            - Use the provided sender name and contact details in the closing signature
            - Ensure the signature never contains placeholder text (e.g., [Your Name])
            - Reinforce credibility with our company name and a direct contact method

            1. PRIMARY EMAIL CREATION:
            - Subject line: Specific, intriguing, under 50 characters
            - Opening: Reference specific research findings or recent news
            - Body: Address their specific situation and challenges
            - Value proposition: Connect our solutions to their pain points
            - Proof points: Include relevant metrics or success stories
            - CTA: Clear, specific next step aligned with their buying stage
            - Closing: Professional but personal
            - P.S.: Optional engagement hook or additional value
            
            2. PERSONALIZATION INTEGRATION:
            - Use multiple specific elements from business intelligence
            - Reference their business model, growth stage, or recent developments
            - Show understanding of their industry challenges
            - Mention competitive landscape insights when relevant
            - Demonstrate knowledge of their technology stack or processes
            
            3. FOLLOW-UP SEQUENCE (if requested):
            - Email 2 (3-5 days): Different angle, value-added content
            - Email 3 (1 week): Social proof, case study, or industry insight
            - Email 4 (2 weeks): Soft breakup with final value offer
            - Vary subject lines, approaches, and value propositions
            - Include timing recommendations for each email
            
            4. QUALITY STANDARDS:
            - High personalization depth using business intelligence
            - Professional but conversational tone
            - Clear value proposition in every interaction
            - Specific, actionable next steps
            - Evidence of thorough research and understanding
            
            Create an email sequence that feels like it was written specifically for this prospect 
            by someone who deeply understands their business and challenges.
            """)
        ])
        
        # Format competitor context
        competitor_context = ""
        if competitors:
            top_competitors = competitors[:3]
            competitor_context = "; ".join([
                f"{comp.get('name', 'Unknown')}" for comp in top_competitors
            ])
        
        # Execute email generation
        email_sequence: EmailSequence = await llm.ainvoke(prompt.format_messages(
            # Prospect information
            company_name=lead.company_name,
            contact_name=lead.contact_name or "there",
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
        logger.error(f"Error in email generation agent: {str(e)}")
        execution_time = time.time() - start_time
        
        # Create error result
        agent_result = AgentResult(
            agent_name="Email Generation Agent",
            role="Personalized email writing and sequence strategy",
            output=f"Error during email generation: {str(e)}",
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
