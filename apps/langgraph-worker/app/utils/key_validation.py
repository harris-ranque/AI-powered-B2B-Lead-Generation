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
PERPLEXITY_MODELS_URL = "https://api.perplexity.ai/models"


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
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as session:
            async with session.get(PERPLEXITY_MODELS_URL, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    quota = data.get("data")
                    quota_remaining = len(quota) if isinstance(quota, list) else None
                    return {"valid": True, "quotaRemaining": quota_remaining}
                body = await response.text()
                logger.warning("Perplexity validation failed", extra={"status": response.status})
                return {"valid": False, "error": body or "Authentication failed"}
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
            if response.get("status") == "OK":
                return {"valid": True}
            return {
                "valid": False,
                "error": json.dumps(response, default=str)[:200],
            }
        except Exception as error:  # pylint: disable=broad-except
            logger.error("Google Places validation error", exc_info=error)
            return {"valid": False, "error": str(error)}

    return await asyncio.to_thread(_validate)


PROVIDER_VALIDATORS = {
    "openai": validate_openai_key,
    "tavily": validate_tavily_key,
    "perplexity": validate_perplexity_key,
    "google_places": validate_google_places_key,
}


async def validate_user_key(provider: str, api_key: Optional[str]) -> ValidationResult:
    if not api_key:
        return {"valid": False, "error": "API key missing"}

    validator = PROVIDER_VALIDATORS.get(provider)
    if not validator:
        return {"valid": False, "error": f"Unsupported provider: {provider}"}

    return await validator(api_key)
