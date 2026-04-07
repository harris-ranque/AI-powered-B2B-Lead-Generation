"""
State schema for LangGraph email generation workflow
Enhanced with research progress tracking and tiered research support
"""
from typing import TypedDict, Dict, Any, List, Optional, Literal
from datetime import datetime
from ..models.lead_models import (
    Lead,
    BusinessProfile,
    EmailRequirements,
    EmailContent,
    AgentResult,
    FollowUpSequence,
    ProviderKeys,
)

class EmailGenerationState(TypedDict):
    """
    Optimized state for 3-agent email generation workflow.
    Streamlined for Business Intelligence → Email Generation → Quality Assurance flow.
    """
    # Input data
    request_id: str
    lead: Lead
    business_profile: BusinessProfile
    requirements: EmailRequirements
    provider_keys: Optional[ProviderKeys]
    user_id: Optional[str]

    # Analytics callback (PostHog LLM analytics)
    llm_callback: Optional[Any]  # PostHog LangChain callback handler for LLM metrics

    # Workflow control (simplified for 3-agent flow)
    current_stage: Literal[
        "start",
        "business_intelligence_complete",
        "email_generation_complete", 
        "quality_assurance_complete",
        "complete",
        "error"
    ]
    
    # Core agent outputs
    business_intelligence: Optional[Dict[str, Any]]  # Comprehensive business intelligence from Agent 1
    primary_email: Optional[EmailContent]           # Generated email from Agent 2
    follow_up_sequence: Optional[FollowUpSequence]  # Follow-up sequence from Agent 2
    email_metadata: Optional[Dict[str, Any]]        # Email generation metadata from Agent 2
    quality_assessment: Optional[Dict[str, Any]]    # Quality assessment from Agent 3
    final_result: Optional[Dict[str, Any]]          # Final validated result from Agent 3
    
    # Legacy compatibility fields (maintained for backward compatibility)
    relevance_analysis: Optional[Dict[str, Any]]
    relevance_score: Optional[float]
    business_context: Optional[Dict[str, Any]]
    pain_points: Optional[List[str]]
    value_matches: Optional[List[str]]
    
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
    
    # Research progress tracking (for tiered research system)
    research_progress: Optional[Dict[str, Any]]  # Current research stage and progress
    research_tier: Optional[str]  # Research tier being used (tavily/perplexity)
    research_confidence: Optional[float]  # Current research confidence score
    user_tier: Optional[str]  # User subscription tier (free/pro/enterprise)
    
    # Deep research tracking
    deep_research_triggered: Optional[bool]  # Whether deep research (Perplexity) was used
    deep_research_reason: Optional[str]  # Reason for triggering deep research
    missing_data_points: Optional[List[str]]  # Missing data points that triggered deep research
    research_credit_cost: Optional[int]  # Total credit cost including deep research
    base_data_validation_score: Optional[float]  # Score for base data completeness (0-1)

    # Lead tier classification (for B-tier handling)
    lead_tier: Optional[str]  # "A" (rich research) or "B" (minimal research, still usable)
    lead_tier_reason: Optional[str]  # Explanation for tier classification
    
    # Enhanced context fields
    competitors_found: Optional[List[Dict[str, Any]]]  # Discovered competitors from research
    industry_insights: Optional[str]  # Industry analysis and trends
    escalation_reason: Optional[str]  # Reason for research tier escalation

    # Quality assurance retry tracking
    retry_count: Optional[int]  # Number of email regeneration attempts (max 3)
    max_retries: Optional[int]  # Maximum retry attempts allowed (default 3)
    previous_quality_feedback: Optional[List[Dict[str, Any]]]  # QA feedback from previous attempts

    # Targeted retry routing (parallel QA decomposition)
    failing_retry_group: Optional[str]  # "primary" | "follow_ups" | "all" | None
    failing_component_history: Optional[List[str]]  # Track cascade across retries

    # Service matcher output (pain point → service assignments)
    service_matches: Optional[Dict[str, Any]]  # ServiceMatcherOutput as dict