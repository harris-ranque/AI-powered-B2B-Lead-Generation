"""People discovery — website scrape, semantic role ranking, Perplexity validation, ranked candidates."""

import argparse
import asyncio
import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple

import aiohttp

from ..models.people_discovery_models import DiscoveredPerson, DiscoverPeopleResponse
from .website_people_scraper import scrape_people_from_website, WebsiteScrapeResult
from .config import get_settings

settings = get_settings()

logger = logging.getLogger(__name__)

MAX_PEOPLE_PER_LEAD = 4
WEBSITE_SOURCE = "website_inference"
LLM_SOURCE = "website_llm"
PERPLEXITY_SOURCE = "perplexity"
LLM_MODEL = "gpt-4o-mini"
PERPLEXITY_CHAT_URL = "https://api.perplexity.ai/chat/completions"
CONFIDENCE_THRESHOLD_FINDYMAIL = 0.85
PERPLEXITY_VALIDATION_CONFIDENCE = 0.85

# Perplexity structured output schemas (json_schema, not OpenAI json_object)
PERPLEXITY_PEOPLE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "people": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "title": {"type": "string"},
                    "linkedin_url": {"type": "string"},
                    "confidence": {"type": "number"},
                },
                "required": ["name", "title", "linkedin_url", "confidence"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["people"],
    "additionalProperties": False,
}

PERPLEXITY_VALIDATION_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "validations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "title": {"type": "string"},
                    "confirmed": {"type": "boolean"},
                    "linkedin_url": {"type": "string"},
                    "confidence": {"type": "number"},
                },
                "required": ["name", "title", "confirmed", "linkedin_url", "confidence"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["validations"],
    "additionalProperties": False,
}


def _build_perplexity_response_format(
    schema_name: str,
    schema: Dict[str, Any],
) -> Dict[str, Any]:
    """Build Perplexity-compatible structured output (not OpenAI json_object)."""
    return {
        "type": "json_schema",
        "json_schema": {
            "name": schema_name,
            "schema": schema,
        },
    }


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


def _compute_role_match_score(
    matched_role: Optional[str],
    requested_roles: List[str],
) -> float:
    """Higher score = better semantic match to user's role priority list."""
    if not matched_role or not requested_roles:
        return 0.0

    matched_norm = _normalize(matched_role)
    for index, role in enumerate(requested_roles):
        if _normalize(role) == matched_norm:
            return max(0.5, 0.98 - index * 0.03)

    return 0.72


def _rank_discovered_people(people: List[DiscoveredPerson]) -> List[DiscoveredPerson]:
    ranked = sorted(
        people,
        key=lambda person: (
            -person.role_match_score,
            -person.confidence,
            0 if person.matched_role else 1,
        ),
    )
    return ranked[:MAX_PEOPLE_PER_LEAD]


def _build_discovered_person(
    name: str,
    title: str,
    roles: List[str],
    source: str,
    source_url: Optional[str] = None,
    linkedin_url: Optional[str] = None,
    confidence: float = 0.75,
    sources: Optional[List[str]] = None,
) -> DiscoveredPerson:
    matched_role = _match_requested_role(title, roles)
    role_score = _compute_role_match_score(matched_role, roles)
    source_list = list(sources or [])
    if source and source not in source_list:
        source_list.append(source)

    return DiscoveredPerson(
        name=name,
        title=title,
        matched_role=matched_role,
        confidence=max(0.0, min(1.0, confidence)),
        source=source,
        source_url=source_url,
        linkedin_url=linkedin_url,
        sources=source_list,
        role_match_score=role_score if matched_role else 0.0,
    )


def _openai_key(provider_keys: Optional[Dict[str, str]] = None) -> Optional[str]:
    if provider_keys and provider_keys.get("openai"):
        return provider_keys["openai"]
    return settings.openai_api_key or os.getenv("OPENAI_API_KEY")


def _perplexity_key(provider_keys: Optional[Dict[str, str]] = None) -> Optional[str]:
    if provider_keys and provider_keys.get("perplexity"):
        return provider_keys["perplexity"]
    return settings.perplexity_api_key or os.getenv("PERPLEXITY_API_KEY")


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
        if not isinstance(page, dict):
            continue
        url = str(page.get("url") or "")
        text = str(page.get("text") or "")
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


def _safe_discovered_person_dump(person: DiscoveredPerson) -> Dict[str, Any]:
    try:
        return person.model_dump(by_alias=True)
    except Exception as error:
        logger.warning("Failed to serialize discovered person: %s", error)
        return {
            "name": getattr(person, "name", ""),
            "title": getattr(person, "title", ""),
        }


async def _perplexity_json_completion(
    api_key: str,
    system_prompt: str,
    user_content: str,
    max_tokens: int = 800,
    schema_name: Optional[str] = None,
    schema: Optional[Dict[str, Any]] = None,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    payload: Dict[str, Any] = {
        "model": "sonar",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "max_tokens": max_tokens,
        "temperature": 0.1,
    }
    if schema_name and schema:
        payload["response_format"] = _build_perplexity_response_format(
            schema_name,
            schema,
        )
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        timeout = aiohttp.ClientTimeout(total=20)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(
                PERPLEXITY_CHAT_URL,
                json=payload,
                headers=headers,
            ) as response:
                body_text = await response.text()
                if response.status != 200:
                    return {}, {
                        "error": body_text[:300],
                        "status": response.status,
                    }
                try:
                    data = json.loads(body_text)
                except json.JSONDecodeError:
                    return {}, {"error": "invalid_json", "raw": body_text[:300]}
                content = (
                    data.get("choices", [{}])[0]
                    .get("message", {})
                    .get("content", "{}")
                )
                return _extract_json_object(content), {"status": response.status}
    except Exception as error:
        return {}, {"error": str(error)}


async def _discover_leadership_with_perplexity(
    company_name: str,
    domain: str,
    location: str,
    roles: List[str],
    provider_keys: Optional[Dict[str, str]] = None,
) -> Tuple[List[DiscoveredPerson], Dict[str, Any]]:
    """Fallback when website has no people — discover founder/owner via Perplexity."""
    api_key = _perplexity_key(provider_keys)
    if not api_key:
        return [], {"skipped": "no_perplexity_key"}

    roles_text = ", ".join(roles)
    system_prompt = (
        "You identify current leadership at a specific company. "
        "Return strict JSON only with a people array. "
        "Only include people who work at the target company now."
    )
    user_content = json.dumps(
        {
            "company_name": company_name,
            "domain": domain,
            "location": location,
            "target_roles": roles,
            "instructions": (
                f"Find the current {roles_text} or equivalent decision maker(s). "
                "Return: people [{ name, title, linkedin_url?, confidence 0-1 }]."
            ),
        },
        ensure_ascii=False,
    )

    parsed, meta = await _perplexity_json_completion(
        api_key,
        system_prompt,
        user_content,
        schema_name="people_discovery",
        schema=PERPLEXITY_PEOPLE_SCHEMA,
    )
    raw_people = parsed.get("people") or []
    if not isinstance(raw_people, list):
        raw_people = []

    people: List[DiscoveredPerson] = []
    seen: set[str] = set()
    for entry in raw_people:
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
        confidence = (
            float(confidence_raw)
            if isinstance(confidence_raw, (int, float))
            else 0.78
        )
        linkedin = entry.get("linkedin_url") or entry.get("linkedinUrl")
        if not isinstance(linkedin, str):
            linkedin = None

        person = _build_discovered_person(
            name=name,
            title=title,
            roles=roles,
            source=PERPLEXITY_SOURCE,
            linkedin_url=linkedin,
            confidence=confidence,
            sources=[PERPLEXITY_SOURCE],
        )
        if person.matched_role:
            people.append(person)

    return people, {"parsed": parsed, **meta}


async def _validate_people_with_perplexity(
    people: List[DiscoveredPerson],
    company_name: str,
    domain: str,
    provider_keys: Optional[Dict[str, str]] = None,
) -> Tuple[List[DiscoveredPerson], Dict[str, Any]]:
    """Boost confidence and add LinkedIn for candidates below threshold."""
    api_key = _perplexity_key(provider_keys)
    if not api_key:
        return people, {"skipped": "no_perplexity_key"}

    low_confidence = [
        person
        for person in people
        if person.confidence < PERPLEXITY_VALIDATION_CONFIDENCE
    ]
    if not low_confidence:
        return people, {"skipped": "all_high_confidence"}

    system_prompt = (
        "Validate whether each person currently works at the company with the given title. "
        "Return strict JSON: validations [{ name, title, confirmed, linkedin_url?, confidence }]."
    )
    user_content = json.dumps(
        {
            "company_name": company_name,
            "domain": domain,
            "people": [
                {"name": p.name, "title": p.title} for p in low_confidence
            ],
        },
        ensure_ascii=False,
    )

    parsed, meta = await _perplexity_json_completion(
        api_key,
        system_prompt,
        user_content,
        max_tokens=600,
        schema_name="people_validation",
        schema=PERPLEXITY_VALIDATION_SCHEMA,
    )
    validations = parsed.get("validations") or parsed.get("people") or []
    if not isinstance(validations, list):
        validations = []

    validation_map: Dict[str, Dict[str, Any]] = {}
    for entry in validations:
        if not isinstance(entry, dict):
            continue
        name_key = _normalize(str(entry.get("name") or ""))
        if name_key:
            validation_map[name_key] = entry

    updated: List[DiscoveredPerson] = []
    for person in people:
        entry = validation_map.get(_normalize(person.name))
        if not entry:
            updated.append(person)
            continue

        confirmed = entry.get("confirmed", True)
        if entry.get("confirmed") is False:
            updated.append(person)
            continue

        new_confidence = entry.get("confidence")
        if isinstance(new_confidence, (int, float)):
            person.confidence = max(person.confidence, float(new_confidence))
        else:
            person.confidence = max(person.confidence, 0.88)

        linkedin = entry.get("linkedin_url") or entry.get("linkedinUrl")
        if isinstance(linkedin, str) and linkedin.strip():
            person.linkedin_url = linkedin.strip()

        if PERPLEXITY_SOURCE not in person.sources:
            person.sources.append(PERPLEXITY_SOURCE)

        updated.append(person)

    return updated, {"parsed": parsed, **meta}


def _empty_discovery_response(
    *,
    company_name: str,
    domain: str,
    start: float,
    error: Exception,
    partial_raw_data: Optional[Dict[str, Any]] = None,
) -> DiscoverPeopleResponse:
    elapsed = time.time() - start
    logger.exception(
        "People discovery failed for %s (%s): %s",
        company_name,
        domain,
        error,
    )
    raw_data: Dict[str, Any] = {
        "error": str(error),
        "error_type": type(error).__name__,
    }
    if partial_raw_data:
        raw_data["partial"] = partial_raw_data

    return DiscoverPeopleResponse(
        people=[],
        company_overview="",
        processing_time=elapsed,
        research_tier="error",
        additional_credits_used=0,
        raw_data=raw_data,
    )


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

        role_score = _compute_role_match_score(matched_role, roles)
        source_list = [LLM_SOURCE]
        if WEBSITE_SOURCE not in source_list:
            source_list.append(WEBSITE_SOURCE)

        people.append(
            DiscoveredPerson(
                name=name,
                title=title,
                matched_role=matched_role,
                confidence=max(0.0, min(1.0, float(confidence))),
                source=LLM_SOURCE,
                source_url=source_url,
                linkedin_url=None,
                sources=source_list,
                role_match_score=role_score if matched_role else 0.0,
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
    """Merge by normalized name; combine sources and boost confidence."""
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
            existing.role_match_score = person.role_match_score
        if not existing.linkedin_url and person.linkedin_url:
            existing.linkedin_url = person.linkedin_url
        for src in person.sources:
            if src not in existing.sources:
                existing.sources.append(src)
        if person.confidence > existing.confidence:
            existing.confidence = min(existing.confidence + 0.05, person.confidence)
        if person.source == PERPLEXITY_SOURCE and PERPLEXITY_SOURCE not in existing.sources:
            existing.sources.append(PERPLEXITY_SOURCE)

    return _rank_discovered_people(list(merged.values()))


async def discover_people_at_company(
    company_name: str,
    domain: str,
    location: str = "",
    industry: str = "",
    requested_roles: Optional[List[str]] = None,
    provider_keys: Optional[Dict[str, str]] = None,
) -> DiscoverPeopleResponse:
    """
    Pipeline: scrape → extract → semantic match → rank → Perplexity validate/fallback.
  Candidates are ranked for sequential FindyMail lookup (top candidate first).
    """
    start = time.time()
    roles = [r.strip() for r in (requested_roles or []) if r and r.strip()]
    if not roles:
        roles = ["CEO", "Founder", "Owner"]

    logger.info(
        "Starting people discovery for %s (%s) | roles=%s",
        company_name,
        domain,
        roles,
    )

    additional_credits = 0

    try:
        scrape_result = await scrape_people_from_website(domain, company_name)
    except Exception as error:
        logger.error("Website scrape failed for %s: %s", domain, error)
        scrape_result = WebsiteScrapeResult(errors=[str(error)])

    try:
        deterministic_people: List[DiscoveredPerson] = []
        for person in scrape_result.people:
            try:
                name = str(getattr(person, "name", "") or "").strip()
                title = str(getattr(person, "title", "") or "").strip()
                if not name or not title:
                    continue
                confidence_raw = getattr(person, "confidence", 0.75)
                confidence = (
                    float(confidence_raw)
                    if isinstance(confidence_raw, (int, float))
                    else 0.75
                )
                built = _build_discovered_person(
                    name=name,
                    title=title,
                    roles=roles,
                    source=WEBSITE_SOURCE,
                    source_url=getattr(person, "source_url", None),
                    confidence=confidence,
                    sources=[WEBSITE_SOURCE],
                )
                if built.matched_role:
                    deterministic_people.append(built)
            except Exception as error:
                logger.warning(
                    "Skipping scraped person for %s due to parse error: %s",
                    domain,
                    error,
                )

        llm_people, llm_raw = await _extract_and_filter_people_with_llm(
            company_name=company_name,
            domain=domain,
            roles=roles,
            scrape_result=scrape_result,
            provider_keys=provider_keys,
        )

        website_people = llm_people or deterministic_people
        perplexity_people: List[DiscoveredPerson] = []
        perplexity_meta: Dict[str, Any] = {"skipped": "website_people_found"}

        if not website_people:
            perplexity_people, perplexity_meta = await _discover_leadership_with_perplexity(
                company_name=company_name,
                domain=domain,
                location=location,
                roles=roles,
                provider_keys=provider_keys,
            )
            if perplexity_people:
                additional_credits = 1

        merged_people = _merge_discovered_people(website_people, perplexity_people)

        if merged_people:
            validated, validation_meta = await _validate_people_with_perplexity(
                merged_people,
                company_name=company_name,
                domain=domain,
                provider_keys=provider_keys,
            )
            if validation_meta.get("skipped") != "all_high_confidence":
                additional_credits += 1
            merged_people = _rank_discovered_people(validated)
        else:
            validation_meta = {"skipped": "no_people_to_validate"}

        company_overview = scrape_result.company_snippet or ""

        if merged_people:
            research_tier = "website+perplexity" if additional_credits > 0 else "website"
        elif scrape_result.errors:
            research_tier = "error"
        else:
            research_tier = "none"

        elapsed = time.time() - start
        logger.info(
            "People discovery %s (%s): scraped %d raw, %d ranked in %.1fs | urls=%s",
            company_name,
            domain,
            len(scrape_result.people),
            len(merged_people),
            elapsed,
            scrape_result.scraped_urls,
        )
        for person in merged_people:
            logger.info(
                "  → %s | %s | role_score=%.2f conf=%.2f | sources=%s",
                person.name,
                person.title,
                person.role_match_score,
                person.confidence,
                person.sources,
            )

        return DiscoverPeopleResponse(
            people=merged_people,
            company_overview=company_overview,
            processing_time=elapsed,
            research_tier=research_tier,
            additional_credits_used=additional_credits,
            raw_data={
                "website": {
                    "scraped_urls": scrape_result.scraped_urls,
                    "people_found": len(scrape_result.people),
                    "deterministic_people": [
                        _safe_discovered_person_dump(p) for p in deterministic_people
                    ],
                    "errors": scrape_result.errors,
                    "company_snippet": scrape_result.company_snippet,
                },
                "llm_extraction": llm_raw,
                "perplexity": perplexity_meta,
                "perplexity_validation": validation_meta,
                "ranking": {
                    "confidence_threshold_findymail": CONFIDENCE_THRESHOLD_FINDYMAIL,
                    "ranked_count": len(merged_people),
                },
                "merge": {
                    "website_count": len(website_people),
                    "perplexity_count": len(perplexity_people),
                    "merged_count": len(merged_people),
                },
            },
        )
    except Exception as error:
        return _empty_discovery_response(
            company_name=company_name,
            domain=domain,
            start=start,
            error=error,
            partial_raw_data={
                "scraped_urls": scrape_result.scraped_urls,
                "scrape_errors": scrape_result.errors,
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
