"""
LangGraph nodes for optimized 3-agent email generation workflow
"""
from .business_intelligence_agent import business_intelligence_agent_node
from .email_generation_agent import email_generation_agent_node
from .quality_assurance_agent import quality_assurance_agent_node

# Legacy imports for backward compatibility
from .relevance_analyzer import relevance_analyzer_node
from .pain_point_researcher import pain_point_researcher_node
from .value_matcher import value_matcher_node
from .email_writer import email_writer_node
from .followup_strategist import followup_strategist_node
from .aggregator import aggregator_node

__all__ = [
    # New 3-agent architecture
    "business_intelligence_agent_node",
    "email_generation_agent_node", 
    "quality_assurance_agent_node",
    
    # Legacy agents (deprecated but maintained for compatibility)
    "relevance_analyzer_node",
    "pain_point_researcher_node",
    "value_matcher_node",
    "email_writer_node",
    "followup_strategist_node",
    "aggregator_node"
]