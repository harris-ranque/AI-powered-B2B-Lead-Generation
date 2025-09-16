"""
Pydantic models for Genni CrewAI Worker
"""
from pydantic import BaseModel, Field
from pydantic import ConfigDict
from typing import List, Dict, Any, Optional
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
    case_studies: List[Dict[str, Any]] = Field(default_factory=list, description="Success stories")
    contact_info: Dict[str, str] = Field(..., description="Our contact information")

class EmailRequirements(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    """Email generation requirements"""
    tone: str = Field("professional", description="Email tone (professional, casual, friendly)")
    length: str = Field("medium", description="Email length (short, medium, long)")
    call_to_action: str = Field("Schedule a call", alias="callToAction", description="Desired call to action")
    include_case_study: bool = Field(False, alias="includeCaseStudy", description="Include relevant case study")
    personalization_level: str = Field("high", description="Personalization depth")
    follow_up_sequence: bool = Field(True, alias="followUpSequence", description="Generate follow-up sequence")

class EmailGenerationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    """Request model for email generation"""
    request_id: str = Field(..., alias="requestId", description="Unique request identifier")
    lead: Lead = Field(..., description="Lead information")
    business_profile: BusinessProfile = Field(..., alias="businessProfile", description="Our business context")
    requirements: EmailRequirements = Field(default_factory=EmailRequirements, description="Email requirements")

class AgentResult(BaseModel):
    """Individual agent result"""
    agent_name: str = Field(..., description="Agent name")
    role: str = Field(..., description="Agent role")
    output: str = Field(..., description="Agent output")
    confidence_score: float = Field(..., description="Confidence in result (0-1)")
    execution_time: float = Field(..., description="Execution time in seconds")

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
