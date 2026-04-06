import pytest
from pydantic import ValidationError

from app.langgraph.nodes.qa_validators import (
    SubjectQAResult,
    BodyQAResult,
    FollowUpQAResult,
)


def test_subject_qa_result_valid():
    """Test creating a valid SubjectQAResult instance."""
    result = SubjectQAResult(
        subject_score=0.85,
        subject_effective=True,
        has_hyphens=False,
        has_company_identity=True,
        correct_word_order=True,
        alignment_with_body=True,
        under_60_chars=True,
        issues=["minor spacing issue"],
        suggestions=["add more context"],
    )

    assert result.subject_score == 0.85
    assert result.subject_effective is True
    assert result.has_hyphens is False
    assert result.has_company_identity is True
    assert result.correct_word_order is True
    assert result.alignment_with_body is True
    assert result.under_60_chars is True
    assert result.issues == ["minor spacing issue"]
    assert result.suggestions == ["add more context"]


def test_subject_qa_result_score_bounds():
    """Test that subject_score validates bounds (ge=0, le=1)."""
    # Valid: score at boundaries
    SubjectQAResult(
        subject_score=0.0,
        subject_effective=True,
        has_hyphens=False,
        has_company_identity=True,
        correct_word_order=True,
        alignment_with_body=True,
        under_60_chars=True,
    )

    SubjectQAResult(
        subject_score=1.0,
        subject_effective=True,
        has_hyphens=False,
        has_company_identity=True,
        correct_word_order=True,
        alignment_with_body=True,
        under_60_chars=True,
    )

    # Invalid: score > 1
    with pytest.raises(ValidationError):
        SubjectQAResult(
            subject_score=1.5,
            subject_effective=True,
            has_hyphens=False,
            has_company_identity=True,
            correct_word_order=True,
            alignment_with_body=True,
            under_60_chars=True,
        )

    # Invalid: score < 0
    with pytest.raises(ValidationError):
        SubjectQAResult(
            subject_score=-0.1,
            subject_effective=True,
            has_hyphens=False,
            has_company_identity=True,
            correct_word_order=True,
            alignment_with_body=True,
            under_60_chars=True,
        )


def test_body_qa_result_valid():
    """Test creating a valid BodyQAResult instance."""
    result = BodyQAResult(
        body_score=0.9,
        personalization_score=0.88,
        business_context_score=0.85,
        professional_tone_score=0.92,
        value_proposition_score=0.87,
        call_to_action_score=0.80,
        has_hyphens=False,
        has_sender_fabrication=False,
        word_count=150,
        issues=[],
        suggestions=["strengthen value prop"],
        personalization_elements_found=["first name", "company name"],
        business_intelligence_usage=["recent funding round"],
        pain_points_addressed=["scaling challenges"],
        value_propositions_clear=["cost reduction", "efficiency gains"],
    )

    assert result.body_score == 0.9
    assert result.word_count == 150
    assert result.has_sender_fabrication is False
    assert result.personalization_elements_found == ["first name", "company name"]
    assert result.business_intelligence_usage == ["recent funding round"]


def test_follow_up_qa_result_valid():
    """Test creating a valid FollowUpQAResult instance."""
    result = FollowUpQAResult(
        follow_up_score=0.78,
        has_hyphens=False,
        company_name_present=[True, True, False],
        use_case_consistent=True,
        issues=[],
        suggestions=["add company name to 3rd follow-up"],
    )

    assert result.follow_up_score == 0.78
    assert result.use_case_consistent is True
    assert result.company_name_present == [True, True, False]
    assert len(result.company_name_present) == 3
