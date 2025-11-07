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

    logger.info(f"Starting quality assurance for {lead.company_name}")
    analytics_context = {
        "request_id": state.get("request_id"),
        "lead_id": getattr(lead, "id", None),
        "company_name": lead.company_name,
        "user_id": state.get("user_id"),
        "user_tier": state.get("user_tier", "free"),
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
        # gpt-5-nano uses max_completion_tokens instead of max_tokens
        # Use medium reasoning effort for QA - we need accurate scoring, not just speed
        openai_api_key = provider_key_map.get("openai") if using_user_keys else None
        qa_model = settings.quality_assurance_model or settings.default_model
        qa_token_budget = settings.clamp_tokens(settings.quality_assurance_max_tokens)
        llm = registry.get_openai_client(
            api_key=openai_api_key,
            model=qa_model,
            temperature=0.2,
            max_completion_tokens=qa_token_budget,
            reasoning_effort="minimal",
            require_user_key=using_user_keys,
        ).with_structured_output(QualityAssessment)
        
        # Create comprehensive quality assessment prompt
        prompt = ChatPromptTemplate.from_messages([
            ("system", """You are an expert email quality assurance specialist with extensive experience in:
            - B2B email communication standards and best practices
            - Personalization depth assessment and validation
            - Business intelligence integration evaluation
            - Professional tone and language analysis
            - Value proposition clarity and effectiveness assessment
            - Call-to-action optimization and conversion principles
            
            Keep feedback surgical and actionable (≤3 bullets per list, ≤2 sentences per bullet).
            Your role is to conduct rigorous quality assessment of generated emails to ensure:
            - High personalization standards using available business intelligence
            - Professional communication that builds credibility and trust
            - Clear value propositions that resonate with prospect needs
            - Appropriate calls-to-action for the prospect's buying stage
            - Compliance with email marketing and communication best practices
            
            Quality Standards:
            - Overall Quality: >0.8 = Excellent, 0.6-0.8 = Good, 0.4-0.6 = Needs Improvement, <0.4 = Poor
            - Personalization: Must use specific business intelligence elements
            - Length: 150-250 words for body, subject <50 characters
            - Tone: Professional but conversational, avoiding spam triggers
            - Value: Clear benefit statements, not feature-focused
            - CTA: Specific, low-pressure, appropriate for prospect stage
            
            Assessment Criteria:
            1. Personalization Score (0-1): Depth and accuracy of personalization
            2. Business Context Score (0-1): Effective use of business intelligence
            3. Professional Tone Score (0-1): Communication quality and professionalism
            4. Value Proposition Score (0-1): Clarity and relevance of value offered
            5. Call-to-Action Score (0-1): CTA effectiveness and appropriateness
            
            Approval Levels:
            - Approved: Ready for sending (overall score >0.7)
            - Needs_Improvement: Requires revisions (score 0.4-0.7)
            - Rejected: Significant issues, major revision needed (score <0.4)
            """),
            ("human", """Conduct comprehensive quality assessment of this generated email:
            
            PROSPECT CONTEXT:
            Company: {company_name}
            Contact: {contact_name} ({title})
            Industry: {industry}
            
            BUSINESS INTELLIGENCE AVAILABLE:
            Pain Points Identified: {pain_points}
            Value Matches: {value_matches}
            Personalization Elements: {personalization_elements}
            Company Overview: {company_overview}
            
            EMAIL TO ASSESS:
            
            Subject: {email_subject}
            
            Body:
            {email_body}
            
            Declared Personalization Elements: {declared_personalization}
            
            QUALITY ASSESSMENT REQUIRED:
            
            1. PERSONALIZATION ANALYSIS:
            - Identify specific personalization elements used in the email
            - Verify accuracy against available business intelligence
            - Assess depth: Deep (company-specific insights), Medium (industry/role), Surface (name only), Minimal (template)
            - Check for generic language that could apply to any company
            
            2. BUSINESS INTELLIGENCE INTEGRATION:
            - Evaluate how well business intelligence was incorporated
            - Check if pain points are meaningfully addressed
            - Assess value proposition alignment with prospect needs
            - Verify industry insights and competitive context usage
            
            3. PROFESSIONAL COMMUNICATION STANDARDS:
            - Assess tone appropriateness (professional but approachable)
            - Check grammar, spelling, and language quality
            - Evaluate credibility and trust-building elements
            - Identify any spam triggers or unprofessional language
            
            4. VALUE PROPOSITION CLARITY:
            - Assess clarity of benefits offered
            - Check relevance to prospect's situation
            - Evaluate differentiation from competitors
            - Verify quantified or specific value statements
            
            5. CALL-TO-ACTION EFFECTIVENESS:
            - Evaluate CTA clarity and specificity
            - Assess appropriateness for prospect's likely buying stage
            - Check for low-pressure, value-focused approach
            - Verify single, clear next step
            
            6. CONTENT COMPLIANCE:
            - Check email length (150-250 words ideal)
            - Verify subject line length (<50 characters)
            - Assess overall structure and flow
            - Identify any missing critical elements

            7. SIGNATURE AND FORMATTING CONSISTENCY:
            - Verify email includes professional closing ("Best,", "Cheers,", "Best regards,")
            - Confirm complete signature is present (Name, Company, Email, Phone, Website)
            - Check for placeholder text in signature (e.g., "[Your Name]", "Company Name")
            - For follow-up sequences: Verify ALL emails have identical signature format
            - Flag any missing or inconsistent signature elements
            - Ensure no emails in sequence are missing closings or signatures

            8. IMPROVEMENT RECOMMENDATIONS:
            - Identify specific areas needing improvement
            - Provide actionable suggestions for enhancement
            - Highlight missing personalization opportunities
            - Recommend value proposition strengthening
            - Flag any signature or formatting inconsistencies
            
            Provide detailed quality assessment with specific scores, identified issues, 
            and actionable improvement recommendations. Focus on measurable quality 
            improvements that will increase email effectiveness and response rates.
            """)
        ])
        
        # Execute quality assessment
        try:
            quality_assessment: QualityAssessment = await llm.ainvoke(prompt.format_messages(
                # Prospect context
                company_name=lead.company_name,
                contact_name=lead.contact_name or "Unknown",
                title=lead.title or "Professional",
                industry=getattr(lead, 'industry', '') or "Not specified",

                # Business intelligence
                pain_points="; ".join(pain_points[:5]) if pain_points else "No pain points identified",
                value_matches="; ".join(value_matches[:5]) if value_matches else "No value matches identified",
                personalization_elements="; ".join(personalization_elements[:8]) if personalization_elements else "No personalization elements available",
                company_overview=company_overview[:400] if company_overview else "No company overview available",

                # Email content
                email_subject=email_subject,
                email_body=email_body,
                declared_personalization="; ".join(email_personalization) if email_personalization else "No personalization declared"
            ))

            # Debug logging for QA assessment results
            logger.info(f"QA Assessment scores for {lead.company_name}: "
                       f"Overall={quality_assessment.overall_quality_score:.2f}, "
                       f"Personalization={quality_assessment.personalization_score:.2f}, "
                       f"Business_Context={quality_assessment.business_context_score:.2f}, "
                       f"Professional_Tone={quality_assessment.professional_tone_score:.2f}, "
                       f"Value_Prop={quality_assessment.value_proposition_score:.2f}, "
                       f"CTA={quality_assessment.call_to_action_score:.2f}, "
                       f"Status={quality_assessment.approval_status}")

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

        execution_time = time.time() - start_time
        
        # Determine final approval status based on scores
        approval_status = quality_assessment.approval_status
        overall_score = quality_assessment.overall_quality_score
        
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
            logger.error(f"Email REJECTED for {lead.company_name}: Score={overall_score:.2f}, "
                        f"Major issues found")
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
        
        # Update state with quality assessment
        return {
            "current_stage": "quality_assurance_complete",
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
