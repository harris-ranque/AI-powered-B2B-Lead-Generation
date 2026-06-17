"""Tests for website people scraper and merge logic."""

import pytest

from app.utils.people_discovery import _merge_discovered_people, _normalize
from app.utils.website_people_scraper import (
    _looks_like_job_title,
    _looks_like_person_name,
    _parse_people_from_html,
)


def test_looks_like_person_name():
    assert _looks_like_person_name("Jane Doe")
    assert _looks_like_person_name("Robert Smith Jr")
    assert not _looks_like_person_name("CEO")
    assert not _looks_like_person_name("Click here")
    assert not _looks_like_person_name("john@company.com")


def test_looks_like_job_title():
    assert _looks_like_job_title("VP of Marketing")
    assert _looks_like_job_title("Co-Founder & CEO")
    assert not _looks_like_job_title("We build great software")


def test_parse_json_ld_team_page():
    html = """
    <html><head>
      <script type="application/ld+json">
      {
        "@type": "Person",
        "name": "Alice Johnson",
        "jobTitle": "Chief Marketing Officer"
      }
      </script>
    </head><body></body></html>
    """
    seen: set[str] = set()
    people, snippet = _parse_people_from_html(html, "https://example.com/team", seen)
    assert len(people) == 1
    assert people[0].name == "Alice Johnson"
    assert "Marketing" in people[0].title


def test_parse_heading_pair():
    html = """
    <html><body>
      <section class="team-member">
        <h3>Bob Martinez</h3>
        <p>Founder and CEO</p>
      </section>
    </body></html>
    """
    seen: set[str] = set()
    people, _ = _parse_people_from_html(html, "https://example.com/about", seen)
    assert any(p.name == "Bob Martinez" for p in people)


def test_merge_prefers_website_on_duplicate_name():
    from app.models.people_discovery_models import DiscoveredPerson

    website = [
        DiscoveredPerson(
            name="Jane Doe",
            title="VP Marketing",
            matched_role="Marketing Manager",
            confidence=0.88,
            source="website_inference",
            source_url="https://acme.com/team",
        ),
    ]
    perplexity = [
        DiscoveredPerson(
            name="Jane Doe",
            title="Director of Growth",
            matched_role=None,
            confidence=0.75,
            source="perplexity",
            linkedin_url="https://linkedin.com/in/janedoe",
        ),
    ]
    merged = _merge_discovered_people(website, perplexity)
    assert len(merged) == 1
    assert merged[0].title == "VP Marketing"
    assert merged[0].source == "website_inference"
    assert merged[0].linkedin_url == "https://linkedin.com/in/janedoe"
    assert merged[0].matched_role == "Marketing Manager"


def test_merge_dedupes_by_normalized_name():
    from app.models.people_discovery_models import DiscoveredPerson

    website = [
        DiscoveredPerson(
            name="Alice  Smith",
            title="CEO",
            confidence=0.9,
            source="website_inference",
        ),
    ]
    perplexity = [
        DiscoveredPerson(
            name="alice smith",
            title="Chief Executive Officer",
            confidence=0.8,
            source="perplexity",
        ),
    ]
    merged = _merge_discovered_people(website, perplexity)
    assert len(merged) == 1
    assert _normalize(merged[0].name) == "alice smith"
