"""Utility functions for validating provider API keys."""

from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, Optional

import aiohttp
import googlemaps

from .logger import setup_logger

logger = setup_logger(__name__)

ValidationResult = Dict[str, Any]

OPENAI_MODELS_URL = "https://api.openai.com/v1/models"
TAVILY_SEARCH_URL = "https://api.tavily.com/search"
PERPLEXITY_CHAT_URL = "https://api.perplexity.ai/chat/completions"
FINDYMAIL_CREDITS_URL = "https://app.findymail.com/api/credits"
GOOGLE_MAPS_FINDPLACE_URL = "https://maps.googleapis.com/maps/api/place/findplacefromtext/json"
ICYPEAS_CREDITS_URL = "https://app.icypeas.com/api/credits"
APIFY_USER_URL = "https://api.apify.com/v2/users/me"
INSTANTLY_ACCOUNTS_URL = "https://api.instantly.ai/api/v2/accounts"


async def validate_openai_key(api_key: str) -> ValidationResult:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as session:
            async with session.get(OPENAI_MODELS_URL, headers=headers) as response:
                if response.status == 200:
                    return {"valid": True}
                body = await response.text()
                logger.warning("OpenAI validation failed", extra={"status": response.status})
                return {"valid": False, "error": body or "Authentication failed"}
    except asyncio.TimeoutError:
        return {"valid": False, "error": "Validation timeout"}
    except Exception as error:  # pylint: disable=broad-except
        logger.error("OpenAI key validation error", exc_info=error)
        return {"valid": False, "error": str(error)}


async def validate_tavily_key(api_key: str) -> ValidationResult:
    payload = {
        "api_key": api_key,
        "query": "genni api key validation",
        "max_results": 1,
    }

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as session:
            async with session.post(TAVILY_SEARCH_URL, json=payload) as response:
                if response.status == 200:
                    return {"valid": True}
                body = await response.text()
                logger.warning("Tavily validation failed", extra={"status": response.status})
                return {"valid": False, "error": body or "Authentication failed"}
    except asyncio.TimeoutError:
        return {"valid": False, "error": "Validation timeout"}
    except Exception as error:  # pylint: disable=broad-except
        logger.error("Tavily key validation error", exc_info=error)
        return {"valid": False, "error": str(error)}


async def validate_perplexity_key(api_key: str) -> ValidationResult:
    """Validate Perplexity API key by attempting a minimal chat completion request."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    # Minimal test payload to validate the key without consuming significant quota
    payload = {
        # Use the current Sonar model (as of 2025, replaces deprecated llama-3.1-sonar models)
        # Reference: https://docs.perplexity.ai/docs/model-cards
        "model": "sonar",
        "messages": [{"role": "user", "content": "test"}],
        "max_tokens": 1
    }

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:
            async with session.post(PERPLEXITY_CHAT_URL, headers=headers, json=payload) as response:
                # 200: Valid key and successful request
                # 401/403: Invalid or unauthorized key
                if response.status == 200:
                    return {"valid": True}

                # Get error details for better diagnostics
                try:
                    error_data = await response.json()
                    error_msg = error_data.get("error", {}).get("message", "Authentication failed")
                except Exception:
                    error_msg = await response.text()

                logger.warning("Perplexity validation failed", extra={
                    "status": response.status,
                    "error": error_msg[:200]
                })
                return {"valid": False, "error": error_msg[:200] or "Authentication failed"}
    except asyncio.TimeoutError:
        return {"valid": False, "error": "Validation timeout"}
    except Exception as error:  # pylint: disable=broad-except
        logger.error("Perplexity key validation error", exc_info=error)
        return {"valid": False, "error": str(error)}


async def validate_google_places_key(api_key: str) -> ValidationResult:
    def _validate() -> ValidationResult:
        try:
            client = googlemaps.Client(key=api_key, timeout=5)
            response = client.find_place("Genni", "textquery")
            status = response.get("status")
            # Treat ZERO_RESULTS as success – it means the key worked but no matches found
            if status in {"OK", "ZERO_RESULTS"}:
                return {"valid": True}
            return {
                "valid": False,
                "error": json.dumps(response, default=str)[:200],
            }
        except Exception as error:  # pylint: disable=broad-except
            logger.error("Google Places validation error", exc_info=error)
            return {"valid": False, "error": str(error)}

    return await asyncio.to_thread(_validate)


async def validate_findymail_key(api_key: str) -> ValidationResult:
    """Validate FindyMail API key by checking credits endpoint."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as session:
            async with session.get(FINDYMAIL_CREDITS_URL, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    # Extract quota information if available
                    credits = data.get("credits")
                    return {
                        "valid": True,
                        "quotaRemaining": credits if isinstance(credits, (int, float)) else None
                    }
                body = await response.text()
                logger.warning("FindyMail validation failed", extra={"status": response.status, "body": body[:200]})
                return {"valid": False, "error": body or "Authentication failed"}
    except asyncio.TimeoutError:
        return {"valid": False, "error": "Validation timeout"}
    except Exception as error:  # pylint: disable=broad-except
        logger.error("FindyMail key validation error", exc_info=error)
        return {"valid": False, "error": str(error)}


async def validate_google_maps_key(api_key: str) -> ValidationResult:
    """Validate Google Maps API key using Places API."""
    params = {
        "input": "restaurant",
        "inputtype": "textquery",
        "fields": "place_id,name",
        "key": api_key
    }

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as session:
            async with session.get(GOOGLE_MAPS_FINDPLACE_URL, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    # Check for valid response status (OK or ZERO_RESULTS both indicate working key)
                    if data.get("status") in ["OK", "ZERO_RESULTS"]:
                        return {"valid": True}
                    error_msg = data.get("error_message", f"API returned status: {data.get('status')}")
                    logger.warning("Google Maps validation failed", extra={"status": data.get("status"), "error": error_msg})
                    return {"valid": False, "error": error_msg}
                body = await response.text()
                logger.warning("Google Maps validation HTTP error", extra={"status": response.status, "body": body[:200]})
                return {"valid": False, "error": body or "Authentication failed"}
    except asyncio.TimeoutError:
        return {"valid": False, "error": "Validation timeout"}
    except Exception as error:  # pylint: disable=broad-except
        logger.error("Google Maps key validation error", exc_info=error)
        return {"valid": False, "error": str(error)}


async def validate_icypeas_key(api_key: str) -> ValidationResult:
    """Validate IcyPeas API key by checking credits endpoint."""
    headers = {
        "Authorization": api_key,  # IcyPeas uses direct key in Authorization header
    }

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as session:
            async with session.get(ICYPEAS_CREDITS_URL, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    credits = data.get("credits")
                    return {
                        "valid": True,
                        "quotaRemaining": credits if isinstance(credits, (int, float)) else None
                    }
                body = await response.text()
                logger.warning("IcyPeas validation failed", extra={"status": response.status, "body": body[:200]})
                return {"valid": False, "error": body or "Authentication failed"}
    except asyncio.TimeoutError:
        return {"valid": False, "error": "Validation timeout"}
    except Exception as error:  # pylint: disable=broad-except
        logger.error("IcyPeas key validation error", exc_info=error)
        return {"valid": False, "error": str(error)}


async def validate_apify_key(api_key: str) -> ValidationResult:
    """Validate Apify API key by checking user endpoint."""
    params = {"token": api_key}

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as session:
            async with session.get(APIFY_USER_URL, params=params) as response:
                if response.status == 200:
                    return {"valid": True}
                body = await response.text()
                logger.warning("Apify validation failed", extra={"status": response.status, "body": body[:200]})
                return {"valid": False, "error": body or "Authentication failed"}
    except asyncio.TimeoutError:
        return {"valid": False, "error": "Validation timeout"}
    except Exception as error:  # pylint: disable=broad-except
        logger.error("Apify key validation error", exc_info=error)
        return {"valid": False, "error": str(error)}


async def validate_instantly_key(api_key: str) -> ValidationResult:
    """Validate Instantly API key by checking accounts endpoint."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:
            async with session.get(INSTANTLY_ACCOUNTS_URL, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    # Return account count if available
                    account_count = len(data) if isinstance(data, list) else None
                    return {
                        "valid": True,
                        "quotaRemaining": account_count  # Number of sender accounts
                    }
                body = await response.text()
                logger.warning("Instantly validation failed", extra={"status": response.status, "body": body[:200]})
                return {"valid": False, "error": body or "Authentication failed"}
    except asyncio.TimeoutError:
        return {"valid": False, "error": "Validation timeout"}
    except Exception as error:  # pylint: disable=broad-except
        logger.error("Instantly key validation error", exc_info=error)
        return {"valid": False, "error": str(error)}


PROVIDER_VALIDATORS = {
    "openai": validate_openai_key,
    "tavily": validate_tavily_key,
    "perplexity": validate_perplexity_key,
    "google_places": validate_google_places_key,
    "google_maps": validate_google_maps_key,  # Legacy provider
    "findymail": validate_findymail_key,
    "icypeas": validate_icypeas_key,
    "apify": validate_apify_key,
    "instantly": validate_instantly_key,  # Email campaign automation
}


async def validate_user_key(provider: str, api_key: Optional[str]) -> ValidationResult:
    if not api_key:
        return {"valid": False, "error": "API key missing"}

    validator = PROVIDER_VALIDATORS.get(provider)
    if not validator:
        return {"valid": False, "error": f"Unsupported provider: {provider}"}

    return await validator(api_key)
