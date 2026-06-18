"""Tests for role ranking and Perplexity merge in people discovery."""

from app.models.people_discovery_models import DiscoveredPerson
from app.utils.people_discovery import (
    _compute_role_match_score,
    _rank_discovered_people,
    _merge_discovered_people,
    CONFIDENCE_THRESHOLD_FINDYMAIL,
)


def test_role_match_score_prioritizes_first_role():
    roles = ["Founder", "Operations Manager"]
    founder_score = _compute_role_match_score("Founder", roles)
    ops_score = _compute_role_match_score("Operations Manager", roles)
    assert founder_score > ops_score


def test_rank_discovered_people_orders_by_role_score():
    people = [
        DiscoveredPerson(
            name="Jane Doe",
            title="Operations Manager",
            matched_role="Operations Manager",
            confidence=0.9,
            role_match_score=0.72,
            sources=["website_llm"],
        ),
        DiscoveredPerson(
            name="John Smith",
            title="Founder",
            matched_role="Founder",
            confidence=0.88,
            role_match_score=0.98,
            sources=["website_llm"],
        ),
    ]
    ranked = _rank_discovered_people(people)
    assert ranked[0].name == "John Smith"


def test_merge_boosts_confidence_from_perplexity():
    website = [
        DiscoveredPerson(
            name="John Smith",
            title="Founder",
            matched_role="Founder",
            confidence=0.8,
            role_match_score=0.98,
            sources=["website_llm"],
        ),
    ]
    perplexity = [
        DiscoveredPerson(
            name="John Smith",
            title="Founder",
            matched_role="Founder",
            confidence=0.9,
            role_match_score=0.98,
            source="perplexity",
            sources=["perplexity"],
            linkedin_url="https://linkedin.com/in/john",
        ),
    ]
    merged = _merge_discovered_people(website, perplexity)
    assert len(merged) == 1
    assert merged[0].linkedin_url == "https://linkedin.com/in/john"
    assert "perplexity" in merged[0].sources
    assert merged[0].confidence >= 0.8


def test_confidence_threshold_constant():
    assert CONFIDENCE_THRESHOLD_FINDYMAIL == 0.85
