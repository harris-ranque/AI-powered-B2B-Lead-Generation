import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import pytest
from unittest.mock import AsyncMock, MagicMock
from app.langgraph.nodes.service_matcher_agent import (
    ServiceMatch,
    ServiceMatcherOutput,
    service_matcher_agent_node,
)


def _make_state(pain_points, services, value_matches=None, messaging_strategy="", industry="retail"):
    """Build a minimal EmailGenerationState dict for testing."""
    profile = MagicMock()
    profile.services = services
    profile.value_proposition = "AI solutions for business"
    lead = MagicMock()
    lead.industry = industry
    lead.company_name = "TestCo"
    return {
        "business_intelligence": {
            "pain_points": pain_points,
            "value_matches": value_matches or [],
            "messaging_strategy": messaging_strategy,
        },
        "business_profile": profile,
        "lead": lead,
        "processing_times": {},
        "provider_keys": None,
        "user_id": None,
        "llm_callback": None,
    }


class TestServiceMatcherFallback:
    @pytest.mark.anyio
    async def test_fallback_when_no_pain_points(self):
        """When BI returns empty pain points, matcher should return empty matches."""
        state = _make_state(pain_points=[], services=["voice agent"])
        result = await service_matcher_agent_node(state)
        matches = result["service_matches"]
        assert matches["ranked_matches"] == []
        assert "voice agent" in matches["unmatched_services"]

    @pytest.mark.anyio
    async def test_fallback_when_no_services(self):
        """When profile has no services, matcher should return empty matches."""
        state = _make_state(pain_points=["FAQ call volume"], services=[])
        result = await service_matcher_agent_node(state)
        matches = result["service_matches"]
        assert matches["ranked_matches"] == []
        assert "FAQ call volume" in matches["unmatched_pain_points"]


class TestServiceMatcherStateOutput:
    @pytest.mark.anyio
    async def test_output_keys(self):
        """Matcher must return service_matches and processing_times."""
        state = _make_state(pain_points=[], services=[])
        result = await service_matcher_agent_node(state)
        assert "service_matches" in result
        assert "processing_times" in result
        assert "service_matcher" in result["processing_times"]
