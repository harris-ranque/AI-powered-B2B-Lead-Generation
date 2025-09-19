"""
Webhook client for sending results back to the main application
"""
import asyncio
import aiohttp
import logging
from typing import Dict, Any, Optional
from datetime import datetime

from ..models.lead_models import WebhookPayload, EmailGenerationResult

logger = logging.getLogger(__name__)

class WebhookClient:
    """Client for sending webhook notifications"""

    def __init__(self, webhook_url: str, api_key: Optional[str] = None, timeout: int = 30):
        self.webhook_url = webhook_url
        self.api_key = api_key
        self.timeout = timeout

        # Log webhook client initialization for debugging
        logger.info(
            f"WebhookClient initialized: "
            f"url={webhook_url}, "
            f"has_api_key={bool(api_key)}, "
            f"timeout={timeout}s"
        )
        
    async def send_result(
        self,
        request_id: str,
        status: str,
        result: Optional[EmailGenerationResult] = None,
        error: Optional[str] = None,
        quality_score: Optional[float] = None,
        approved: Optional[bool] = None,
        retries: int = 3
    ) -> bool:
        """Send processing result via webhook"""
        
        if not self.webhook_url:
            raise RuntimeError("LangGraph webhook URL not configured")
            
        # Prepare result payload robustly (handle dict or Pydantic model)
        result_payload = None
        if result is not None:
            try:
                # Pydantic v2 models
                result_payload = result.model_dump()  # type: ignore[attr-defined]
            except Exception:
                # If it's already a dict or not a pydantic model
                if isinstance(result, dict):  # type: ignore[arg-type]
                    result_payload = result  # type: ignore[assignment]
                else:
                    try:
                        # Pydantic v1 compatibility
                        result_payload = result.dict()  # type: ignore[attr-defined]
                    except Exception:
                        result_payload = None

        payload = {
            "request_id": request_id,
            "status": status,
            "timestamp": datetime.utcnow().isoformat(),
            "result": result_payload,
            "error": error,
            "quality_score": quality_score,
            "approved": approved
        }
        
        # Prepare headers
        headers = {"Content-Type": "application/json", "User-Agent": "langgraph-worker/2.0"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        
        for attempt in range(retries + 1):
            try:
                logger.info(f"Sending webhook (attempt {attempt + 1}/{retries + 1}) to {self.webhook_url[:50]}...")

                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=self.timeout)) as session:
                    async with session.post(
                        self.webhook_url,
                        json=payload,
                        headers=headers
                    ) as response:
                        response_text = await response.text()

                        if response.status == 200:
                            logger.info(f"Webhook sent successfully for request {request_id}")
                            return True
                        elif response.status in [401, 403]:
                            logger.error(
                                f"Webhook authentication failed for {request_id}: "
                                f"status={response.status}, url={self.webhook_url}, "
                                f"response={response_text[:500]}, "
                                f"headers_sent={list(headers.keys())}"
                            )
                            raise RuntimeError(
                                f"Webhook authentication failed with status {response.status}: {response_text}"
                            )
                        elif response.status == 400:
                            # Enhanced 400 error logging with full context
                            logger.error(
                                f"Webhook validation failed for {request_id}: "
                                f"status=400, url={self.webhook_url}, "
                                f"payload_keys={list(payload.keys())}, "
                                f"payload_size={len(str(payload))}, "
                                f"response={response_text[:500]}"
                            )

                            # Check if this is a retryable 400 error based on response
                            try:
                                error_data = await response.json()
                                if error_data.get("retryable", False):
                                    logger.warning(f"Webhook failed with retryable 400: {error_data.get('message', 'Unknown error')}")
                                else:
                                    message = error_data.get("message", "Unknown error")
                                    logger.error(
                                        f"Webhook failed with non-retryable 400: {message}"
                                    )
                                    raise RuntimeError(
                                        f"Webhook rejected payload: {message}"
                                    )
                            except Exception as parse_error:
                                # If we can't parse the response, don't retry 400s
                                logger.error(
                                    f"Failed to parse 400 response for {request_id}: "
                                    f"parse_error={parse_error}, raw_response={response_text[:1000]}"
                                )
                                raise RuntimeError(
                                    f"Webhook validation failed with status 400: {response_text}"
                                )
                        else:
                            # 500+ errors are retryable - log with full context
                            logger.warning(
                                f"Webhook server error for {request_id}: "
                                f"status={response.status}, url={self.webhook_url}, "
                                f"response={response_text[:500]}, attempt={attempt + 1}"
                            )

            except asyncio.TimeoutError:
                logger.warning(
                    f"Webhook timeout for {request_id}: "
                    f"timeout={self.timeout}s, url={self.webhook_url}, attempt={attempt + 1}"
                )
            except Exception as e:
                logger.error(
                    f"Webhook connection error for {request_id}: "
                    f"error={str(e)}, error_type={type(e).__name__}, "
                    f"url={self.webhook_url}, attempt={attempt + 1}"
                )
            
            if attempt < retries:
                # Enhanced exponential backoff with jitter
                import random
                base_wait = 2 ** attempt
                jitter = base_wait * 0.1 * (2 * random.random() - 1)  # Add jitter
                wait_time = max(base_wait + jitter, 0.5)  # Minimum 0.5s wait
                logger.info(f"Retrying webhook in {wait_time:.1f} seconds...")
                await asyncio.sleep(wait_time)
        
        logger.error(
            f"Failed to send webhook after {retries + 1} attempts for request {request_id}"
        )
        raise RuntimeError(
            f"Unable to deliver webhook for request {request_id} after retries"
        )
    
    async def send_analysis_result(
        self,
        request_id: str,
        lead_id: str,
        status: str,
        analysis: Optional[Dict[str, Any]] = None,
        error: Optional[str] = None,
        processing_time: Optional[float] = None,
        retries: int = 3
    ) -> bool:
        """Send lead analysis result via webhook"""

        if not self.webhook_url:
            raise RuntimeError("LangGraph webhook URL not configured")

        # Construct analysis webhook URL - handle both auto-constructed and explicit URLs
        if "/webhooks/langgraph/email-completed" in self.webhook_url:
            analysis_webhook_url = self.webhook_url.replace(
                "/webhooks/langgraph/email-completed",
                "/webhooks/langgraph/analysis-completed"
            )
        else:
            # For base webhook URLs, append the analysis endpoint
            base_url = self.webhook_url.rstrip('/')
            analysis_webhook_url = f"{base_url}/webhooks/langgraph/analysis-completed"
            
        payload = {
            "request_id": request_id,
            "lead_id": lead_id,
            "status": status,
            "timestamp": datetime.utcnow().isoformat(),
            "analysis": analysis,
            "error": error,
            "processing_time": processing_time
        }
        
        # Prepare headers
        headers = {"Content-Type": "application/json", "User-Agent": "langgraph-worker/2.0"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        
        for attempt in range(retries + 1):
            try:
                logger.info(
                    f"Sending analysis webhook (attempt {attempt + 1}/{retries + 1}) to {analysis_webhook_url[:50]}... "
                    f"for lead_id={lead_id}, request_id={request_id}"
                )

                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=self.timeout)) as session:
                    async with session.post(
                        analysis_webhook_url,
                        json=payload,
                        headers=headers
                    ) as response:
                        response_text = await response.text()

                        if response.status == 200:
                            logger.info(
                                f"Analysis webhook sent successfully for request {request_id}, lead {lead_id}"
                            )
                            return True
                        elif response.status in [401, 403]:
                            logger.error(
                                f"Analysis webhook authentication failed for {request_id}: "
                                f"status={response.status}, url={analysis_webhook_url}, "
                                f"response={response_text[:500]}, "
                                f"headers_sent={list(headers.keys())}"
                            )
                            raise RuntimeError(
                                f"Analysis webhook authentication failed with status {response.status}: {response_text}"
                            )
                        elif response.status == 400:
                            logger.error(
                                f"Analysis webhook validation failed for {request_id}: "
                                f"status=400, url={analysis_webhook_url}, "
                                f"lead_id={lead_id}, "
                                f"payload_keys={list(payload.keys())}, "
                                f"payload_size={len(str(payload))}, "
                                f"response={response_text[:500]}"
                            )
                            raise RuntimeError(
                                f"Analysis webhook validation failed: {response_text}"
                            )
                        else:
                            logger.warning(
                                f"Analysis webhook server error for {request_id}: "
                                f"status={response.status}, url={analysis_webhook_url}, "
                                f"lead_id={lead_id}, "
                                f"response={response_text[:500]}, attempt={attempt + 1}"
                            )

            except asyncio.TimeoutError:
                logger.warning(
                    f"Analysis webhook timeout for {request_id}: "
                    f"timeout={self.timeout}s, url={analysis_webhook_url}, "
                    f"lead_id={lead_id}, attempt={attempt + 1}"
                )
            except Exception as e:
                logger.error(
                    f"Analysis webhook connection error for {request_id}: "
                    f"error={str(e)}, error_type={type(e).__name__}, "
                    f"url={analysis_webhook_url}, lead_id={lead_id}, attempt={attempt + 1}"
                )
            
            if attempt < retries:
                # Exponential backoff
                wait_time = 2 ** attempt
                logger.info(f"Retrying analysis webhook in {wait_time} seconds...")
                await asyncio.sleep(wait_time)
        
        logger.error(
            f"Failed to send analysis webhook after {retries + 1} attempts for request {request_id}"
        )
        raise RuntimeError(
            f"Unable to deliver analysis webhook for request {request_id} after retries"
        )
    
    async def send_status_update(
        self,
        request_id: str,
        status: str,
        message: str,
        progress: Optional[float] = None
    ) -> bool:
        """Send intermediate status update"""
        
        if not self.webhook_url:
            raise RuntimeError("LangGraph webhook URL not configured")
            
        payload = {
            "request_id": request_id,
            "status": status,
            "message": message,
            "progress": progress,
            "timestamp": datetime.utcnow().isoformat(),
            "type": "status_update"
        }
        
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:
                async with session.post(
                    f"{self.webhook_url}/status",
                    json=payload,
                    headers={"Content-Type": "application/json", "User-Agent": "langgraph-worker/2.0"}
                ) as response:
                    if response.status == 200:
                        return True

                    error_text = await response.text()
                    raise RuntimeError(
                        f"Status update webhook failed with status {response.status}: {error_text}"
                    )

        except Exception as e:
            logger.warning(f"Status update webhook failed: {str(e)}")
            raise
