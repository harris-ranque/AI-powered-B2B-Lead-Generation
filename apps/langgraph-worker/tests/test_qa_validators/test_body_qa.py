import pytest
from unittest.mock import AsyncMock
from app.langgraph.nodes.qa_validators.body_qa import run_body_qa
from app.langgraph.nodes.qa_validators.models import BodyQAResult


@pytest.fixture
def mock_llm_result():
    return BodyQAResult(
        body_score=0.75, personalization_score=0.8, business_context_score=0.7,
        professional_tone_score=0.9, value_proposition_score=0.7,
        call_to_action_score=0.8, has_hyphens=False, has_sender_fabrication=False,
        word_count=115, issues=[], suggestions=[],
        personalization_elements_found=["company name"],
        business_intelligence_usage=["pain point"],
        pain_points_addressed=["staffing"],
        value_propositions_clear=["automation"],
    )


@pytest.mark.anyio
async def test_run_body_qa_returns_result(mock_llm_result):
    mock_llm = AsyncMock()
    mock_llm.ainvoke = AsyncMock(return_value=mock_llm_result)
    result = await run_body_qa(
        llm=mock_llm, body="I noticed RevCo has been growing rapidly...",
        subject="Hi Sarah, one onboarding gap for RevCo",
        company_name="RevCo Inc", contact_name="Sarah", title="CEO",
        industry="SaaS", lead_tier="A", our_company="The Gen AI",
        our_value_prop="AI-powered lead generation",
        our_services="lead generation, email automation",
        our_differentiators="real-time enrichment",
        include_case_study=False, signature_requirement="Signatures disabled.",
        callbacks=[],
    )
    assert isinstance(result, BodyQAResult)
    assert result.body_score == 0.75
    assert result.word_count == 115
    mock_llm.ainvoke.assert_called_once()
