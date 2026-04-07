import pytest
from app.langgraph.nodes.qa_validators.models import (
    SubjectQAResult, BodyQAResult, FollowUpQAResult, ServiceMatchQAResult,
)
from app.langgraph.nodes.qa_validators.aggregator import (
    aggregate_qa_results, VETO_SCORE,
)


def _make_subject(score=0.85, hyphens=False, company=True, order=True, align=True):
    return SubjectQAResult(
        subject_score=score, subject_effective=score >= 0.60,
        has_hyphens=hyphens, has_company_identity=company,
        correct_word_order=order, alignment_with_body=align,
        under_60_chars=True, issues=[], suggestions=[],
    )

def _make_body(score=0.75, hyphens=False, fabrication=False, wc=115):
    return BodyQAResult(
        body_score=score, personalization_score=0.8, business_context_score=0.7,
        professional_tone_score=0.9, value_proposition_score=0.7,
        call_to_action_score=0.8, has_hyphens=hyphens,
        has_sender_fabrication=fabrication, word_count=wc,
        issues=[], suggestions=[], personalization_elements_found=[],
        business_intelligence_usage=[], pain_points_addressed=[],
        value_propositions_clear=[],
    )

def _make_fu(score=0.70, hyphens=False, consistent=True):
    return FollowUpQAResult(
        follow_up_score=score, has_hyphens=hyphens,
        company_name_present=[True, True], use_case_consistent=consistent,
        issues=[], suggestions=[],
    )

def _make_sm(score=0.80):
    return ServiceMatchQAResult(
        service_match_score=score, service_mentioned=True,
        pain_point_grounded=True, has_fabrication=False,
        assigned_service="", assigned_pain_point="",
    )


def test_aggregate_happy_path():
    result, failing = aggregate_qa_results(
        _make_subject(0.85), _make_body(0.75), _make_fu(0.70), _make_sm(), "A"
    )
    # 0.20*0.85 + 0.40*0.75 + 0.25*0.70 + 0.15*0.80 = 0.765
    assert result.overall_quality_score == pytest.approx(0.765, abs=0.01)
    assert result.approval_status == "Approved"
    assert failing is None

def test_veto_hyphens_in_subject():
    result, failing = aggregate_qa_results(
        _make_subject(0.85, hyphens=True), _make_body(0.90), _make_fu(0.90), _make_sm(), "A"
    )
    assert result.overall_quality_score <= VETO_SCORE
    assert result.approval_status != "Approved"
    assert failing == "primary"

def test_veto_hyphens_in_body():
    result, failing = aggregate_qa_results(
        _make_subject(0.90), _make_body(0.90, hyphens=True), _make_fu(0.90), _make_sm(), "A"
    )
    assert result.overall_quality_score <= VETO_SCORE
    assert failing == "primary"

def test_veto_sender_fabrication():
    result, failing = aggregate_qa_results(
        _make_subject(0.90), _make_body(0.90, fabrication=True), _make_fu(0.90), _make_sm(), "A"
    )
    assert result.overall_quality_score <= VETO_SCORE
    assert failing == "primary"

def test_overlength_body_penalty():
    """Body >130 words gets -0.2 penalty (not a veto, but enough to fail borderline emails)."""
    # Base weighted: 0.20*0.70 + 0.40*0.70 + 0.25*0.70 + 0.15*0.80 = 0.715, minus 0.2 = 0.515
    result, failing = aggregate_qa_results(
        _make_subject(0.70), _make_body(0.70, wc=155), _make_fu(0.70), _make_sm(), "A"
    )
    assert result.overall_quality_score == pytest.approx(0.515, abs=0.01)
    assert result.approval_status == "Needs_Improvement"
    assert any("155 words" in i for i in result.quality_issues)

def test_veto_hyphens_in_follow_ups():
    result, failing = aggregate_qa_results(
        _make_subject(0.90), _make_body(0.90), _make_fu(0.90, hyphens=True), _make_sm(), "A"
    )
    assert result.overall_quality_score <= VETO_SCORE
    assert failing == "follow_ups"

def test_worst_component_primary():
    result, failing = aggregate_qa_results(
        _make_subject(0.40), _make_body(0.40), _make_fu(0.80), _make_sm(), "A"
    )
    assert failing == "primary"

def test_worst_component_follow_ups():
    # Scores: subj=0.70, body=0.65, fu=0.30, sm=0.80
    # 0.20*0.70 + 0.40*0.65 + 0.25*0.30 + 0.15*0.80 = 0.14 + 0.26 + 0.075 + 0.12 = 0.595
    result, failing = aggregate_qa_results(
        _make_subject(0.70), _make_body(0.65), _make_fu(0.30), _make_sm(), "A"
    )
    assert failing == "follow_ups"

def test_both_fail_returns_all():
    result, failing = aggregate_qa_results(
        _make_subject(0.30), _make_body(0.30), _make_fu(0.30), _make_sm(), "A"
    )
    assert failing == "all"

def test_b_tier_threshold():
    result, failing = aggregate_qa_results(
        _make_subject(0.55), _make_body(0.50), _make_fu(0.50), _make_sm(), "B"
    )
    # 0.20*0.55 + 0.40*0.50 + 0.25*0.50 + 0.15*0.80 = 0.555 >= 0.50 B-tier threshold
    assert result.approval_status == "Approved"

def test_partial_failure_rescales():
    """When one validator returns an exception, its weight is excluded."""
    result, failing = aggregate_qa_results(
        ValueError("LLM timeout"), _make_body(0.80), _make_fu(0.70), _make_sm(), "A"
    )
    # Subject excluded: body=0.40, fu=0.25, sm=0.15 → total=0.80
    # 0.40/0.80*0.80 + 0.25/0.80*0.70 + 0.15/0.80*0.80 = 0.40 + 0.21875 + 0.15 = 0.76875
    assert result.overall_quality_score == pytest.approx(0.769, abs=0.01)
