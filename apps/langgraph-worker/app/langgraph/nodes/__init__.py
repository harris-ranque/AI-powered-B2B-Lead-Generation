"""
LangGraph nodes for email generation workflow
"""
from .relevance_analyzer import relevance_analyzer_node
from .pain_point_researcher import pain_point_researcher_node
from .value_matcher import value_matcher_node
from .email_writer import email_writer_node
from .followup_strategist import followup_strategist_node
from .aggregator import aggregator_node

__all__ = [
    "relevance_analyzer_node",
    "pain_point_researcher_node",
    "value_matcher_node",
    "email_writer_node",
    "followup_strategist_node",
    "aggregator_node"
]