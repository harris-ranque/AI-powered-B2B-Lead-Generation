import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import pytest
from app.langgraph.nodes.qa_validators.models import (
    SubjectQAResult, BodyQAResult, FollowUpQAResult, ServiceMatchQAResult,
)
from app.langgraph.nodes.qa_validators.aggregator import aggregate_qa_results


def _make_subject(score=0.85):
    return SubjectQAResult(
        subject_score=score, subject_effective=True, has_hyphens=False,
        has_company_identity=True, correct_word_order=True,
        alignment_with_body=True, under_60_chars=True,
    )

def _make_body(score=0.80, word_count=110):
    return BodyQAResult(
        body_score=score, personalization_score=0.8, business_context_score=0.8,
        professional_tone_score=0.8, value_proposition_score=0.8,
        call_to_action_score=0.8, has_hyphens=False, has_sender_fabrication=False,
        word_count=word_count,
    )

def _make_fu(score=0.75):
    return FollowUpQAResult(
        follow_up_score=score, has_hyphens=False,
        company_name_present=[True, True], use_case_consistent=True,
    )

def _make_sm(score=0.90):
    return ServiceMatchQAResult(
        service_match_score=score, service_mentioned=True,
        pain_point_grounded=True, has_fabrication=False,
        assigned_service="voice agent", assigned_pain_point="FAQ calls",
    )


class TestAggregatorWithServiceMatch:
    def test_weights_sum_to_one(self):
        from app.langgraph.nodes.qa_validators.aggregator import WEIGHTS
        assert abs(sum(WEIGHTS.values()) - 1.0) < 0.001

    def test_four_way_scoring(self):
        assessment, failing = aggregate_qa_results(
            _make_subject(0.85), _make_body(0.80), _make_fu(0.75), _make_sm(0.90), "A"
        )
        # 0.20*0.85 + 0.40*0.80 + 0.25*0.75 + 0.15*0.90 = 0.8125
        assert 0.80 <= assessment.overall_quality_score <= 0.83
        assert assessment.approval_status == "Approved"

    def test_missing_service_match_rescales(self):
        """When service match QA fails (exception), weights rescale to remaining 3."""
        assessment, failing = aggregate_qa_results(
            _make_subject(0.85), _make_body(0.80), _make_fu(0.75),
            RuntimeError("LLM failed"), "A"
        )
        assert assessment.overall_quality_score > 0.70
        assert assessment.approval_status == "Approved"

    def test_low_service_match_triggers_lower_score(self):
        assessment, failing = aggregate_qa_results(
            _make_subject(0.85), _make_body(0.80), _make_fu(0.75), _make_sm(0.20), "A"
        )
        assert assessment.overall_quality_score > 0.60
