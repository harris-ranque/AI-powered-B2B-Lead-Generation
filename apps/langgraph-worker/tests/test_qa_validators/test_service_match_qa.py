import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

import pytest
from app.langgraph.nodes.qa_validators.models import ServiceMatchQAResult
from app.langgraph.nodes.qa_validators.service_match_qa import _neutral_result


class TestServiceMatchQAProgrammatic:
    """Test programmatic overrides (no LLM needed)."""

    def test_no_assigned_service_returns_neutral(self):
        """When no service was assigned, QA should return a neutral pass."""
        result = _neutral_result()
        assert result.service_match_score == 0.80
        assert result.service_mentioned is True
        assert result.has_fabrication is False

    def test_result_model_validates(self):
        result = ServiceMatchQAResult(
            service_match_score=0.70,
            service_mentioned=True,
            pain_point_grounded=False,
            has_fabrication=False,
            assigned_service="voice agent",
            assigned_pain_point="FAQ call volume",
            issues=["Pain point drift: email discusses inventory, not FAQ calls"],
            suggestions=["Rewrite to focus on FAQ call volume"],
        )
        assert result.pain_point_grounded is False
        assert len(result.issues) == 1
