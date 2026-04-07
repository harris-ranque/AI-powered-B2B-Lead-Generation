from typing import List
from pydantic import BaseModel, Field


class SubjectQAResult(BaseModel):
    subject_score: float = Field(..., ge=0, le=1, description="Overall subject quality 0-1")
    subject_effective: bool = Field(..., description="Subject meets all critical requirements")
    has_hyphens: bool = Field(..., description="True if any hyphens found in subject (veto signal)")
    has_company_identity: bool = Field(..., description="Subject includes company short name")
    correct_word_order: bool = Field(..., description="Idea first, company at end")
    alignment_with_body: bool = Field(..., description="Subject previews same angle as body")
    under_60_chars: bool = Field(..., description="Subject is under 60 characters")
    issues: List[str] = Field(default_factory=list, description="Issues found")
    suggestions: List[str] = Field(default_factory=list, description="Improvement suggestions")


class BodyQAResult(BaseModel):
    body_score: float = Field(..., ge=0, le=1, description="Overall body quality 0-1")
    personalization_score: float = Field(..., ge=0, le=1)
    business_context_score: float = Field(..., ge=0, le=1)
    professional_tone_score: float = Field(..., ge=0, le=1)
    value_proposition_score: float = Field(..., ge=0, le=1)
    call_to_action_score: float = Field(..., ge=0, le=1)
    has_hyphens: bool = Field(..., description="True if any hyphens found in body (veto signal)")
    has_sender_fabrication: bool = Field(..., description="True if sender claims not in profile (veto signal)")
    word_count: int = Field(..., description="Exact word count of email body")
    issues: List[str] = Field(default_factory=list)
    suggestions: List[str] = Field(default_factory=list)
    personalization_elements_found: List[str] = Field(default_factory=list)
    business_intelligence_usage: List[str] = Field(default_factory=list)
    pain_points_addressed: List[str] = Field(default_factory=list)
    value_propositions_clear: List[str] = Field(default_factory=list)


class FollowUpQAResult(BaseModel):
    follow_up_score: float = Field(..., ge=0, le=1, description="Overall follow-up quality 0-1")
    has_hyphens: bool = Field(..., description="True if any hyphens in any follow-up (veto signal)")
    company_name_present: List[bool] = Field(..., description="Per follow-up: company name found")
    use_case_consistent: bool = Field(..., description="Follow-ups stay in same use-case family")
    issues: List[str] = Field(default_factory=list)
    suggestions: List[str] = Field(default_factory=list)


class ServiceMatchQAResult(BaseModel):
    service_match_score: float = Field(..., ge=0, le=1, description="Overall service match quality 0-1")
    service_mentioned: bool = Field(..., description="Email references the assigned service concept")
    pain_point_grounded: bool = Field(..., description="Email connects to the assigned pain point")
    has_fabrication: bool = Field(..., description="Email introduces claims not in BI output")
    assigned_service: str = Field(..., description="The service that was assigned by the matcher")
    assigned_pain_point: str = Field(..., description="The pain point that was assigned by the matcher")
    issues: List[str] = Field(default_factory=list)
    suggestions: List[str] = Field(default_factory=list)
