"""
Pydantic models for Genni CrewAI Worker
"""
from pydantic import BaseModel, Field
from pydantic import ConfigDict
from typing import Dict, List, Any, Optional, Literal
from datetime import datetime
from enum import Enum

class LeadStatus(str, Enum):
    """Lead status enumeration"""
    NEW = "new"
    QUALIFIED = "qualified"
    CONTACTED = "contacted"
    NURTURING = "nurturing"
    CONVERTED = "converted"
    UNQUALIFIED = "unqualified"

class ContactInfo(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    """Contact information model"""
    email: Optional[str] = Field(default=None, alias="email")
    phone: Optional[str] = Field(default=None, alias="phone")
    linkedin: Optional[str] = Field(default=None, alias="linkedinUrl")
    website: Optional[str] = Field(default=None, alias="website")

class Lead(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    """Lead data model"""
    id: Optional[str] = Field(default=None, description="Unique lead identifier")
    lead_id: Optional[str] = Field(None, alias="leadId", description="Parent company lead identifier")
    contact_id: Optional[str] = Field(None, alias="contactId", description="Contact record identifier")
    company_research: Optional[Dict[str, Any]] = Field(
        None, alias="companyResearch", description="Precomputed company research payload"
    )
    company_name: str = Field(..., alias="company", description="Company name")
    contact_name: Optional[str] = Field(None, alias="name", description="Primary contact name")
    title: Optional[str] = Field(None, description="Contact title/position")
    industry: Optional[str] = Field(None, description="Industry classification")
    company_size: Optional[str] = Field(None, description="Company size (employees)")
    location: Optional[str] = Field(None, description="Company location")
    description: Optional[str] = Field(None, description="Company description")
    website: Optional[str] = Field(None, alias="websiteUrl", description="Company website")
    contact_info: Optional[ContactInfo] = Field(None, alias="contactInfo", description="Contact details")
    status: LeadStatus = Field(LeadStatus.NEW, description="Lead status")
    
    # Business intelligence fields
    revenue: Optional[str] = Field(None, description="Estimated revenue")
    technologies: List[str] = Field(default_factory=list, description="Technologies used")
    pain_points: List[str] = Field(default_factory=list, description="Identified pain points")
    
    # Metadata
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    source: Optional[str] = Field(None, description="Lead source")

class BusinessProfile(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    """Business profile for personalization context"""
    company_name: str = Field(..., alias="companyName", description="Our company name")
    industry: str = Field(..., description="Our industry")
    value_proposition: str = Field(..., alias="valueProposition", description="Our core value proposition")
    services: List[str] = Field(..., description="Our services/products")
    target_markets: List[str] = Field(..., alias="targetMarkets", description="Our target markets")
    key_differentiators: List[str] = Field(..., alias="keyDifferentiators", description="What makes us unique")
    case_studies: List[Dict[str, Any]] = Field(default_factory=list, alias="caseStudies", description="Success stories")
    contact_info: Dict[str, Any] = Field(..., alias="contactInfo", description="Our contact information")


class CompetitorInsight(BaseModel):
    """Structured competitor insight used in AI-generated analyses"""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., description="Competitor company name")
    website: Optional[str] = Field(default=None, description="Competitor website")
    relevance_score: Optional[float] = Field(
        default=None,
        ge=0,
        le=1,
        description="Relative relevance score from 0-1 if provided",
    )
    summary: Optional[str] = Field(
        default=None,
        description="Short summary of the competitor's positioning",
    )
    key_strengths: List[str] = Field(
        default_factory=list,
        description="Notable strengths or differentiators for the competitor",
    )
    key_weaknesses: List[str] = Field(
        default_factory=list,
        description="Observed weaknesses or gaps for the competitor",
    )
    notes: Optional[str] = Field(
        default=None,
        description="Additional contextual notes about the competitor",
    )

class EmailRequirements(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    """Email generation requirements"""
    tone: str = Field("professional", description="Email tone (professional, casual, friendly)")
    length: str = Field("medium", description="Email length (short, medium, long)")
    call_to_action: str = Field("Schedule a call", alias="callToAction", description="Desired call to action")
    include_case_study: bool = Field(False, alias="includeCaseStudy", description="Include relevant case study")
    personalization_level: str = Field("high", description="Personalization depth")
    follow_up_sequence: bool = Field(True, alias="followUpSequence", description="Generate follow-up sequence")

class ProviderKeys(BaseModel):
    """User-supplied provider credentials"""

    openai: Optional[str] = Field(default=None, description="OpenAI API key override")
    tavily: Optional[str] = Field(default=None, description="Tavily API key override")
    perplexity: Optional[str] = Field(default=None, description="Perplexity API key override")
    google_places: Optional[str] = Field(default=None, alias="googlePlaces", description="Google Places API key override")
    findymail: Optional[str] = Field(default=None, description="FindyMail API key override")


# Keep provider list in sync with Convex backend `SUPPORTED_PROVIDERS`
ProviderLiteral = Literal[
    "openai",
    "tavily",
    "perplexity",
    "google_places",
    "google_maps",
    "findymail",
    "icypeas",
    "apify",
    "instantly",
]


class ProviderKeyValidationRequest(BaseModel):
    provider: ProviderLiteral
    key: str


class ProviderKeyValidationResponse(BaseModel):
    valid: bool
    error: Optional[str] = None
    quota_remaining: Optional[int] = Field(default=None, alias="quotaRemaining")


class EmailGenerationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    """Request model for email generation"""
    request_id: str = Field(..., alias="requestId", description="Unique request identifier")
    lead: Lead = Field(..., description="Lead information")
    business_profile: BusinessProfile = Field(..., alias="businessProfile", description="Our business context")
    requirements: EmailRequirements = Field(default_factory=EmailRequirements, description="Email requirements")
    provider_keys: Optional[ProviderKeys] = Field(default=None, alias="providerKeys", description="Optional provider credential overrides")
    user_id: Optional[str] = Field(default=None, alias="userId", description="Authenticated user identifier for key resolution")

class LeadAnalysisRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    """Request model for lead analysis endpoint"""
    lead: Lead = Field(..., description="Lead information to analyze")
    provider_keys: Optional[ProviderKeys] = Field(default=None, alias="providerKeys", description="Optional provider credential overrides")
    user_id: Optional[str] = Field(default=None, alias="userId", description="Authenticated user identifier for logging")


class CompanyResearchRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    """Run company-level research once for cache reuse across contacts"""

    company_name: str = Field(..., alias="companyName", description="Company name")
    domain: str = Field(..., description="Company website domain")
    location: Optional[str] = Field(default="", description="Company location")
    industry: Optional[str] = Field(default="", description="Industry classification")
    user_id: Optional[str] = Field(default=None, alias="userId", description="User identifier")
    user_tier: str = Field(default="free", alias="userTier", description="Subscription tier")
    provider_keys: Optional[ProviderKeys] = Field(
        default=None,
        alias="providerKeys",
        description="Optional BYOK provider credentials",
    )


class CompanyResearchResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    """Cached company research payload for downstream contact analysis"""

    research_payload: Dict[str, Any] = Field(..., alias="researchPayload")
    deep_research_used: bool = Field(default=False, alias="deepResearchUsed")
    deep_research_reason: Optional[str] = Field(default=None, alias="deepResearchReason")
    additional_credits_used: int = Field(default=0, alias="additionalCreditsUsed")
    processing_time: float = Field(default=0, alias="processingTime")

class AgentResult(BaseModel):
    """Individual agent result"""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    agent_name: str = Field(..., alias="agentName", description="Agent name")
    role: str = Field(..., description="Agent role")
    output: str = Field(..., description="Agent output")
    confidence_score: float = Field(..., alias="confidenceScore", description="Confidence in result (0-1)")
    execution_time: float = Field(..., alias="executionTime", description="Execution time in seconds")

class EmailContent(BaseModel):
    """Generated email content"""
    subject: str = Field(..., description="Email subject line")
    body: str = Field(..., description="Email body content")
    personalization_notes: List[str] = Field(..., description="Personalization elements used")
    estimated_effectiveness: float = Field(..., description="Estimated effectiveness (0-1)")

class FollowUpSequence(BaseModel):
    """Follow-up email sequence"""
    sequence_id: str = Field(..., description="Sequence identifier")
    emails: List[EmailContent] = Field(..., description="Sequence of emails")
    timing_schedule: List[int] = Field(..., description="Days between emails")
    conversion_strategy: str = Field(..., description="Overall conversion strategy")

class EmailGenerationResult(BaseModel):
    """Complete email generation result"""
    request_id: str = Field(..., description="Original request ID")
    lead_analysis: Dict[str, Any] = Field(..., description="Lead analysis results")
    relevance_score: float = Field(..., description="Lead relevance score (0-1)")
    pain_points_identified: List[str] = Field(..., description="Identified pain points")
    value_matches: List[str] = Field(..., description="Value proposition matches")
    primary_email: Optional[EmailContent] = Field(None, description="Primary email content")
    follow_up_sequence: Optional[FollowUpSequence] = Field(None, description="Follow-up sequence")
    agent_results: List[AgentResult] = Field(..., description="Individual agent outputs")
    processing_time: float = Field(..., description="Total processing time")
    recommendations: List[str] = Field(..., description="Strategic recommendations")
    
    # Deep research metadata
    deep_research_used: bool = Field(default=False, description="Whether deep research (Perplexity) was used")
    deep_research_reason: Optional[str] = Field(None, description="Reason for triggering deep research")
    additional_credits_used: int = Field(default=0, description="Additional credits used for deep research")
    missing_data_points: List[str] = Field(default_factory=list, description="Missing data points that triggered deep research")
    data_completeness_score: float = Field(default=1.0, description="Base data completeness score (0-1)")

    # Lead tier classification
    lead_tier: str = Field(default="A", description="Lead quality tier (A=rich research, B=minimal research)")
    lead_tier_reason: Optional[str] = Field(None, description="Explanation for tier classification")

class EmailGenerationResponse(BaseModel):
    """API response for email generation"""
    request_id: str = Field(..., description="Request identifier")
    status: str = Field(..., description="Processing status")
    message: str = Field(..., description="Status message")
    result: Optional[EmailGenerationResult] = Field(None, description="Generation result if completed")
    error: Optional[str] = Field(None, description="Error message if failed")
    
class WebhookPayload(BaseModel):
    """Webhook payload for status updates"""
    request_id: str = Field(..., description="Request identifier")
    status: str = Field(..., description="Processing status")
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    result: Optional[EmailGenerationResult] = Field(None, description="Result if completed")
    error: Optional[str] = Field(None, description="Error if failed")


# ============================================================================
# BATCH PROCESSING MODELS (100 leads per batch)
# ============================================================================

class BatchEmailGenerationRequest(BaseModel):
    """Request model for batch email generation (up to 100 leads)"""
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    batch_id: str = Field(..., alias="batchId", description="Unique batch identifier")
    search_id: str = Field(..., alias="searchId", description="Search ID for tracking")
    user_id: str = Field(..., alias="userId", description="User ID for authentication")
    leads: List[Lead] = Field(..., description="List of leads to process (max 200)", max_length=200)
    business_profile: BusinessProfile = Field(..., alias="businessProfile", description="Business context")
    requirements: EmailRequirements = Field(default_factory=EmailRequirements, description="Email requirements")
    provider_keys: Optional[ProviderKeys] = Field(default=None, alias="providerKeys", description="Optional provider credentials")
    max_concurrent: int = Field(default=20, alias="maxConcurrent", description="Max concurrent processing (1-100, default 20 for optimal throughput)", ge=1, le=100)


class BatchLeadResult(BaseModel):
    """Result for a single lead within a batch"""
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    lead_id: str = Field(..., alias="leadId", description="Lead identifier")
    contact_id: Optional[str] = Field(None, alias="contactId", description="Contact identifier when multi-contact")
    status: Literal["completed", "failed"] = Field(..., description="Processing status")
    result: Optional[EmailGenerationResult] = Field(None, description="Generation result if successful")
    error: Optional[str] = Field(None, description="Error message if failed")
    processing_time: float = Field(..., alias="processingTime", description="Processing time in seconds")


class BatchEmailGenerationResponse(BaseModel):
    """Response model for batch email generation"""
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    batch_id: str = Field(..., alias="batchId", description="Batch identifier")
    status: Literal["processing", "completed", "partial", "failed"] = Field(..., description="Overall batch status")
    results: List[BatchLeadResult] = Field(..., description="Individual lead results")
    summary: Dict[str, Any] = Field(..., description="Batch processing summary")
    total_processing_time: float = Field(..., alias="totalProcessingTime", description="Total batch processing time")


class BatchProgressUpdate(BaseModel):
    """Progress update for batch processing (sent every 10 leads)"""
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    batch_id: str = Field(..., alias="batchId", description="Batch identifier")
    search_id: str = Field(..., alias="searchId", description="Search identifier")
    progress_percent: float = Field(..., alias="progressPercent", description="Progress percentage (0-100)")
    completed_count: int = Field(..., alias="completedCount", description="Number of leads completed")
    total_count: int = Field(..., alias="totalCount", description="Total leads in batch")
    current_lead: Optional[str] = Field(None, alias="currentLead", description="Currently processing lead name")
    activity_phase: Optional[str] = Field(
        None,
        alias="activityPhase",
        description="researching | writing_email | completed",
    )
    success_count: int = Field(..., alias="successCount", description="Successful completions")
    failure_count: int = Field(..., alias="failureCount", description="Failed completions")
    estimated_time_remaining: Optional[float] = Field(None, alias="estimatedTimeRemaining", description="Estimated seconds remaining")
