"""
Startup validation for LangGraph Worker
Validates critical dependencies and configurations before allowing the server to start
"""
import asyncio
import aiohttp
import logging
import sys
from typing import Optional, Dict, Any, List
from datetime import datetime

from .config import get_settings
from langchain_openai import ChatOpenAI

logger = logging.getLogger(__name__)

class StartupValidationError(Exception):
    """Raised when startup validation fails"""
    pass

class StartupValidator:
    """Validates critical dependencies and configurations at startup"""

    def __init__(self):
        self.settings = get_settings()
        self.validation_results: List[Dict[str, Any]] = []

    async def validate_all(self) -> bool:
        """Run all startup validations. Returns True if all pass, raises exception if any fail."""
        logger.info("🚀 Starting comprehensive startup validation...")

        validations = [
            ("API Keys", self.validate_api_keys),
            ("Webhook Connectivity", self.validate_webhook_connectivity),
            ("OpenAI Connection", self.validate_openai_connection),
            ("Configuration", self.validate_configuration)
        ]

        failed_validations = []

        for name, validation_func in validations:
            try:
                logger.info(f"📋 Validating {name}...")
                await validation_func()
                logger.info(f"✅ {name} validation passed")
                self.validation_results.append({
                    "name": name,
                    "status": "passed",
                    "timestamp": datetime.utcnow().isoformat()
                })
            except Exception as e:
                logger.error(f"❌ {name} validation failed: {str(e)}")
                failed_validations.append(f"{name}: {str(e)}")
                self.validation_results.append({
                    "name": name,
                    "status": "failed",
                    "error": str(e),
                    "timestamp": datetime.utcnow().isoformat()
                })

        if failed_validations:
            error_msg = f"Startup validation failed:\n" + "\n".join(f"  - {error}" for error in failed_validations)
            logger.error(error_msg)
            raise StartupValidationError(error_msg)

        logger.info("🎉 All startup validations passed! Server ready to start.")
        return True

    async def validate_api_keys(self):
        """Validate all required API keys are present and properly formatted"""
        missing_keys = []
        invalid_keys = []

        # Check OpenAI API Key
        if not self.settings.openai_api_key:
            missing_keys.append("OPENAI_API_KEY")
        elif self.settings.openai_api_key == "test-openai-key":
            invalid_keys.append("OPENAI_API_KEY (using placeholder value)")
        elif not self.settings.openai_api_key.startswith(("sk-", "sk-proj-")):
            invalid_keys.append("OPENAI_API_KEY (invalid format)")

        # Check LangGraph API Key (standardized to LANGGRAPH_API_KEY)
        if not self.settings.api_key:
            missing_keys.append("LANGGRAPH_API_KEY")
        elif getattr(self.settings, "api_key_placeholder_used", False):
            invalid_keys.append("LANGGRAPH_API_KEY (using default placeholder)")
        elif len(self.settings.api_key) < 32:
            invalid_keys.append("LANGGRAPH_API_KEY (too short, likely invalid)")

        # Check optional research API keys (warn but don't fail)
        optional_keys = {
            "TAVILY_API_KEY": self.settings.tavily_api_key,
            "EXA_API_KEY": self.settings.exa_api_key,
            "PERPLEXITY_API_KEY": self.settings.perplexity_api_key
        }

        missing_optional = [key for key, value in optional_keys.items() if not value]
        if missing_optional:
            logger.warning(f"⚠️  Optional research API keys missing: {', '.join(missing_optional)}")

        errors = []
        if missing_keys:
            errors.append(f"Missing required API keys: {', '.join(missing_keys)}")
        if invalid_keys:
            errors.append(f"Invalid API keys: {', '.join(invalid_keys)}")

        if errors:
            raise StartupValidationError("; ".join(errors))

    async def validate_webhook_connectivity(self):
        """Test webhook connectivity with Convex backend"""
        if not self.settings.webhook_url:
            raise StartupValidationError("Webhook URL not configured")

        if not self.settings.convex_url:
            raise StartupValidationError("Convex URL not configured")

        # Test webhook with a minimal smoke test payload
        test_payload = {
            "request_id": "startup_validation_test",
            "status": "test"
        }

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.settings.api_key}",
            "User-Agent": "langgraph-worker/startup-validation"
        }

        try:
            timeout = aiohttp.ClientTimeout(total=10)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(
                    self.settings.webhook_url,
                    json=test_payload,
                    headers=headers
                ) as response:
                    response_text = await response.text()

                    if response.status == 401:
                        raise StartupValidationError(
                            f"Webhook authentication failed (401). Check LANGGRAPH_API_KEY configuration. "
                            f"Ensure the key matches between worker and Convex backend. "
                            f"Response: {response_text[:200]}"
                        )
                    elif response.status == 404:
                        raise StartupValidationError(
                            f"Webhook endpoint not found (404). URL: {self.settings.webhook_url}"
                        )
                    elif response.status >= 500:
                        raise StartupValidationError(
                            f"Webhook server error ({response.status}). Response: {response_text}"
                        )
                    elif response.status == 400:
                        # 400 is expected for our test payload, but check if it's auth-related
                        if "unauthorized" in response_text.lower() or "forbidden" in response_text.lower():
                            raise StartupValidationError(
                                f"Webhook authorization failed. Response: {response_text}"
                            )
                        # Otherwise 400 is expected for invalid test payload
                        logger.info("✅ Webhook endpoint reachable (400 expected for test payload)")
                    else:
                        logger.info(f"✅ Webhook endpoint reachable (status: {response.status})")

        except aiohttp.ClientError as e:
            raise StartupValidationError(f"Webhook connectivity test failed: {str(e)}")
        except asyncio.TimeoutError:
            raise StartupValidationError(f"Webhook timeout - endpoint unreachable: {self.settings.webhook_url}")

    async def validate_openai_connection(self):
        """Test OpenAI API connectivity and model availability"""
        try:
            # Test basic OpenAI connection with a minimal request
            llm = ChatOpenAI(
                model=self.settings.default_model,
                temperature=0,
                max_tokens=min(50, self.settings.max_tokens or 50),
                openai_api_key=self.settings.openai_api_key
            )

            # Make a minimal test call
            test_response = await asyncio.to_thread(
                llm.invoke,
                "Test"
            )

            if test_response:
                logger.info(f"✅ OpenAI API working with model: {self.settings.default_model}")
            else:
                raise StartupValidationError("OpenAI API returned empty response")

        except Exception as e:
            error_msg = str(e)
            if "api_key" in error_msg.lower():
                raise StartupValidationError(f"OpenAI API key invalid: {error_msg}")
            elif "model" in error_msg.lower():
                raise StartupValidationError(f"OpenAI model '{self.settings.default_model}' unavailable: {error_msg}")
            elif "rate" in error_msg.lower():
                logger.warning(f"⚠️  OpenAI rate limit during validation (expected): {error_msg}")
                # Rate limits during startup are acceptable
            else:
                raise StartupValidationError(f"OpenAI API connection failed: {error_msg}")

    async def validate_configuration(self):
        """Validate configuration settings are reasonable"""
        issues = []

        # Check model configuration
        if not self.settings.default_model:
            issues.append("DEFAULT_MODEL is empty")

        # Check timeout settings
        if self.settings.max_execution_time < 30:
            issues.append(f"MAX_EXECUTION_TIME too low: {self.settings.max_execution_time}s (minimum: 30s)")
        elif self.settings.max_execution_time > 600:
            issues.append(f"MAX_EXECUTION_TIME very high: {self.settings.max_execution_time}s (max recommended: 600s)")

        # Check token limits
        max_tokens = self.settings.max_tokens
        if max_tokens < 100:
            issues.append(f"MAX_TOKENS too low: {max_tokens} (minimum: 100)")
        elif max_tokens > 32000:
            issues.append(f"MAX_TOKENS very high: {max_tokens} (may cause timeouts)")

        # Check temperature
        temperature = self.settings.temperature
        if temperature < 0 or temperature > 2:
            issues.append(f"TEMPERATURE out of range: {temperature} (valid: 0-2)")

        if issues:
            raise StartupValidationError(f"Configuration issues: {'; '.join(issues)}")

async def run_startup_validation() -> bool:
    """
    Run comprehensive startup validation.
    Returns True if all validations pass.
    Raises StartupValidationError if any validation fails.
    """
    validator = StartupValidator()
    return await validator.validate_all()

def validate_startup_sync() -> bool:
    """Synchronous wrapper for startup validation"""
    try:
        return asyncio.run(run_startup_validation())
    except Exception as e:
        logger.error(f"💥 Startup validation failed: {str(e)}")
        return False
