"""Unit tests for people discovery merge and employment verification helpers."""

import pytest

from app.models.people_discovery_models import DiscoveredPerson
from app.utils.people_discovery import (
    EMPLOYMENT_CONFIDENCE_THRESHOLD,
    FINDYMAIL_SOURCE,
    PERPLEXITY_SOURCE,
    WEBSITE_SOURCE,
    _map_findymail_employees,
    _merge_discovered_people,
    _normalize,
)


def _person(
    name: str,
    title: str,
    *,
    source: str = WEBSITE_SOURCE,
    confidence: float = 0.8,
    sources: list[str] | None = None,
    matched_role: str = "CEO",
) -> DiscoveredPerson:
    return DiscoveredPerson(
        name=name,
        title=title,
        matched_role=matched_role,
        confidence=confidence,
        source=source,
        sources=sources or [source],
        role_match_score=0.95,
    )


def test_merge_dedupes_same_person_across_sources():
    website = [_person("John Smith", "Founder", source=WEBSITE_SOURCE, confidence=0.82)]
    findymail = [
        _person(
            "John Smith",
            "Co-Founder",
            source=FINDYMAIL_SOURCE,
            confidence=0.75,
            sources=[FINDYMAIL_SOURCE],
        )
    ]
    perplexity = [
        _person(
            "John Smith",
            "Founder",
            source=PERPLEXITY_SOURCE,
            confidence=0.78,
            sources=[PERPLEXITY_SOURCE],
        )
    ]

    merged = _merge_discovered_people(website, findymail, perplexity)

    assert len(merged) == 1
    assert merged[0].name == "John Smith"
    assert WEBSITE_SOURCE in merged[0].sources
    assert FINDYMAIL_SOURCE in merged[0].sources
    assert PERPLEXITY_SOURCE in merged[0].sources
    assert merged[0].confidence >= 0.82


def test_map_findymail_employees_filters_unmatched_roles():
    employees = [
        {"name": "Jane Doe", "title": "Software Engineer"},
        {"name": "John Smith", "title": "Founder"},
    ]

    mapped = _map_findymail_employees(employees, ["Founder", "CEO"])

    assert len(mapped) == 1
    assert mapped[0].name == "John Smith"
    assert mapped[0].source == FINDYMAIL_SOURCE


def test_normalize_collapses_whitespace():
    assert _normalize("  John   Smith  ") == "john smith"


@pytest.mark.parametrize(
    "confidence,confirmed,conflicting,expected",
    [
        (96, True, False, True),
        (32, True, False, False),
        (75, False, False, False),
        (80, True, True, False),
    ],
)
def test_employment_gate_threshold(confidence, confirmed, conflicting, expected):
    passes_gate = (
        confirmed
        and not conflicting
        and confidence >= EMPLOYMENT_CONFIDENCE_THRESHOLD
    )
    assert passes_gate is expected
