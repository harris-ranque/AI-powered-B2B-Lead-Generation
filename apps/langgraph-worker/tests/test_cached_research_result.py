"""Tests for cached company research → ResearchResult conversion."""

from app.langgraph.nodes.business_intelligence_agent import _research_result_from_cache
from app.utils.data_validation import BaseDataValidator
from app.utils.research_clients import ResearchTier


def test_research_result_from_cache_has_required_fields():
    cached_payload = {
        "company_overview": "Ivy Hall is a cannabis dispensary in Streamwood.",
        "confidence_score": 0.8,
        "research_tier": "tavily",
        "data_points": 3,
        "sources_analyzed": 2,
        "raw_data": {
            "annual_revenue": "$5M annual revenue",
            "employee_count": "25 employees",
            "leadership_names": ["Jane Doe, CEO"],
            "recent_news": ["Opened second location in 2025"],
            "funding_investments": "Not publicly disclosed",
            "services_products": ["Cannabis retail"],
            "industry_insights": "Growing regional dispensary market",
        },
    }

    result = _research_result_from_cache(
        cached_payload,
        "Ivy Hall is a cannabis dispensary in Streamwood.",
        "Ivy Hall Dispensary - Streamwood",
    )

    assert result.tier == ResearchTier.TAVILY
    assert result.annual_revenue == "$5M annual revenue"
    assert result.employee_count == "25 employees"
    assert result.leadership_names == ["Jane Doe, CEO"]
    assert result.recent_news == ["Opened second location in 2025"]
    assert result.funding_investments == "Not publicly disclosed"
    assert result.services_products == ["Cannabis retail"]

    validator = BaseDataValidator()
    validation = validator.validate_research_result(result)
    assert validation.validation_score > 0


def test_validate_research_result_handles_minimal_cached_result():
    result = _research_result_from_cache(
        {"research_tier": "tavily", "raw_data": {}},
        "Minimal overview for testing.",
        "Test Company",
    )

    validator = BaseDataValidator()
    validation = validator.validate_research_result(result)
    relevance_score, _ = validator.validate_research_relevance(
        result,
        company_name="Test Company",
    )

    assert validation.validation_score >= 0
    assert relevance_score >= 0
