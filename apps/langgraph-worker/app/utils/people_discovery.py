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

WEBSITE_SOURCE = "website_inference"
LLM_SOURCE = "website_llm"
PERPLEXITY_SOURCE = "perplexity"
FINDYMAIL_SOURCE = "findymail_employees"
TAVILY_SOURCE = "tavily"
LLM_MODEL = "gpt-4o-mini"
PERPLEXITY_CHAT_URL = "https://api.perplexity.ai/chat/completions"
CONFIDENCE_THRESHOLD_FINDYMAIL = 0.85
PERPLEXITY_VALIDATION_CONFIDENCE = 0.85
EMPLOYMENT_CONFIDENCE_THRESHOLD = 70
WEBSITE_EMPLOYMENT_CONFIDENCE_FLOOR = 85

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

EMPLOYMENT_VERIFICATION_SCHEMA: Dict[str, Any] = {
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
                    "employment_confidence": {"type": "number"},
                    "conflicting_evidence": {"type": "boolean"},
                    "linkedin_url": {"type": "string"},
                    "evidence": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "source": {"type": "string"},
                                "url": {"type": "string"},
                                "snippet": {"type": "string"},
                                "citation": {"type": "string"},
                            },
                            "required": ["source", "url", "snippet", "citation"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": [
                    "name",
                    "title",
                    "confirmed",
                    "employment_confidence",
                    "conflicting_evidence",
                    "linkedin_url",
                    "evidence",
                ],
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
    return sorted(
        people,
        key=lambda person: (
            -person.role_match_score,
            -person.confidence,
            0 if person.matched_role else 1,
        ),
    )


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


def _tavily_key(provider_keys: Optional[Dict[str, str]] = None) -> Optional[str]:
    if provider_keys and provider_keys.get("tavily"):
        return provider_keys["tavily"]
    return settings.tavily_api_key or os.getenv("TAVILY_API_KEY")


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
    model: str = "sonar",
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    payload: Dict[str, Any] = {
        "model": model,
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


async def _discover_people_with_tavily(
    company_name: str,
    domain: str,
    roles: List[str],
    provider_keys: Optional[Dict[str, str]] = None,
) -> Tuple[List[DiscoveredPerson], Dict[str, Any]]:
    """Discover leadership candidates via Tavily web search."""
    api_key = _tavily_key(provider_keys)
    if not api_key:
        return [], {"skipped": "no_tavily_key"}

    roles_text = ", ".join(roles[:4])
    query = (
        f'"{company_name}" {roles_text} leadership team current employees '
        f"site:{domain} OR linkedin"
    )

    try:
        from .tavily_tool import TavilySearchTool

        tool = TavilySearchTool(
            max_results=5,
            search_depth="basic",
            tavily_api_key=api_key,
        )
        search_result = await tool.search_async(query)
    except Exception as error:
        return [], {"error": str(error)}

    if search_result.error:
        return [], {"error": search_result.error}

    context_parts: List[str] = []
    if search_result.answer:
        context_parts.append(f"ANSWER:\n{search_result.answer}")
    for snippet in search_result.content_snippets[:8]:
        context_parts.append(snippet)
    for result in search_result.results[:8]:
        if isinstance(result, dict):
            title = str(result.get("title") or "")
            content = str(result.get("content") or result.get("snippet") or "")
            url = str(result.get("url") or "")
            if content:
                context_parts.append(f"URL: {url}\nTITLE: {title}\n{content}")

    context = "\n\n".join(context_parts).strip()
    if not context:
        return [], {"skipped": "no_tavily_context"}

    openai_key = _openai_key(provider_keys)
    if not openai_key:
        return [], {"skipped": "no_openai_key_for_tavily_extraction"}

    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=openai_key)
        response = await client.chat.completions.create(
            model=LLM_MODEL,
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Extract people who currently work at the target company from web search "
                        "snippets. Return strict JSON: people [{ name, title, confidence 0-1 }]. "
                        "Only include current employees at the target company."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "company_name": company_name,
                            "domain": domain,
                            "target_roles": roles,
                            "search_context": context[:20000],
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
        )
        parsed = _extract_json_object(response.choices[0].message.content or "{}")
    except Exception as error:
        return [], {"error": f"tavily_extraction_failed: {error}"}

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
            else 0.72
        )
        person = _build_discovered_person(
            name=name,
            title=title,
            roles=roles,
            source=TAVILY_SOURCE,
            confidence=confidence,
            sources=[TAVILY_SOURCE],
        )
        if person.matched_role:
            people.append(person)

    return people, {
        "query": query,
        "parsed": parsed,
        "extracted_count": len(people),
    }


def _map_findymail_employees(
    employees: Optional[List[Dict[str, Any]]],
    roles: List[str],
) -> List[DiscoveredPerson]:
    """Map Convex FindyMail /search/employees results into discovered people."""
    if not employees:
        return []

    people: List[DiscoveredPerson] = []
    seen: set[str] = set()
    for entry in employees:
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("name") or entry.get("full_name") or "").strip()
        title = str(entry.get("title") or entry.get("job_title") or "").strip()
        if not name or not title:
            continue
        key = _normalize(name)
        if key in seen:
            continue
        seen.add(key)

        linkedin = entry.get("linkedin_url") or entry.get("linkedinUrl")
        if not isinstance(linkedin, str):
            linkedin = None

        person = _build_discovered_person(
            name=name,
            title=title,
            roles=roles,
            source=FINDYMAIL_SOURCE,
            linkedin_url=linkedin,
            confidence=0.75,
            sources=[FINDYMAIL_SOURCE],
        )
        if person.matched_role:
            people.append(person)

    return people


def _collect_website_employment_evidence(
    person: DiscoveredPerson,
    scrape_result: WebsiteScrapeResult,
) -> List[Dict[str, Any]]:
    """Check if person appears on company website pages."""
    evidence: List[Dict[str, Any]] = []
    name_parts = [part for part in _normalize(person.name).split() if len(part) > 2]
    if not name_parts:
        return evidence

    for page in scrape_result.page_texts:
        if not isinstance(page, dict):
            continue
        text = str(page.get("text") or "")
        text_norm = _normalize(text)
        if not text_norm:
            continue

        matches_name = all(part in text_norm for part in name_parts[:2])
        if not matches_name:
            continue

        url = str(page.get("url") or "")
        snippet_start = max(0, text_norm.find(name_parts[0]) - 80)
        snippet = text[snippet_start : snippet_start + 200].strip()
        evidence.append(
            {
                "source": "company_website",
                "url": url or None,
                "snippet": snippet or None,
            }
        )

    return evidence


async def _verify_employment_for_candidates(
    people: List[DiscoveredPerson],
    company_name: str,
    domain: str,
    scrape_result: WebsiteScrapeResult,
    provider_keys: Optional[Dict[str, str]] = None,
) -> Tuple[List[DiscoveredPerson], List[DiscoveredPerson], Dict[str, Any]]:
    """
    Employment Verification Agent — confirm candidates currently work at the company.
    Returns (verified, rejected, metadata).
    """
    if not people:
        return [], [], {"skipped": "no_people_to_verify"}

    api_key = _perplexity_key(provider_keys)
    if not api_key:
        for person in people:
            person.employment_verified = True
            person.employment_confidence = 100
        return people, [], {"skipped": "no_perplexity_key"}

    website_evidence_by_name: Dict[str, List[Dict[str, Any]]] = {}
    for person in people:
        website_evidence_by_name[_normalize(person.name)] = (
            _collect_website_employment_evidence(person, scrape_result)
        )

    system_prompt = (
        "You verify whether each person currently works at the company with the stated title. "
        "Use company website listings, recent press, conference speaker pages, professional "
        "profiles, and recent mentions. "
        "Return strict JSON: validations [{ name, title, confirmed, employment_confidence 0-100, "
        "conflicting_evidence, linkedin_url, evidence [{ source, url, snippet, citation }] }]. "
        "Set conflicting_evidence true when evidence shows they left or work elsewhere."
    )
    user_content = json.dumps(
        {
            "company_name": company_name,
            "domain": domain,
            "people": [
                {
                    "name": person.name,
                    "title": person.title,
                    "discovery_sources": person.sources,
                    "website_evidence": website_evidence_by_name.get(
                        _normalize(person.name),
                        [],
                    ),
                }
                for person in people
            ],
        },
        ensure_ascii=False,
    )

    parsed, meta = await _perplexity_json_completion(
        api_key,
        system_prompt,
        user_content,
        max_tokens=1200,
        schema_name="employment_verification",
        schema=EMPLOYMENT_VERIFICATION_SCHEMA,
        model="sonar-pro",
    )

    validations = parsed.get("validations") or []
    if not isinstance(validations, list):
        validations = []

    validation_map: Dict[str, Dict[str, Any]] = {}
    for entry in validations:
        if not isinstance(entry, dict):
            continue
        name_key = _normalize(str(entry.get("name") or ""))
        if name_key:
            validation_map[name_key] = entry

    verified: List[DiscoveredPerson] = []
    rejected: List[DiscoveredPerson] = []

    for person in people:
        entry = validation_map.get(_normalize(person.name))
        website_evidence = website_evidence_by_name.get(_normalize(person.name), [])

        if not entry:
            if website_evidence and WEBSITE_SOURCE in person.sources:
                person.employment_verified = True
                person.employment_confidence = WEBSITE_EMPLOYMENT_CONFIDENCE_FLOOR
                person.verification_evidence = website_evidence
                verified.append(person)
            else:
                person.employment_verified = False
                person.employment_confidence = 0
                person.verification_evidence = []
                rejected.append(person)
            continue

        confirmed = entry.get("confirmed") is True
        conflicting = entry.get("conflicting_evidence") is True
        confidence_raw = entry.get("employment_confidence")
        employment_confidence = (
            int(confidence_raw)
            if isinstance(confidence_raw, (int, float))
            else 0
        )
        employment_confidence = max(0, min(100, employment_confidence))

        if website_evidence:
            employment_confidence = max(
                employment_confidence,
                WEBSITE_EMPLOYMENT_CONFIDENCE_FLOOR,
            )

        evidence_entries = entry.get("evidence") or []
        if not isinstance(evidence_entries, list):
            evidence_entries = []

        combined_evidence: List[Dict[str, Any]] = []
        for item in website_evidence:
            combined_evidence.append(item)
        for item in evidence_entries:
            if isinstance(item, dict):
                combined_evidence.append(
                    {
                        "source": item.get("source"),
                        "url": item.get("url"),
                        "snippet": item.get("snippet"),
                        "citation": item.get("citation"),
                    }
                )

        linkedin = entry.get("linkedin_url") or entry.get("linkedinUrl")
        if isinstance(linkedin, str) and linkedin.strip():
            person.linkedin_url = linkedin.strip()

        person.employment_confidence = employment_confidence
        person.verification_evidence = combined_evidence

        passes_gate = (
            confirmed
            and not conflicting
            and employment_confidence >= EMPLOYMENT_CONFIDENCE_THRESHOLD
        )
        person.employment_verified = passes_gate

        if passes_gate:
            verified.append(person)
        else:
            rejected.append(person)

    return verified, rejected, {"parsed": parsed, **meta}


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

    return people, {
        "model": LLM_MODEL,
        "parsed": parsed,
        "context_chars": len(context),
        "matched_count": len(people),
    }


def _merge_discovered_people(
    *source_lists: List[DiscoveredPerson],
) -> List[DiscoveredPerson]:
    """Merge by normalized name across all discovery sources; boost confidence."""
    merged: Dict[str, DiscoveredPerson] = {}

    for source_list in source_lists:
        for person in source_list:
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
            if not existing.title and person.title:
                existing.title = person.title
            if not existing.linkedin_url and person.linkedin_url:
                existing.linkedin_url = person.linkedin_url
            if not existing.source_url and person.source_url:
                existing.source_url = person.source_url

            prior_source_count = len(existing.sources)
            for src in person.sources:
                if src not in existing.sources:
                    existing.sources.append(src)

            new_sources = len(existing.sources) - prior_source_count
            if new_sources > 0:
                existing.confidence = min(
                    1.0,
                    existing.confidence + 0.05 * new_sources,
                )
            if person.confidence > existing.confidence:
                existing.confidence = min(
                    existing.confidence + 0.05,
                    person.confidence,
                )

    return _rank_discovered_people(list(merged.values()))


async def discover_people_at_company(
    company_name: str,
    domain: str,
    location: str = "",
    industry: str = "",
    requested_roles: Optional[List[str]] = None,
    provider_keys: Optional[Dict[str, str]] = None,
    findymail_employees: Optional[List[Dict[str, Any]]] = None,
) -> DiscoverPeopleResponse:
    """
    Phase 1: discover candidates from website, FindyMail, Perplexity, Tavily — merge.
    Phase 2: employment verification gates who proceeds to FindyMail email lookup.
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

        findymail_people = _map_findymail_employees(findymail_employees, roles)

        perplexity_task = _discover_leadership_with_perplexity(
            company_name=company_name,
            domain=domain,
            location=location,
            roles=roles,
            provider_keys=provider_keys,
        )
        tavily_task = _discover_people_with_tavily(
            company_name=company_name,
            domain=domain,
            roles=roles,
            provider_keys=provider_keys,
        )

        (
            (perplexity_people, perplexity_meta),
            (tavily_people, tavily_meta),
        ) = await asyncio.gather(perplexity_task, tavily_task)

        if perplexity_people:
            additional_credits += 1
        if tavily_people:
            additional_credits += 1

        merged_people = _merge_discovered_people(
            website_people,
            findymail_people,
            perplexity_people,
            tavily_people,
        )

        verified_people: List[DiscoveredPerson] = []
        rejected_people: List[DiscoveredPerson] = []
        verification_meta: Dict[str, Any] = {"skipped": "no_people_to_verify"}

        if merged_people:
            verified_people, rejected_people, verification_meta = (
                await _verify_employment_for_candidates(
                    merged_people,
                    company_name=company_name,
                    domain=domain,
                    scrape_result=scrape_result,
                    provider_keys=provider_keys,
                )
            )
            if verification_meta.get("skipped") != "no_perplexity_key":
                additional_credits += 1

        company_overview = scrape_result.company_snippet or ""

        if verified_people:
            research_tier = "multi_source+verified"
        elif merged_people:
            research_tier = "multi_source+unverified"
        elif scrape_result.errors:
            research_tier = "error"
        else:
            research_tier = "none"

        elapsed = time.time() - start
        logger.info(
            "People discovery %s (%s): scraped %d raw, %d merged, %d verified, "
            "%d rejected in %.1fs | urls=%s",
            company_name,
            domain,
            len(scrape_result.people),
            len(merged_people),
            len(verified_people),
            len(rejected_people),
            elapsed,
            scrape_result.scraped_urls,
        )
        for person in verified_people:
            logger.info(
                "  ✓ %s | %s | role_score=%.2f conf=%.2f emp=%d | sources=%s",
                person.name,
                person.title,
                person.role_match_score,
                person.confidence,
                person.employment_confidence,
                person.sources,
            )
        for person in rejected_people:
            logger.info(
                "  ✗ %s | %s | emp_conf=%d | sources=%s",
                person.name,
                person.title,
                person.employment_confidence,
                person.sources,
            )

        return DiscoverPeopleResponse(
            people=verified_people,
            rejected_people=rejected_people,
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
                "tavily": tavily_meta,
                "verification": {
                    **verification_meta,
                    "verified_count": len(verified_people),
                    "rejected_count": len(rejected_people),
                    "rejected": [
                        _safe_discovered_person_dump(p) for p in rejected_people
                    ],
                },
                "ranking": {
                    "confidence_threshold_findymail": CONFIDENCE_THRESHOLD_FINDYMAIL,
                    "employment_confidence_threshold": EMPLOYMENT_CONFIDENCE_THRESHOLD,
                    "verified_count": len(verified_people),
                },
                "merge": {
                    "website_count": len(website_people),
                    "findymail_count": len(findymail_people),
                    "perplexity_count": len(perplexity_people),
                    "tavily_count": len(tavily_people),
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
