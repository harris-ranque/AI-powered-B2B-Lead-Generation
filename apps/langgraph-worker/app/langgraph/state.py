"""
State schema for LangGraph email generation workflow
"""
from typing import TypedDict, Dict, Any, List, Optional, Literal
from datetime import datetime
from ..models.lead_models import (
    Lead, 
    BusinessProfile, 
    EmailRequirements,
    EmailContent,
    AgentResult,
    FollowUpSequence
)

class EmailGenerationState(TypedDict):
    """
    Complete state for email generation workflow.
    Shared across all nodes in the LangGraph.
    """
    # Input data
    request_id: str
    lead: Lead
    business_profile: BusinessProfile
    requirements: EmailRequirements
    
    # Workflow control
    current_stage: Literal[
        "start",
        "relevance_analysis",
        "pain_point_research", 
        "value_matching",
        "email_writing",
        "followup_strategy",
        "aggregation",
        "complete",
        "error"
    ]
    next_agent: Optional[str]
    
    # Agent outputs
    relevance_analysis: Optional[Dict[str, Any]]
    relevance_score: Optional[float]
    pain_points: Optional[List[str]]
    value_matches: Optional[List[str]]
    primary_email: Optional[EmailContent]
    follow_up_sequence: Optional[FollowUpSequence]
    
    # Metadata and tracking
    agent_results: Optional[List[AgentResult]]
    processing_times: Optional[Dict[str, float]]
    confidence_scores: Optional[Dict[str, float]]
    errors: Optional[List[str]]
    recommendations: Optional[List[str]]
    
    # Performance tracking (stored as ISO strings for serialization)
    start_time: str  # ISO format datetime string
    end_time: Optional[str]  # ISO format datetime string
    total_processing_time: Optional[float]
    
    # Quality metrics
    quality_gates_passed: Optional[Dict[str, bool]]
    validation_messages: Optional[List[str]]
    
    # Optional fields for enhanced functionality
    intermediate_results: Optional[Dict[str, Any]]
    debug_info: Optional[Dict[str, Any]]