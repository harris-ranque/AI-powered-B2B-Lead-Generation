"""People discovery — identify decision makers before email lookup."""

import json
import logging
import re
import time
from typing import Any, Dict, List, Optional

import aiohttp

from ..models.people_discovery_models import DiscoveredPerson, DiscoverPeopleResponse

logger = logging.getLogger(__name__)

MAX_PEOPLE_PER_LEAD = 8
PERPLEXITY_TIMEOUT_SECONDS = 90


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


async def discover_people_at_company(
    company_name: str,
    domain: str,
    location: str = "",
    industry: str = "",
    requested_roles: Optional[List[str]] = None,
    expanded_role_patterns: Optional[List[str]] = None,
    provider_keys: Optional[Dict[str, str]] = None,
) -> DiscoverPeopleResponse:
    """Run Perplexity Sonar Pro to enumerate people before email lookup."""
    start = time.time()
    roles = [r.strip() for r in (requested_roles or []) if r and r.strip()]
    if not roles:
        roles = ["CEO", "Founder", "Owner"]

    api_key = None
    if provider_keys and provider_keys.get("perplexity"):
        api_key = provider_keys["perplexity"]
    if not api_key:
        import os

        api_key = os.getenv("PERPLEXITY_API_KEY")

    if not api_key:
        logger.error("Perplexity API key not configured for people discovery")
        return DiscoverPeopleResponse(
            people=[],
            company_overview="",
            processing_time=time.time() - start,
            research_tier="error",
        )

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
                    return DiscoverPeopleResponse(
                        people=[],
                        processing_time=time.time() - start,
                        research_tier="error",
                    )
                data = await response.json()

        choices = data.get("choices", [])
        if choices:
            raw_content = choices[0].get("message", {}).get("content", "") or ""
        citations = data.get("citations", []) or []
    except Exception as error:
        logger.error("People discovery request failed: %s", error)
        return DiscoverPeopleResponse(
            people=[],
            processing_time=time.time() - start,
            research_tier="error",
        )

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

        matched_role = _match_requested_role(title, roles, expanded_role_patterns)
        confidence_raw = entry.get("confidence")
        confidence = (
            float(confidence_raw)
            if isinstance(confidence_raw, (int, float))
            else 0.75
        )
        confidence = max(0.0, min(1.0, confidence))

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
            DiscoveredPerson(
                name=name,
                title=title,
                matched_role=matched_role,
                confidence=confidence,
                source=str(entry.get("source") or "perplexity"),
                source_url=source_url,
                linkedin_url=linkedin_url,
            )
        )

        if len(people) >= MAX_PEOPLE_PER_LEAD:
            break

    return DiscoverPeopleResponse(
        people=people,
        company_overview=company_overview,
        processing_time=time.time() - start,
        research_tier="pro",
        additional_credits_used=0,
        raw_data={
            "raw_content": raw_content,
            "citations": citations,
            "parsed": parsed,
        },
    )
