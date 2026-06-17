"""People discovery — website scrape + Perplexity, merged before email lookup."""

import asyncio
import json
import logging
import re
import time
from typing import Any, Dict, List, Optional, Tuple

import aiohttp

from ..models.people_discovery_models import DiscoveredPerson, DiscoverPeopleResponse
from .website_people_scraper import scrape_people_from_website, WebsiteScrapeResult

logger = logging.getLogger(__name__)

MAX_PEOPLE_PER_LEAD = 8
PERPLEXITY_TIMEOUT_SECONDS = 90
WEBSITE_SOURCE = "website_inference"
PERPLEXITY_SOURCE = "perplexity"


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower().strip())


def _match_requested_role(
    title: str,
    requested_roles: List[str],
    expanded_patterns: Optional[List[str]] = None,
) -> Optional[str]:
    title_norm = _normalize(title)
    candidates = list(requested_roles)
    if expanded_patterns:
        candidates.extend(expanded_patterns)

    best_role: Optional[str] = None
    best_score = 0.0
    for role in requested_roles:
        role_norm = _normalize(role)
        if not role_norm:
            continue
        if title_norm == role_norm or role_norm in title_norm or title_norm in role_norm:
            return role
        role_words = [w for w in role_norm.split() if len(w) > 2]
        title_words = title_norm.split()
        if role_words:
            overlap = sum(1 for w in role_words if w in title_words) / len(role_words)
            if overlap > best_score:
                best_score = overlap
                best_role = role

    if best_score >= 0.5:
        return best_role

    for pattern in expanded_patterns or []:
        pattern_norm = _normalize(pattern)
        if not pattern_norm:
            continue
        if pattern_norm in title_norm or title_norm in pattern_norm:
            for role in requested_roles:
                role_norm = _normalize(role)
                if role_norm in pattern_norm or pattern_norm in role_norm:
                    return role
            return requested_roles[0] if requested_roles else None

    return None


def _extract_json_object(text: str) -> Optional[Dict[str, Any]]:
    text = text.strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    fence_match = re.search(r"```(?:json)?\s*([\{].*?[\}])\s*```", text, re.DOTALL)
    if fence_match:
        try:
            return json.loads(fence_match.group(1))
        except json.JSONDecodeError:
            pass

    brace_match = re.search(r"(\{.*\})", text, re.DOTALL)
    if brace_match:
        try:
            return json.loads(brace_match.group(1))
        except json.JSONDecodeError:
            return None
    return None


def _build_people_discovery_prompt(
    company_name: str,
    domain: str,
    location: str,
    industry: str,
    requested_roles: List[str],
) -> str:
    roles_text = ", ".join(requested_roles) if requested_roles else "CEO, Founder, Owner"
    location_text = f"Location: {location}." if location else ""
    industry_text = f"Industry: {industry}." if industry else ""

    return (
        f"Identify real decision makers at {company_name} (website: {domain}). "
        f"{location_text} {industry_text}\n"
        f"Target roles for outreach: {roles_text}.\n\n"
        "Search leadership pages, press releases, LinkedIn company pages, and news. "
        "Return ONLY valid JSON with this exact structure (no markdown):\n"
        "{\n"
        '  "company_overview": "2-3 sentence company summary",\n'
        '  "people": [\n'
        "    {\n"
        '      "name": "Full Name",\n'
        '      "title": "Exact job title at this company",\n'
        '      "confidence": 0.85,\n'
        '      "source": "perplexity",\n'
        '      "source_url": "https://...",\n'
        '      "linkedin_url": null\n'
        "    }\n"
        "  ]\n"
        "}\n"
        f"Include up to {MAX_PEOPLE_PER_LEAD} people. "
        "Only include people currently at this company with verifiable titles. "
        "Prioritize matches to the target roles."
    )


def _build_discovered_person(
    name: str,
    title: str,
    roles: List[str],
    expanded_role_patterns: Optional[List[str]],
    source: str,
    source_url: Optional[str] = None,
    linkedin_url: Optional[str] = None,
    confidence: float = 0.75,
) -> DiscoveredPerson:
    matched_role = _match_requested_role(title, roles, expanded_role_patterns)
    return DiscoveredPerson(
        name=name,
        title=title,
        matched_role=matched_role,
        confidence=max(0.0, min(1.0, confidence)),
        source=source,
        source_url=source_url,
        linkedin_url=linkedin_url,
    )


def _merge_discovered_people(
    website_people: List[DiscoveredPerson],
    perplexity_people: List[DiscoveredPerson],
) -> List[DiscoveredPerson]:
    """Merge by normalized name; website data wins on conflicts."""
    merged: Dict[str, DiscoveredPerson] = {}

    for person in website_people:
        key = _normalize(person.name)
        if key:
            merged[key] = person

    for person in perplexity_people:
        key = _normalize(person.name)
        if not key:
            continue
        existing = merged.get(key)
        if existing is None:
            merged[key] = person
            continue

        if not existing.matched_role and person.matched_role:
            existing.matched_role = person.matched_role
        if not existing.linkedin_url and person.linkedin_url:
            existing.linkedin_url = person.linkedin_url
        if existing.source == WEBSITE_SOURCE and person.confidence > existing.confidence:
            existing.confidence = min(existing.confidence + 0.05, 0.98)

    ranked = list(merged.values())
    ranked.sort(
        key=lambda p: (
            0 if p.matched_role else 1,
            0 if p.source == WEBSITE_SOURCE else 1,
            -p.confidence,
        ),
    )
    return ranked[:MAX_PEOPLE_PER_LEAD]


async def _discover_people_perplexity(
    company_name: str,
    domain: str,
    location: str,
    industry: str,
    roles: List[str],
    expanded_role_patterns: Optional[List[str]],
    api_key: str,
) -> Tuple[List[DiscoveredPerson], str, Dict[str, Any]]:
    prompt = _build_people_discovery_prompt(
        company_name, domain, location, industry, roles
    )

    payload = {
        "model": "sonar-pro",
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a B2B people research analyst. "
                    "Return factual, verifiable people data as strict JSON only."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "max_tokens": 3000,
        "temperature": 0.2,
        "stream": False,
        "return_citations": True,
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    raw_content = ""
    citations: List[str] = []
    raw_data: Dict[str, Any] = {}

    try:
        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=PERPLEXITY_TIMEOUT_SECONDS)
        ) as session:
            async with session.post(
                "https://api.perplexity.ai/chat/completions",
                json=payload,
                headers=headers,
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    logger.error(
                        "People discovery Perplexity error %s: %s",
                        response.status,
                        error_text[:500],
                    )
                    return [], "", {"error": error_text[:500], "status": response.status}
                data = await response.json()

        choices = data.get("choices", [])
        if choices:
            raw_content = choices[0].get("message", {}).get("content", "") or ""
        citations = data.get("citations", []) or []
    except Exception as error:
        logger.error("People discovery Perplexity request failed: %s", error)
        return [], "", {"error": str(error)}

    parsed = _extract_json_object(raw_content) or {}
    company_overview = str(parsed.get("company_overview") or "").strip()
    raw_people = parsed.get("people") or []

    people: List[DiscoveredPerson] = []
    seen_names: set[str] = set()

    for entry in raw_people:
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("name") or "").strip()
        title = str(entry.get("title") or "").strip()
        if not name or not title:
            continue
        name_key = _normalize(name)
        if name_key in seen_names:
            continue
        seen_names.add(name_key)

        confidence_raw = entry.get("confidence")
        confidence = (
            float(confidence_raw)
            if isinstance(confidence_raw, (int, float))
            else 0.75
        )

        source_url = entry.get("source_url") or entry.get("sourceUrl")
        if isinstance(source_url, str) and source_url.strip():
            source_url = source_url.strip()
        else:
            source_url = citations[0] if citations else None

        linkedin_url = entry.get("linkedin_url") or entry.get("linkedinUrl")
        if isinstance(linkedin_url, str) and linkedin_url.strip():
            linkedin_url = linkedin_url.strip()
        else:
            linkedin_url = None

        people.append(
            _build_discovered_person(
                name=name,
                title=title,
                roles=roles,
                expanded_role_patterns=expanded_role_patterns,
                source=str(entry.get("source") or PERPLEXITY_SOURCE),
                source_url=source_url,
                linkedin_url=linkedin_url,
                confidence=confidence,
            )
        )

        if len(people) >= MAX_PEOPLE_PER_LEAD:
            break

    raw_data = {
        "raw_content": raw_content,
        "citations": citations,
        "parsed": parsed,
    }
    return people, company_overview, raw_data


async def discover_people_at_company(
    company_name: str,
    domain: str,
    location: str = "",
    industry: str = "",
    requested_roles: Optional[List[str]] = None,
    expanded_role_patterns: Optional[List[str]] = None,
    provider_keys: Optional[Dict[str, str]] = None,
) -> DiscoverPeopleResponse:
    """Website scrape + Perplexity in parallel, merged and deduplicated."""
    start = time.time()
    roles = [r.strip() for r in (requested_roles or []) if r and r.strip()]
    if not roles:
        roles = ["CEO", "Founder", "Owner"]

    api_key: Optional[str] = None
    if provider_keys and provider_keys.get("perplexity"):
        api_key = provider_keys["perplexity"]
    if not api_key:
        import os

        api_key = os.getenv("PERPLEXITY_API_KEY")

    scrape_coro = scrape_people_from_website(domain, company_name)

    scrape_result: Any
    perplexity_people: List[DiscoveredPerson] = []
    company_overview = ""
    perplexity_raw: Dict[str, Any] = {}

    if api_key:
        scrape_result, perplexity_result = await asyncio.gather(
            scrape_coro,
            _discover_people_perplexity(
                company_name,
                domain,
                location,
                industry,
                roles,
                expanded_role_patterns,
                api_key,
            ),
            return_exceptions=True,
        )

        if isinstance(scrape_result, Exception):
            logger.error("Website scrape failed for %s: %s", domain, scrape_result)
            scrape_result = WebsiteScrapeResult(errors=[str(scrape_result)])

        if isinstance(perplexity_result, Exception):
            logger.error("Perplexity people discovery failed for %s: %s", domain, perplexity_result)
            perplexity_raw = {"error": str(perplexity_result)}
        else:
            perplexity_people, perplexity_overview, perplexity_raw = perplexity_result
            company_overview = perplexity_overview
    else:
        logger.warning(
            "Perplexity API key not configured; using website scrape only for %s",
            domain,
        )
        scrape_result = await scrape_coro
        perplexity_raw = {"skipped": "no_perplexity_key"}

    website_people: List[DiscoveredPerson] = [
        _build_discovered_person(
            name=person.name,
            title=person.title,
            roles=roles,
            expanded_role_patterns=expanded_role_patterns,
            source=WEBSITE_SOURCE,
            source_url=person.source_url,
            confidence=person.confidence,
        )
        for person in scrape_result.people
    ]

    if company_overview and scrape_result.company_snippet:
        company_overview = f"{scrape_result.company_snippet}\n\n{company_overview}".strip()
    elif scrape_result.company_snippet and not company_overview:
        company_overview = scrape_result.company_snippet

    merged_people = _merge_discovered_people(website_people, perplexity_people)

    if website_people and perplexity_people:
        research_tier = "website+pro"
    elif website_people:
        research_tier = "website"
    elif perplexity_people:
        research_tier = "pro"
    elif perplexity_raw.get("error"):
        research_tier = "error"
    else:
        research_tier = "none"

    return DiscoverPeopleResponse(
        people=merged_people,
        company_overview=company_overview,
        processing_time=time.time() - start,
        research_tier=research_tier,
        additional_credits_used=0,
        raw_data={
            "website": {
                "scraped_urls": scrape_result.scraped_urls,
                "people_found": len(scrape_result.people),
                "errors": scrape_result.errors,
                "company_snippet": scrape_result.company_snippet,
            },
            "perplexity": perplexity_raw,
            "merge": {
                "website_count": len(website_people),
                "perplexity_count": len(perplexity_people),
                "merged_count": len(merged_people),
            },
        },
    )
