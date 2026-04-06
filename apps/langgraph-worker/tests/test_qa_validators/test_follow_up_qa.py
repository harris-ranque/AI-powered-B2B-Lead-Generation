import pytest
from unittest.mock import AsyncMock
from app.langgraph.nodes.qa_validators.follow_up_qa import run_follow_up_qa
from app.langgraph.nodes.qa_validators.models import FollowUpQAResult


@pytest.fixture
def mock_llm_result():
    return FollowUpQAResult(
        follow_up_score=0.70, has_hyphens=False,
        company_name_present=[True, True], use_case_consistent=True,
        issues=[], suggestions=[],
    )


@pytest.mark.anyio
async def test_run_follow_up_qa_returns_result(mock_llm_result):
    mock_llm = AsyncMock()
    mock_llm.ainvoke = AsyncMock(return_value=mock_llm_result)
    result = await run_follow_up_qa(
        llm=mock_llm,
        follow_ups=[
            {"subject": "Hi Sarah, one more thought for RevCo", "body": "Following up..."},
            {"subject": "Hi Sarah, closing the loop for RevCo", "body": "Last note..."},
        ],
        primary_subject="Hi Sarah, one onboarding gap for RevCo",
        primary_body="I noticed RevCo has been growing...",
        company_short_name="RevCo", contact_first_name="Sarah",
        lead_tier="A", callbacks=[],
    )
    assert isinstance(result, FollowUpQAResult)
    assert result.use_case_consistent is True
    assert len(result.company_name_present) == 2
    mock_llm.ainvoke.assert_called_once()


@pytest.mark.anyio
async def test_run_follow_up_qa_no_follow_ups():
    """When no follow-ups exist, return a passing default without calling LLM."""
    mock_llm = AsyncMock()
    result = await run_follow_up_qa(
        llm=mock_llm, follow_ups=[],
        primary_subject="Hi Sarah, one gap for RevCo",
        primary_body="Body text", company_short_name="RevCo",
        contact_first_name="Sarah", lead_tier="A", callbacks=[],
    )
    assert result.follow_up_score == 1.0
    mock_llm.ainvoke.assert_not_called()
