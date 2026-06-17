"""Ensure people discovery never raises — always returns a structured response."""

import pytest

from app.models.people_discovery_models import DiscoveredPerson
from app.utils.people_discovery import discover_people_at_company, _merge_discovered_people
from app.utils.website_people_scraper import ScrapedPerson, WebsiteScrapeResult


@pytest.mark.asyncio
async def test_discover_people_invalid_domain_returns_response():
    result = await discover_people_at_company(
        company_name="Test Co",
        domain="",
        requested_roles=["CEO"],
    )
    assert result.research_tier in {"error", "none"}
    assert result.people == []


@pytest.mark.asyncio
async def test_discover_people_handles_scrape_errors():
    result = await discover_people_at_company(
        company_name="Test Co",
        domain="not-a-real-domain.invalid",
        requested_roles=["Founder"],
    )
    assert isinstance(result.people, list)
    assert result.raw_data is not None


def test_merge_discovered_people_skips_bad_entries():
    good = DiscoveredPerson(name="Jane Doe", title="CEO", matched_role="CEO")
    merged = _merge_discovered_people([good], [])
    assert len(merged) == 1
    assert merged[0].name == "Jane Doe"


@pytest.mark.asyncio
async def test_discover_people_handles_malformed_scraped_people(monkeypatch):
    async def fake_scrape(_domain: str, _company_name: str = "") -> WebsiteScrapeResult:
        return WebsiteScrapeResult(
            people=[
                ScrapedPerson(name="Valid Person", title="CEO", source_url="https://example.com"),
                ScrapedPerson(name="", title="CEO", source_url="https://example.com"),
            ],
            errors=["partial_fetch_error"],
        )

    monkeypatch.setattr(
        "app.utils.people_discovery.scrape_people_from_website",
        fake_scrape,
    )

    result = await discover_people_at_company(
        company_name="Test Co",
        domain="example.com",
        requested_roles=["CEO"],
    )
    assert isinstance(result.people, list)
    assert result.raw_data is not None
    assert result.raw_data["website"]["people_found"] == 2
