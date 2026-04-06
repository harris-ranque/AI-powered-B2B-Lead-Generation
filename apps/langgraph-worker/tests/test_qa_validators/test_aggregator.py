import pytest
from app.langgraph.nodes.qa_validators.models import (
    SubjectQAResult, BodyQAResult, FollowUpQAResult,
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


def test_aggregate_happy_path():
    result, failing = aggregate_qa_results(
        _make_subject(0.85), _make_body(0.75), _make_fu(0.70), "A"
    )
    # 0.25*0.85 + 0.50*0.75 + 0.25*0.70 = 0.7625
    assert result.overall_quality_score == pytest.approx(0.7625, abs=0.01)
    assert result.approval_status == "Approved"
    assert failing is None

def test_veto_hyphens_in_subject():
    result, failing = aggregate_qa_results(
        _make_subject(0.85, hyphens=True), _make_body(0.90), _make_fu(0.90), "A"
    )
    assert result.overall_quality_score <= VETO_SCORE
    assert result.approval_status != "Approved"
    assert failing == "primary"

def test_veto_hyphens_in_body():
    result, failing = aggregate_qa_results(
        _make_subject(0.90), _make_body(0.90, hyphens=True), _make_fu(0.90), "A"
    )
    assert result.overall_quality_score <= VETO_SCORE
    assert failing == "primary"

def test_veto_sender_fabrication():
    result, failing = aggregate_qa_results(
        _make_subject(0.90), _make_body(0.90, fabrication=True), _make_fu(0.90), "A"
    )
    assert result.overall_quality_score <= VETO_SCORE
    assert failing == "primary"

def test_veto_overlength_body():
    result, failing = aggregate_qa_results(
        _make_subject(0.90), _make_body(0.90, wc=155), _make_fu(0.90), "A"
    )
    assert result.overall_quality_score <= VETO_SCORE
    assert failing == "primary"
    assert "130-word" in result.quality_issues[0]

def test_veto_hyphens_in_follow_ups():
    result, failing = aggregate_qa_results(
        _make_subject(0.90), _make_body(0.90), _make_fu(0.90, hyphens=True), "A"
    )
    assert result.overall_quality_score <= VETO_SCORE
    assert failing == "follow_ups"

def test_worst_component_primary():
    result, failing = aggregate_qa_results(
        _make_subject(0.40), _make_body(0.40), _make_fu(0.80), "A"
    )
    assert failing == "primary"

def test_worst_component_follow_ups():
    # Scores chosen so weighted average < 0.60 and only follow-ups are below threshold
    # 0.25*0.70 + 0.50*0.65 + 0.25*0.30 = 0.175 + 0.325 + 0.075 = 0.575
    result, failing = aggregate_qa_results(
        _make_subject(0.70), _make_body(0.65), _make_fu(0.30), "A"
    )
    assert failing == "follow_ups"

def test_both_fail_returns_all():
    result, failing = aggregate_qa_results(
        _make_subject(0.30), _make_body(0.30), _make_fu(0.30), "A"
    )
    assert failing == "all"

def test_b_tier_threshold():
    result, failing = aggregate_qa_results(
        _make_subject(0.55), _make_body(0.50), _make_fu(0.50), "B"
    )
    # 0.25*0.55 + 0.50*0.50 + 0.25*0.50 = 0.5125 >= 0.50 B-tier threshold
    assert result.approval_status == "Approved"

def test_partial_failure_rescales():
    """When one validator returns an exception, its weight is excluded."""
    result, failing = aggregate_qa_results(
        ValueError("LLM timeout"), _make_body(0.80), _make_fu(0.70), "A"
    )
    # Subject excluded: body=50/(50+25)=0.667, fu=25/(50+25)=0.333
    # 0.667*0.80 + 0.333*0.70 = 0.767
    assert result.overall_quality_score == pytest.approx(0.767, abs=0.01)
