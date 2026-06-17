"""Fetch team/about pages and extract name + title pairs from company websites."""

import json
import logging
import re
import asyncio
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import urljoin, urlparse, urlunparse

import aiohttp
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

WEBSITE_SCRAPE_TIMEOUT_SECONDS = 20
PLAYWRIGHT_TIMEOUT_MS = 20_000
MAX_PAGES_TO_FETCH = 12
MAX_PEOPLE_FROM_WEBSITE = 6

TEAM_PATHS = (
    "/team",
    "/team/",
    "/about",
    "/about/",
    "/about-us",
    "/about-us/",
    "/leadership",
    "/leadership/",
    "/company",
    "/company/",
    "/our-team",
    "/our-team/",
    "/people",
    "/people/",
    "/who-we-are",
    "/who-we-are/",
    "/management",
    "/management/",
    "/about/team",
    "/about/team/",
    "/company/team",
    "/company/team/",
)

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)

LINK_KEYWORDS = {
    "team": 100,
    "our-team": 100,
    "about-us": 95,
    "about": 90,
    "leadership": 90,
    "management": 85,
    "people": 80,
    "who-we-are": 80,
    "our-story": 70,
    "story": 55,
    "founder": 65,
    "company": 45,
}

LOW_VALUE_LINK_KEYWORDS = (
    "blog",
    "pricing",
    "terms",
    "privacy",
    "gdpr",
    "ccpa",
    "login",
    "sign-up",
    "signup",
    "demo",
    "contact",
    "support",
    "help",
    "faq",
    "template",
    "alternatives",
    "report-abuse",
)

TITLE_HINT_RE = re.compile(
    r"\b("
    r"ceo|chief|founder|co-founder|president|director|manager|"
    r"vp|vice president|head of|owner|partner|marketing|sales|"
    r"operations|coo|cmo|cfo|cto|managing|principal|lead|"
    r"business development|development|representative|specialist|"
    r"engineer|developer|software|full stack|designer|design|"
    r"ux|ui|product|growth|officer|executive|account"
    r")\b",
    re.IGNORECASE,
)

SKIP_NAME_RE = re.compile(
    r"(cookie|privacy|subscribe|contact us|read more|learn more|"
    r"our team|meet the team|about us|click here|sign up|"
    r"log in|login|get a demo|book a demo)",
    re.IGNORECASE,
)

GENERIC_NAME_WORDS = {
    "about",
    "mission",
    "vision",
    "culture",
    "story",
    "team",
    "platform",
    "resources",
    "pricing",
    "features",
    "support",
    "company",
    "mailsoftly",
    "products",
    "english",
    "login",
}


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
    page_texts: List[Dict[str, str]] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)


def _normalize_domain(domain: str) -> str:
    cleaned = domain.strip().lower()
    cleaned = re.sub(r"^https?://", "", cleaned)
    cleaned = cleaned.split("/")[0]
    return cleaned.replace("www.", "")


def _normalize_name_key(name: str) -> str:
    return re.sub(r"\s+", " ", name.lower().strip())


def _canonicalize_url(url: str) -> str:
    parsed = urlparse(url)
    path = parsed.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    return urlunparse((parsed.scheme, parsed.netloc.lower(), path, "", "", ""))


def _is_same_domain(candidate_url: str, normalized_domain: str) -> bool:
    host = urlparse(candidate_url).netloc.lower().replace("www.", "")
    return host == normalized_domain


def _score_people_link(url: str, anchor_text: str = "") -> int:
    parsed = urlparse(url)
    haystack = f"{parsed.path} {anchor_text}".lower().replace("_", "-")
    if any(keyword in haystack for keyword in LOW_VALUE_LINK_KEYWORDS):
        return -100

    score = 0
    for keyword, weight in LINK_KEYWORDS.items():
        if keyword in haystack:
            score = max(score, weight)

    # Short, direct pages are usually more useful than deeply nested utility pages.
    depth = len([part for part in parsed.path.split("/") if part])
    if score > 0:
        score -= min(depth, 5)
    return score


def _extract_candidate_links(
    html: str,
    page_url: str,
    normalized_domain: str,
) -> List[str]:
    soup = BeautifulSoup(html, "html.parser")
    scored: Dict[str, int] = {}

    for anchor in soup.find_all("a", href=True):
        href = str(anchor.get("href") or "").strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue

        absolute = _canonicalize_url(urljoin(page_url, href))
        if not _is_same_domain(absolute, normalized_domain):
            continue

        anchor_text = anchor.get_text(" ", strip=True)
        score = _score_people_link(absolute, anchor_text)
        if score <= 0:
            continue
        scored[absolute] = max(scored.get(absolute, 0), score)

    return [
        url for url, _score in sorted(
            scored.items(),
            key=lambda item: (-item[1], item[0]),
        )
    ]


def _strip_accents(value: str) -> str:
    return "".join(
        ch
        for ch in unicodedata.normalize("NFKD", value)
        if not unicodedata.combining(ch)
    )


def _is_name_token(token: str) -> bool:
    cleaned = token.strip(".,()[]{}")
    if not cleaned:
        return False

    # Suffixes are allowed only after at least two real name tokens.
    if cleaned.lower().rstrip(".") in {"jr", "sr", "ii", "iii", "iv"}:
        return True

    allowed_punctuation = {"'", "’", "-", "."}
    letters = [ch for ch in cleaned if ch.isalpha()]
    if len(letters) == 0:
        return False
    if any(not (ch.isalpha() or ch in allowed_punctuation) for ch in cleaned):
        return False

    # Names on international sites can include Turkish, accented, and all-caps
    # surname tokens. Require at least one uppercase letter to avoid sentences.
    return any(ch.isupper() for ch in letters)


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

    normalized_words = {
        _strip_accents(word).lower().strip(".,()[]{}")
        for word in words
    }
    if normalized_words & GENERIC_NAME_WORDS:
        return False

    real_name_tokens = [
        word for word in words
        if word.lower().rstrip(".") not in {"jr", "sr", "ii", "iii", "iv"}
    ]
    if len(real_name_tokens) < 2:
        return False

    if not all(_is_name_token(w) for w in words):
        return False
    return True


def _looks_like_job_title(text: str) -> bool:
    text = text.strip()
    if len(text) < 3 or len(text) > 120:
        return False
    if len(text.split()) > 14:
        return False
    if not TITLE_HINT_RE.search(text):
        return False
    if SKIP_NAME_RE.search(text):
        return False
    return True


def _first_title_near_heading(heading: Any) -> Optional[str]:
    """Find a title near a name heading across sibling/wrapper layouts."""
    sibling = heading.find_next_sibling()
    checked = 0
    while sibling is not None and checked < 6:
        checked += 1
        if getattr(sibling, "name", None):
            text = sibling.get_text(" ", strip=True)
            if _looks_like_job_title(text):
                return text
            for child in sibling.find_all(["h1", "h2", "h3", "h4", "h5", "p", "span", "div"], limit=8):
                child_text = child.get_text(" ", strip=True)
                if _looks_like_job_title(child_text):
                    return child_text
        sibling = sibling.find_next_sibling()

    parent = heading.parent
    if parent is not None:
        seen_heading = False
        for el in parent.find_all(["h1", "h2", "h3", "h4", "h5", "p", "span", "div"], limit=12):
            if el == heading:
                seen_heading = True
                continue
            if not seen_heading:
                continue
            text = el.get_text(" ", strip=True)
            if _looks_like_job_title(text):
                return text

    return None


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
    for heading in soup.find_all(["h1", "h2", "h3", "h4", "h5"]):
        name = heading.get_text(" ", strip=True)
        if not _looks_like_person_name(name):
            continue

        title = _first_title_near_heading(heading)

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


def _html_to_readable_text(html: str, max_chars: int = 12000) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg"]):
        tag.decompose()
    text = soup.get_text("\n", strip=True)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text[:max_chars]


def _parse_people_from_html(html: str, page_url: str, seen: Set[str]) -> tuple[List[ScrapedPerson], str]:
    soup = BeautifulSoup(html, "html.parser")
    snippet = _extract_company_snippet(soup)

    people: List[ScrapedPerson] = []
    people.extend(_extract_json_ld_people(soup, page_url, seen))
    people.extend(_extract_team_card_people(soup, page_url, seen))
    people.extend(_extract_heading_pairs(soup, page_url, seen))

    return people, snippet


async def _fetch_page(session: aiohttp.ClientSession, url: str) -> Tuple[Optional[str], Optional[str]]:
    try:
        async with session.get(url, allow_redirects=True) as response:
            if response.status != 200:
                return None, f"{url}: status={response.status}"
            content_type = response.headers.get("Content-Type", "")
            text = await response.text(errors="ignore")
            looks_like_html = "<html" in text[:500].lower() or "<!doctype html" in text[:500].lower()
            if (
                "text/html" not in content_type
                and "application/xhtml" not in content_type
                and not looks_like_html
            ):
                return None, f"{url}: non_html_content_type={content_type or 'missing'}"
            if len(text) > 2_000_000:
                text = text[:2_000_000]
            return text, None
    except Exception as error:
        logger.debug("Website fetch failed for %s: %s", url, error)
        return None, f"{url}: {type(error).__name__}: {error}"


def _should_use_browser_fallback(fetch_error: Optional[str]) -> bool:
    if not fetch_error:
        return False
    markers = (
        "status=401",
        "status=403",
        "status=406",
        "status=429",
        "non_html_content_type",
        "Timeout",
        "ClientConnector",
        "SSLError",
    )
    return any(marker in fetch_error for marker in markers)


async def _fetch_page_with_playwright(url: str) -> Tuple[Optional[str], Optional[str]]:
    try:
        from playwright.async_api import async_playwright
    except Exception as error:
        return None, f"{url}: playwright_unavailable: {error}"

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-blink-features=AutomationControlled",
                ],
            )
            try:
                context = await browser.new_context(
                    user_agent=USER_AGENT,
                    locale="en-US",
                    viewport={"width": 1365, "height": 900},
                    extra_http_headers={
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                        "Accept-Language": "en-US,en;q=0.9",
                    },
                )
                page = await context.new_page()
                response = await page.goto(
                    url,
                    wait_until="domcontentloaded",
                    timeout=PLAYWRIGHT_TIMEOUT_MS,
                )
                if response and response.status >= 400:
                    return None, f"{url}: playwright_status={response.status}"

                try:
                    await page.wait_for_load_state("networkidle", timeout=3_000)
                except Exception:
                    # Many sites keep analytics/websocket requests open; DOM is enough.
                    pass

                html = await page.content()
                if not html.strip():
                    return None, f"{url}: playwright_empty_page"
                return html[:2_000_000], None
            finally:
                await browser.close()
    except Exception as error:
        return None, f"{url}: playwright_{type(error).__name__}: {error}"


async def _fetch_tiered_page(
    session: aiohttp.ClientSession,
    url: str,
) -> Tuple[Optional[str], Optional[str], str]:
    html, fetch_error = await _fetch_page(session, url)
    if html:
        return html, None, "http"

    if _should_use_browser_fallback(fetch_error):
        browser_html, browser_error = await _fetch_page_with_playwright(url)
        if browser_html:
            return browser_html, None, "playwright"
        combined_error = "; ".join(
            error for error in (fetch_error, browser_error) if error
        )
        return None, combined_error or fetch_error, "failed"

    return None, fetch_error, "failed"


async def scrape_people_from_website(
    domain: str,
    company_name: str = "",
) -> WebsiteScrapeResult:
    """Scrape team/about pages for leadership names and titles."""
    normalized = _normalize_domain(domain)
    if not normalized:
        return WebsiteScrapeResult(errors=["invalid_domain"])

    base_urls = [
        f"https://{normalized}",
        f"https://www.{normalized}",
        f"http://{normalized}",
        f"http://www.{normalized}",
    ]
    guessed_urls: List[str] = []
    for base in base_urls:
        for path in TEAM_PATHS:
            guessed_urls.append(_canonicalize_url(urljoin(base + "/", path.lstrip("/"))))

    result = WebsiteScrapeResult()
    seen_people: Set[str] = set()
    fetched_urls: Set[str] = set()
    timeout = aiohttp.ClientTimeout(total=WEBSITE_SCRAPE_TIMEOUT_SECONDS)

    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
    }

    async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
        homepage_html: Optional[str] = None
        homepage_url: Optional[str] = None
        homepage_candidates: List[str] = []

        for base in base_urls:
            canonical_base = _canonicalize_url(base)
            html, fetch_error, fetch_tier = await _fetch_tiered_page(session, canonical_base)
            fetched_urls.add(canonical_base)
            if html:
                homepage_html = html
                homepage_url = canonical_base
                result.scraped_urls.append(f"{canonical_base} [{fetch_tier}]")
                _, snippet = _parse_people_from_html(html, canonical_base, set())
                if snippet and not result.company_snippet:
                    result.company_snippet = snippet
                homepage_candidates = _extract_candidate_links(
                    html,
                    canonical_base,
                    normalized,
                )
                break
            if fetch_error:
                result.errors.append(fetch_error)

        # Crawl real internal links first, then guessed paths, then homepage as
        # last resort. This avoids homepage testimonial false positives when a
        # real team/about page exists.
        urls_to_try: List[str] = []
        for url in [*homepage_candidates, *guessed_urls]:
            if url not in urls_to_try:
                urls_to_try.append(url)
        if homepage_url and homepage_url not in urls_to_try:
            urls_to_try.append(homepage_url)

        for url in urls_to_try[:MAX_PAGES_TO_FETCH]:
            if len(result.people) >= MAX_PEOPLE_FROM_WEBSITE:
                break
            if url in fetched_urls and url == homepage_url and homepage_html is None:
                continue

            if url == homepage_url and homepage_html:
                html = homepage_html
                fetch_tier = "cached-homepage"
            else:
                html, fetch_error, fetch_tier = await _fetch_tiered_page(session, url)
                fetched_urls.add(url)
                if not html:
                    if fetch_error:
                        result.errors.append(fetch_error)
                    continue

            result.scraped_urls.append(f"{url} [{fetch_tier}]")
            result.page_texts.append({
                "url": url,
                "text": _html_to_readable_text(html),
            })
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
