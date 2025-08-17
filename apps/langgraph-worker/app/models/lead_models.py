"""
Pydantic models for Genni CrewAI Worker
"""
from pydantic import BaseModel, Field
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
    """Contact information model"""
    email: Optional[str] = None
    phone: Optional[str] = None
    linkedin: Optional[str] = None
    website: Optional[str] = None

class Lead(BaseModel):
    """Lead data model"""
    id: str = Field(..., description="Unique lead identifier")
    company_name: str = Field(..., description="Company name")
    contact_name: Optional[str] = Field(None, description="Primary contact name")
    title: Optional[str] = Field(None, description="Contact title/position")
    industry: Optional[str] = Field(None, description="Industry classification")
    company_size: Optional[str] = Field(None, description="Company size (employees)")
    location: Optional[str] = Field(None, description="Company location")
    description: Optional[str] = Field(None, description="Company description")
    website: Optional[str] = Field(None, description="Company website")
    contact_info: Optional[ContactInfo] = Field(None, description="Contact details")
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
    """Business profile for personalization context"""
    company_name: str = Field(..., description="Our company name")
    industry: str = Field(..., description="Our industry")
    value_proposition: str = Field(..., description="Our core value proposition")
    services: List[str] = Field(..., description="Our services/products")
    target_markets: List[str] = Field(..., description="Our target markets")
    key_differentiators: List[str] = Field(..., description="What makes us unique")
    case_studies: List[Dict[str, Any]] = Field(default_factory=list, description="Success stories")
    contact_info: Dict[str, str] = Field(..., description="Our contact information")

class EmailRequirements(BaseModel):
    """Email generation requirements"""
    tone: str = Field("professional", description="Email tone (professional, casual, friendly)")
    length: str = Field("medium", description="Email length (short, medium, long)")
    call_to_action: str = Field(..., description="Desired call to action")
    include_case_study: bool = Field(False, description="Include relevant case study")
    personalization_level: str = Field("high", description="Personalization depth")
    follow_up_sequence: bool = Field(False, description="Generate follow-up sequence")

class EmailGenerationRequest(BaseModel):
    """Request model for email generation"""
    request_id: str = Field(..., description="Unique request identifier")
    lead: Lead = Field(..., description="Lead information")
    business_profile: BusinessProfile = Field(..., description="Our business context")
    requirements: EmailRequirements = Field(..., description="Email requirements")

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