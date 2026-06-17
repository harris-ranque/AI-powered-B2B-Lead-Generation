"""Fetch team/about pages and extract name + title pairs from company websites."""

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set
from urllib.parse import urljoin, urlparse

import aiohttp
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

WEBSITE_SCRAPE_TIMEOUT_SECONDS = 15
MAX_PAGES_TO_FETCH = 6
MAX_PEOPLE_FROM_WEBSITE = 6

TEAM_PATHS = (
    "/team",
    "/about",
    "/about-us",
    "/leadership",
    "/company",
    "/our-team",
    "/people",
    "/who-we-are",
    "/management",
    "/about/team",
    "/company/team",
)

USER_AGENT = (
    "Mozilla/5.0 (compatible; GenniPeopleDiscovery/1.0; +https://genni.ai)"
)

TITLE_HINT_RE = re.compile(
    r"\b("
    r"ceo|chief|founder|co-founder|president|director|manager|"
    r"vp|vice president|head of|owner|partner|marketing|sales|"
    r"operations|coo|cmo|cfo|cto|managing|principal|lead"
    r")\b",
    re.IGNORECASE,
)

SKIP_NAME_RE = re.compile(
    r"(cookie|privacy|subscribe|contact us|read more|learn more|"
    r"our team|meet the team|about us|click here)",
    re.IGNORECASE,
)


@dataclass
class ScrapedPerson:
    name: str
    title: str
    source_url: str
    confidence: float = 0.88


@dataclass
class WebsiteScrapeResult:
    people: List[ScrapedPerson] = field(default_factory=list)
    company_snippet: str = ""
    scraped_urls: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)


def _normalize_domain(domain: str) -> str:
    cleaned = domain.strip().lower()
    cleaned = re.sub(r"^https?://", "", cleaned)
    cleaned = cleaned.split("/")[0]
    return cleaned.replace("www.", "")


def _normalize_name_key(name: str) -> str:
    return re.sub(r"\s+", " ", name.lower().strip())


def _looks_like_person_name(text: str) -> bool:
    text = text.strip()
    if len(text) < 3 or len(text) > 70:
        return False
    if SKIP_NAME_RE.search(text):
        return False
    if any(char in text for char in ("@", "http", "©", "|", "•")):
        return False
    words = [w for w in re.split(r"\s+", text) if w]
    if len(words) < 2 or len(words) > 5:
        return False
    if not all(re.match(r"^[A-Za-z][A-Za-z'.-]*$", w) for w in words):
        return False
    return True


def _looks_like_job_title(text: str) -> bool:
    text = text.strip()
    if len(text) < 3 or len(text) > 120:
        return False
    if not TITLE_HINT_RE.search(text):
        return False
    if SKIP_NAME_RE.search(text):
        return False
    return True


def _walk_json_ld(node: Any, people: List[ScrapedPerson], page_url: str, seen: Set[str]) -> None:
    if isinstance(node, dict):
        node_type = node.get("@type")
        types: List[str] = []
        if isinstance(node_type, str):
            types = [node_type]
        elif isinstance(node_type, list):
            types = [str(t) for t in node_type]

        if any("Person" in t for t in types):
            name = str(node.get("name") or "").strip()
            title = str(
                node.get("jobTitle") or node.get("title") or node.get("description") or ""
            ).strip()
            if name and title and _looks_like_person_name(name) and _looks_like_job_title(title):
                key = _normalize_name_key(name)
                if key not in seen:
                    seen.add(key)
                    people.append(
                        ScrapedPerson(
                            name=name,
                            title=title,
                            source_url=page_url,
                            confidence=0.92,
                        )
                    )

        for value in node.values():
            _walk_json_ld(value, people, page_url, seen)
    elif isinstance(node, list):
        for item in node:
            _walk_json_ld(item, people, page_url, seen)


def _extract_json_ld_people(soup: BeautifulSoup, page_url: str, seen: Set[str]) -> List[ScrapedPerson]:
    people: List[ScrapedPerson] = []
    for script in soup.find_all("script", type="application/ld+json"):
        raw = script.string or script.get_text()
        if not raw or not raw.strip():
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        _walk_json_ld(data, people, page_url, seen)
    return people


def _extract_team_card_people(soup: BeautifulSoup, page_url: str, seen: Set[str]) -> List[ScrapedPerson]:
    people: List[ScrapedPerson] = []
    class_pattern = re.compile(
        r"(team|member|person|staff|leadership|employee|bio|profile)",
        re.IGNORECASE,
    )

    candidates = soup.find_all(
        lambda tag: tag.name in ("div", "article", "li", "section")
        and tag.get("class")
        and any(class_pattern.search(" ".join(tag.get("class", []))) for _ in [1]),
    )

    for block in candidates[:40]:
        headings = block.find_all(["h1", "h2", "h3", "h4", "h5", "strong", "span"])
        name: Optional[str] = None
        title: Optional[str] = None

        for heading in headings:
            text = heading.get_text(" ", strip=True)
            if not text:
                continue
            if name is None and _looks_like_person_name(text):
                name = text
                continue
            if name and title is None and _looks_like_job_title(text):
                title = text
                break

        if not name:
            continue

        if not title:
            for p in block.find_all(["p", "span", "div"], limit=6):
                text = p.get_text(" ", strip=True)
                if _looks_like_job_title(text):
                    title = text
                    break

        if name and title:
            key = _normalize_name_key(name)
            if key not in seen:
                seen.add(key)
                people.append(
                    ScrapedPerson(
                        name=name,
                        title=title,
                        source_url=page_url,
                        confidence=0.85,
                    )
                )

    return people


def _extract_heading_pairs(soup: BeautifulSoup, page_url: str, seen: Set[str]) -> List[ScrapedPerson]:
    people: List[ScrapedPerson] = []
    for heading in soup.find_all(["h2", "h3", "h4"]):
        name = heading.get_text(" ", strip=True)
        if not _looks_like_person_name(name):
            continue

        title: Optional[str] = None
        sibling = heading.find_next_sibling()
        if sibling is not None:
            sibling_text = sibling.get_text(" ", strip=True)
            if _looks_like_job_title(sibling_text):
                title = sibling_text

        if not title:
            parent = heading.parent
            if parent is not None:
                for el in parent.find_all(["p", "span", "div"], limit=4):
                    if el == heading:
                        continue
                    text = el.get_text(" ", strip=True)
                    if _looks_like_job_title(text):
                        title = text
                        break

        if not title:
            continue

        key = _normalize_name_key(name)
        if key in seen:
            continue
        seen.add(key)
        people.append(
            ScrapedPerson(
                name=name,
                title=title,
                source_url=page_url,
                confidence=0.8,
            )
        )

    return people


def _extract_company_snippet(soup: BeautifulSoup) -> str:
    meta = soup.find("meta", attrs={"name": "description"})
    if meta and meta.get("content"):
        return str(meta["content"]).strip()[:500]

    for selector in ("main", "article", "[role=main]"):
        main = soup.select_one(selector)
        if main:
            paragraph = main.find("p")
            if paragraph:
                text = paragraph.get_text(" ", strip=True)
                if len(text) > 40:
                    return text[:500]
    return ""


def _parse_people_from_html(html: str, page_url: str, seen: Set[str]) -> tuple[List[ScrapedPerson], str]:
    soup = BeautifulSoup(html, "html.parser")
    snippet = _extract_company_snippet(soup)

    people: List[ScrapedPerson] = []
    people.extend(_extract_json_ld_people(soup, page_url, seen))
    people.extend(_extract_team_card_people(soup, page_url, seen))
    people.extend(_extract_heading_pairs(soup, page_url, seen))

    return people, snippet


async def _fetch_page(session: aiohttp.ClientSession, url: str) -> Optional[str]:
    try:
        async with session.get(url, allow_redirects=True) as response:
            if response.status != 200:
                return None
            content_type = response.headers.get("Content-Type", "")
            if "text/html" not in content_type and "application/xhtml" not in content_type:
                return None
            text = await response.text(errors="ignore")
            if len(text) > 2_000_000:
                text = text[:2_000_000]
            return text
    except Exception as error:
        logger.debug("Website fetch failed for %s: %s", url, error)
        return None


async def scrape_people_from_website(
    domain: str,
    company_name: str = "",
) -> WebsiteScrapeResult:
    """Scrape team/about pages for leadership names and titles."""
    normalized = _normalize_domain(domain)
    if not normalized:
        return WebsiteScrapeResult(errors=["invalid_domain"])

    base_urls = [f"https://{normalized}", f"https://www.{normalized}"]
    urls_to_try: List[str] = []
    for base in base_urls:
        urls_to_try.append(base)
        for path in TEAM_PATHS:
            urls_to_try.append(urljoin(base + "/", path.lstrip("/")))

    # Deduplicate while preserving order
    seen_urls: Set[str] = set()
    unique_urls: List[str] = []
    for url in urls_to_try:
        if url not in seen_urls:
            seen_urls.add(url)
            unique_urls.append(url)

    result = WebsiteScrapeResult()
    seen_people: Set[str] = set()
    timeout = aiohttp.ClientTimeout(total=WEBSITE_SCRAPE_TIMEOUT_SECONDS)

    headers = {"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"}

    async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
        for url in unique_urls[:MAX_PAGES_TO_FETCH + 2]:
            if len(result.people) >= MAX_PEOPLE_FROM_WEBSITE:
                break

            html = await _fetch_page(session, url)
            if not html:
                continue

            result.scraped_urls.append(url)
            page_people, snippet = _parse_people_from_html(html, url, seen_people)
            result.people.extend(page_people)

            if snippet and not result.company_snippet:
                result.company_snippet = snippet

            if len(result.people) >= MAX_PEOPLE_FROM_WEBSITE:
                break

    result.people = result.people[:MAX_PEOPLE_FROM_WEBSITE]

    logger.info(
        "Website scrape for %s (%s): %d people from %d pages",
        company_name or normalized,
        normalized,
        len(result.people),
        len(result.scraped_urls),
    )

    return result
