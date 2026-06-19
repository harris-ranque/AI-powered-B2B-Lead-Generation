"""Request/response models for people discovery endpoint."""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field

from .lead_models import ProviderKeys


class FindyMailEmployeeInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    name: str
    title: str = Field(default="")
    linkedin_url: Optional[str] = Field(default=None, alias="linkedinUrl")


class DiscoverPeopleRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    company_name: str = Field(..., alias="companyName")
    domain: str = Field(...)
    location: Optional[str] = Field(default="")
    industry: Optional[str] = Field(default="")
    requested_roles: List[str] = Field(default_factory=list, alias="requestedRoles")
    user_id: Optional[str] = Field(default=None, alias="userId")
    user_tier: str = Field(default="free", alias="userTier")
    provider_keys: Optional[ProviderKeys] = Field(default=None, alias="providerKeys")
    findymail_employees: List[FindyMailEmployeeInput] = Field(
        default_factory=list,
        alias="findymailEmployees",
    )


class VerificationEvidence(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    source: str
    url: Optional[str] = None
    snippet: Optional[str] = None
    citation: Optional[str] = None


class DiscoveredPerson(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        extra="ignore",
        ser_json_exclude_none=True,
    )

    name: str
    title: str
    matched_role: Optional[str] = Field(default=None, alias="matchedRole")
    confidence: float = Field(default=0.7, ge=0, le=1)
    source: str = Field(default="website_inference")
    source_url: Optional[str] = Field(default=None, alias="sourceUrl")
    linkedin_url: Optional[str] = Field(default=None, alias="linkedinUrl")
    sources: List[str] = Field(default_factory=list)
    role_match_score: float = Field(default=0.0, alias="roleMatchScore", ge=0, le=1)
    employment_verified: bool = Field(default=False, alias="employmentVerified")
    employment_confidence: int = Field(
        default=0,
        alias="employmentConfidence",
        ge=0,
        le=100,
    )
    verification_evidence: List[Dict[str, Any]] = Field(
        default_factory=list,
        alias="verificationEvidence",
    )


class DiscoverPeopleResponse(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        extra="ignore",
        ser_json_exclude_none=True,
    )

    people: List[DiscoveredPerson] = Field(default_factory=list)
    rejected_people: List[DiscoveredPerson] = Field(
        default_factory=list,
        alias="rejectedPeople",
    )
    company_overview: str = Field(default="", alias="companyOverview")
    processing_time: float = Field(default=0, alias="processingTime")
    research_tier: str = Field(default="website", alias="researchTier")
    additional_credits_used: int = Field(default=0, alias="additionalCreditsUsed")
    raw_data: Optional[Dict[str, Any]] = Field(default=None, alias="rawData")
