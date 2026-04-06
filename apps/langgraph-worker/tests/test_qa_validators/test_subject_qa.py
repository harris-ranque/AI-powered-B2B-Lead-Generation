import pytest
from unittest.mock import AsyncMock
from app.langgraph.nodes.qa_validators.subject_qa import run_subject_qa
from app.langgraph.nodes.qa_validators.models import SubjectQAResult


@pytest.fixture
def mock_llm_result():
    return SubjectQAResult(
        subject_score=0.85, subject_effective=True, has_hyphens=False,
        has_company_identity=True, correct_word_order=True,
        alignment_with_body=True, under_60_chars=True,
        issues=[], suggestions=[],
    )


@pytest.mark.anyio
async def test_run_subject_qa_returns_result(mock_llm_result):
    mock_llm = AsyncMock()
    mock_llm.ainvoke = AsyncMock(return_value=mock_llm_result)
    result = await run_subject_qa(
        llm=mock_llm, subject="Hi Sarah, one onboarding gap for RevCo",
        body="I noticed RevCo has been growing...",
        company_short_name="RevCo", contact_first_name="Sarah",
        lead_tier="A", callbacks=[],
    )
    assert isinstance(result, SubjectQAResult)
    assert result.subject_score == 0.85
    mock_llm.ainvoke.assert_called_once()


@pytest.mark.anyio
async def test_run_subject_qa_passes_correct_variables(mock_llm_result):
    mock_llm = AsyncMock()
    mock_llm.ainvoke = AsyncMock(return_value=mock_llm_result)
    await run_subject_qa(
        llm=mock_llm, subject="Hi Sarah, one gap for RevCo",
        body="Body text here", company_short_name="RevCo",
        contact_first_name="Sarah", lead_tier="B", callbacks=[],
    )
    call_args = mock_llm.ainvoke.call_args
    messages = call_args[0][0]
    assert len(messages) >= 2  # system + human
