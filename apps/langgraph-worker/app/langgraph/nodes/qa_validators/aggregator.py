"""QA Aggregator - combines 3 validator results into one QualityAssessment."""
from typing import Optional, Tuple, Union, List
from ..quality_assurance_agent import QualityAssessment
from .models import SubjectQAResult, BodyQAResult, FollowUpQAResult
from ....utils.logger import setup_logger

logger = setup_logger(__name__)

WEIGHTS = {"subject": 0.25, "body": 0.50, "follow_ups": 0.25}
VETO_SCORE = 0.34  # Forces below any approval threshold

APPROVAL_THRESHOLDS = {"A": 0.60, "B": 0.50}

ValidatorResult = Union[SubjectQAResult, BodyQAResult, FollowUpQAResult, BaseException]


def aggregate_qa_results(
    subject_result: ValidatorResult,
    body_result: ValidatorResult,
    follow_up_result: ValidatorResult,
    lead_tier: str,
) -> Tuple[QualityAssessment, Optional[str]]:
    """Combine 3 validator results into a single QualityAssessment.

    Returns (assessment, failing_retry_group).
    failing_retry_group is None if approved, otherwise "primary"|"follow_ups"|"all".
    """
    threshold = APPROVAL_THRESHOLDS.get(lead_tier, 0.60)

    # --- Resolve results, handling partial failures ---
    subj: Optional[SubjectQAResult] = (
        subject_result if isinstance(subject_result, SubjectQAResult) else None
    )
    body: Optional[BodyQAResult] = (
        body_result if isinstance(body_result, BodyQAResult) else None
    )
    fu: Optional[FollowUpQAResult] = (
        follow_up_result if isinstance(follow_up_result, FollowUpQAResult) else None
    )

    if isinstance(subject_result, BaseException):
        logger.warning(f"Subject QA failed with {type(subject_result).__name__}: {subject_result}")
    if isinstance(body_result, BaseException):
        logger.warning(f"Body QA failed with {type(body_result).__name__}: {body_result}")
    if isinstance(follow_up_result, BaseException):
        logger.warning(f"Follow-Up QA failed with {type(follow_up_result).__name__}: {follow_up_result}")

    # --- Veto rules: hard gates that override weighted scoring ---
    veto_reason = None
    veto_group = None

    if (subj and subj.has_hyphens) or (body and body.has_hyphens):
        veto_reason = "Hyphens found in primary email"
        veto_group = "primary"
    elif body and body.has_sender_fabrication:
        veto_reason = "Sender fabrication detected"
        veto_group = "primary"
    elif fu and fu.has_hyphens:
        veto_reason = "Hyphens found in follow-ups"
        veto_group = "follow_ups"

    # --- Weighted score with rescaling for partial failures ---
    scores = {}
    if subj:
        scores["subject"] = subj.subject_score
    if body:
        scores["body"] = body.body_score
    if fu:
        scores["follow_ups"] = fu.follow_up_score

    if not scores:
        overall = 0.0
    else:
        total_weight = sum(WEIGHTS[k] for k in scores)
        overall = sum(WEIGHTS[k] * scores[k] / total_weight for k in scores)

    if veto_reason:
        overall = min(overall, VETO_SCORE)
        logger.warning(f"Veto rule triggered: {veto_reason}, score clamped to {VETO_SCORE}")

    # --- Programmatic overlength penalty (deterministic, not LLM-scored) ---
    overlength_penalty = 0.0
    if body and body.word_count > 130:
        overlength_penalty = 0.2
        overall = max(0.0, overall - overlength_penalty)
        logger.warning(f"Overlength penalty: body is {body.word_count} words (cap 130), -0.2 applied")
    elif body and body.word_count > 120:
        overlength_penalty = 0.1
        overall = max(0.0, overall - overlength_penalty)
        logger.info(f"Overlength warning: body is {body.word_count} words (target 120), -0.1 applied")

    # --- Determine approval ---
    if overall >= threshold:
        approval_status = "Approved"
    elif overall >= 0.35:
        approval_status = "Needs_Improvement"
    else:
        approval_status = "Rejected"

    # --- Determine failing retry group ---
    failing: Optional[str] = None
    if approval_status != "Approved":
        if veto_group:
            failing = veto_group
        else:
            primary_score = min(
                scores.get("subject", 1.0), scores.get("body", 1.0)
            )
            fu_score = scores.get("follow_ups", 1.0)

            primary_fails = primary_score < threshold
            fu_fails = fu_score < threshold

            if primary_fails and fu_fails:
                failing = "all"
            elif primary_fails:
                failing = "primary"
            elif fu_fails:
                failing = "follow_ups"
            else:
                failing = "primary" if primary_score <= fu_score else "follow_ups"

    # --- Collect issues/suggestions tagged by component ---
    all_issues: List[str] = []
    all_suggestions: List[str] = []
    if subj:
        all_issues.extend(f"[subject] {i}" for i in subj.issues)
        all_suggestions.extend(f"[subject] {s}" for s in subj.suggestions)
    if body:
        all_issues.extend(f"[body] {i}" for i in body.issues)
        all_suggestions.extend(f"[body] {s}" for s in body.suggestions)
    if fu:
        all_issues.extend(f"[follow-up] {i}" for i in fu.issues)
        all_suggestions.extend(f"[follow-up] {s}" for s in fu.suggestions)
    if veto_reason:
        all_issues.insert(0, f"[veto] {veto_reason}")
    if body and body.word_count > 130:
        all_issues.insert(0, f"[body] Body is {body.word_count} words — hard cap is 130, cut {body.word_count - 120} words to reach target of 120")
    elif body and body.word_count > 120:
        all_issues.append(f"[body] Body is {body.word_count} words — target is 95-120, consider cutting {body.word_count - 115} words")

    # --- Build QualityAssessment ---
    assessment = QualityAssessment(
        overall_quality_score=round(overall, 4),
        approval_status=approval_status,
        personalization_score=body.personalization_score if body else 0.7,
        business_context_score=body.business_context_score if body else 0.7,
        professional_tone_score=body.professional_tone_score if body else 0.7,
        value_proposition_score=body.value_proposition_score if body else 0.7,
        call_to_action_score=body.call_to_action_score if body else 0.7,
        personalization_elements_found=body.personalization_elements_found if body else [],
        business_intelligence_usage=body.business_intelligence_usage if body else [],
        pain_points_addressed=body.pain_points_addressed if body else [],
        value_propositions_clear=body.value_propositions_clear if body else [],
        quality_issues=all_issues,
        improvement_suggestions=all_suggestions,
        missing_elements=[],
        length_appropriate=body.word_count <= 130 if body else True,
        subject_line_effective=subj.subject_effective if subj else True,
        professional_standards=not any(
            r.has_hyphens for r in [subj, body, fu] if r is not None
        ),
        personalization_depth=(
            "Deep" if (body and body.personalization_score >= 0.8)
            else "Medium" if (body and body.personalization_score >= 0.6)
            else "Surface" if (body and body.personalization_score >= 0.4)
            else "Minimal"
        ),
        final_recommendation=(
            "Email approved" if approval_status == "Approved"
            else f"Retry {failing or 'unknown'} component"
        ),
        confidence_in_assessment=0.85,
    )
    return assessment, failing
