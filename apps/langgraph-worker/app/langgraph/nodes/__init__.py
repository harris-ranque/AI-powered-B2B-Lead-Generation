"""
LangGraph nodes for optimized workflows.
"""
from .business_intelligence_agent import business_intelligence_agent_node
from .email_generation_agent import email_generation_agent_node
from .quality_assurance_agent import quality_assurance_agent_node
from .aggregator import aggregator_node

# Legacy single-agent endpoint support
from .relevance_analyzer import relevance_analyzer_node

__all__ = [
    "business_intelligence_agent_node",
    "email_generation_agent_node",
    "quality_assurance_agent_node",
    "aggregator_node",
    "relevance_analyzer_node",
]
