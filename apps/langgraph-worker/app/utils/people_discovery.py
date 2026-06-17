"""People discovery — rendered website scrape + LLM extraction + role filtering."""

import argparse
import asyncio
import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple

from ..models.people_discovery_models import DiscoveredPerson, DiscoverPeopleResponse
from .website_people_scraper import scrape_people_from_website, WebsiteScrapeResult
from .config import get_settings

settings = get_settings()

logger = logging.getLogger(__name__)

MAX_PEOPLE_PER_LEAD = 4
WEBSITE_SOURCE = "website_inference"
LLM_SOURCE = "website_llm"
LLM_MODEL = "gpt-4o-mini"


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower().strip())


def _match_requested_role(title: str, requested_roles: List[str]) -> Optional[str]:
    title_norm = _normalize(title)
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

    return None


def _build_discovered_person(
    name: str,
    title: str,
    roles: List[str],
    source: str,
    source_url: Optional[str] = None,
    linkedin_url: Optional[str] = None,
    confidence: float = 0.75,
) -> DiscoveredPerson:
    matched_role = _match_requested_role(title, roles)
    return DiscoveredPerson(
        name=name,
        title=title,
        matched_role=matched_role,
        confidence=max(0.0, min(1.0, confidence)),
        source=source,
        source_url=source_url,
        linkedin_url=linkedin_url,
    )


def _openai_key(provider_keys: Optional[Dict[str, str]] = None) -> Optional[str]:
    if provider_keys and provider_keys.get("openai"):
        return provider_keys["openai"]
    return settings.openai_api_key or os.getenv("OPENAI_API_KEY")


def _extract_json_object(text: str) -> Dict[str, Any]:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence:
        try:
            return json.loads(fence.group(1))
        except json.JSONDecodeError:
            pass

    brace = re.search(r"(\{.*\})", text, re.DOTALL)
    if brace:
        try:
            return json.loads(brace.group(1))
        except json.JSONDecodeError:
            pass

    return {}


def _build_llm_context(scrape_result: WebsiteScrapeResult, max_chars: int = 26000) -> str:
    chunks: List[str] = []
    remaining = max_chars
    for page in scrape_result.page_texts:
        url = page.get("url", "")
        text = page.get("text", "")
        if not text:
            continue
        chunk = f"\n\nSOURCE_URL: {url}\n{text}"
        if len(chunk) > remaining:
            chunk = chunk[:remaining]
        chunks.append(chunk)
        remaining -= len(chunk)
        if remaining <= 0:
            break
    return "".join(chunks).strip()


async def _extract_and_filter_people_with_llm(
    *,
    company_name: str,
    domain: str,
    roles: List[str],
    scrape_result: WebsiteScrapeResult,
    provider_keys: Optional[Dict[str, str]] = None,
) -> Tuple[List[DiscoveredPerson], Dict[str, Any]]:
    api_key = _openai_key(provider_keys)
    context = _build_llm_context(scrape_result)
    if not api_key or not context:
        return [], {
            "skipped": "missing_openai_key_or_website_text",
            "has_openai_key": bool(api_key),
            "has_context": bool(context),
        }

    try:
        from openai import AsyncOpenAI
    except Exception as error:
        return [], {"error": f"openai_unavailable: {error}"}

    roles_text = ", ".join(roles)
    system_prompt = (
        "You extract people currently working at the target company from website text. "
        "Ignore testimonials, customers, partners, blog authors, footer links, and people from other companies. "
        "Then semantically compare each person's title to the requested roles. "
        "Examples: founder matches co-founder; owner matches managing partner/principal; "
        "CEO matches chief executive officer/president/managing director. "
        "Return strict JSON only."
    )
    user_prompt = {
        "company_name": company_name,
        "domain": domain,
        "requested_roles": roles,
        "instructions": (
            "Extract all real team/leadership/staff people from the website text. "
            "For each person, set role_match true only if the title semantically matches one requested role. "
            "Return all_people and matched_people. Use source_url from SOURCE_URL sections."
        ),
        "website_text": context,
        "json_schema": {
            "company_overview": "short summary from website if available",
            "all_people": [
                {
                    "name": "Full Name",
                    "title": "Exact title",
                    "source_url": "URL",
                    "confidence": 0.0,
                    "role_match": True,
                    "matched_role": "one of requested roles or null",
                    "match_reason": "short reason",
                }
            ],
            "matched_people": [
                {
                    "name": "Full Name",
                    "title": "Exact title",
                    "source_url": "URL",
                    "confidence": 0.0,
                    "matched_role": "one of requested roles",
                    "match_reason": "short reason",
                }
            ],
        },
    }

    try:
        client = AsyncOpenAI(api_key=api_key)
        response = await client.chat.completions.create(
            model=LLM_MODEL,
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_prompt, ensure_ascii=False)},
            ],
        )
        content = response.choices[0].message.content or "{}"
        parsed = _extract_json_object(content)
    except Exception as error:
        logger.error("Website people LLM extraction failed for %s: %s", domain, error)
        return [], {"error": str(error)}

    matched_raw = parsed.get("matched_people") or []
    if not isinstance(matched_raw, list):
        matched_raw = []

    people: List[DiscoveredPerson] = []
    seen: set[str] = set()
    for entry in matched_raw:
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("name") or "").strip()
        title = str(entry.get("title") or "").strip()
        if not name or not title:
            continue
        key = _normalize(name)
        if key in seen:
            continue
        seen.add(key)

        confidence_raw = entry.get("confidence")
        confidence = confidence_raw if isinstance(confidence_raw, (int, float)) else 0.82
        source_url = entry.get("source_url") or entry.get("sourceUrl")
        matched_role = entry.get("matched_role") or entry.get("matchedRole")
        if not isinstance(source_url, str):
            source_url = None
        if not isinstance(matched_role, str):
            matched_role = _match_requested_role(title, roles)

        people.append(
            DiscoveredPerson(
                name=name,
                title=title,
                matched_role=matched_role,
                confidence=max(0.0, min(1.0, float(confidence))),
                source=LLM_SOURCE,
                source_url=source_url,
                linkedin_url=None,
            )
        )
        if len(people) >= MAX_PEOPLE_PER_LEAD:
            break

    return people, {
        "model": LLM_MODEL,
        "parsed": parsed,
        "context_chars": len(context),
        "matched_count": len(people),
    }


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


async def discover_people_at_company(
    company_name: str,
    domain: str,
    location: str = "",
    industry: str = "",
    requested_roles: Optional[List[str]] = None,
    provider_keys: Optional[Dict[str, str]] = None,
) -> DiscoverPeopleResponse:
    """Discover role-matched people from website text only."""
    start = time.time()
    roles = [r.strip() for r in (requested_roles or []) if r and r.strip()]
    if not roles:
        roles = ["CEO", "Founder", "Owner"]

    try:
        scrape_result = await scrape_people_from_website(domain, company_name)
    except Exception as error:
        logger.error("Website scrape failed for %s: %s", domain, error)
        scrape_result = WebsiteScrapeResult(errors=[str(error)])

    deterministic_people: List[DiscoveredPerson] = [
        _build_discovered_person(
            name=person.name,
            title=person.title,
            roles=roles,
            source=WEBSITE_SOURCE,
            source_url=person.source_url,
            confidence=person.confidence,
        )
        for person in scrape_result.people
    ]

    llm_people, llm_raw = await _extract_and_filter_people_with_llm(
        company_name=company_name,
        domain=domain,
        roles=roles,
        scrape_result=scrape_result,
        provider_keys=provider_keys,
    )

    # Prefer LLM-filtered results. If LLM is unavailable, fall back to local
    # role matching so the pipeline can still run in dev/test environments.
    website_people = llm_people or [
        person for person in deterministic_people if person.matched_role
    ]

    company_overview = scrape_result.company_snippet

    merged_people = _merge_discovered_people(website_people, [])

    if website_people:
        research_tier = "website"
    elif scrape_result.errors:
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
                "deterministic_people": [p.model_dump(by_alias=True) for p in deterministic_people],
                "errors": scrape_result.errors,
                "company_snippet": scrape_result.company_snippet,
            },
            "llm_extraction": llm_raw,
            "perplexity": {"skipped": "disabled_for_people_discovery"},
            "merge": {
                "website_count": len(website_people),
                "perplexity_count": 0,
                "merged_count": len(merged_people),
            },
        },
    )


async def _cli() -> None:
    parser = argparse.ArgumentParser(description="Test website people discovery.")
    parser.add_argument("domains", nargs="+", help="Domain or website URL(s) to inspect")
    parser.add_argument("--company", default="", help="Company name")
    parser.add_argument("--roles", default="CEO,Founder,Owner", help="Comma-separated target roles")
    args = parser.parse_args()

    roles = [role.strip() for role in args.roles.split(",") if role.strip()]
    for domain in args.domains:
        result = await discover_people_at_company(
            company_name=args.company or domain,
            domain=domain,
            requested_roles=roles,
        )
        print(json.dumps(result.model_dump(by_alias=True), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(_cli())
