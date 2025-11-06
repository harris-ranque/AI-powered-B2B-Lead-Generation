"""
Webhook client for sending results back to the main application
"""
import asyncio
import aiohttp
import logging
import hmac
import hashlib
import json
from typing import Dict, Any, Optional
from datetime import datetime

from ..models.lead_models import WebhookPayload, EmailGenerationResult

logger = logging.getLogger(__name__)

ALLOWED_WEBHOOK_STATUSES = {"completed", "error"}

class WebhookClient:
    """Client for sending webhook notifications"""

    def __init__(self, webhook_url: str, api_key: Optional[str] = None, timeout: int = 30):
        self.webhook_url = webhook_url.rstrip("/") if webhook_url else webhook_url
        self.api_key = (api_key or "").strip()
        self.timeout = timeout

        # Log webhook client initialization for debugging
        logger.info(
            f"WebhookClient initialized: "
            f"url={webhook_url}, "
            f"has_api_key={bool(self.api_key)}, "
            f"timeout={timeout}s"
        )

        if not self.api_key:
            logger.error(
                "LangGraph webhook API key is not configured. Webhook delivery will fail until the API key is provided."
            )

    def _compute_signature(self, payload: Dict[str, Any]) -> str:
        """
        Compute HMAC-SHA256 signature for webhook payload
        This provides additional security beyond Bearer token authentication
        """
        if not self.api_key:
            raise RuntimeError("Cannot compute signature without API key")

        # Serialize payload to canonical JSON (sorted keys for consistency)
        payload_bytes = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")

        # Compute HMAC-SHA256 signature
        signature = hmac.new(
            self.api_key.encode("utf-8"),
            payload_bytes,
            hashlib.sha256,
        ).hexdigest()

        return signature

    def _prepare_headers(
        self,
        *,
        request_id: Optional[str] = None,
        extra: Optional[Dict[str, str]] = None,
    ) -> Dict[str, str]:
        """Construct standard headers for webhook requests with optional extras."""

        if not self.api_key:
            raise RuntimeError("API key not configured for webhook authentication")

        headers: Dict[str, str] = {
            "Content-Type": "application/json",
            "User-Agent": "langgraph-worker/2.0",
            "Authorization": f"Bearer {self.api_key}",
        }

        if request_id:
            headers["X-Request-ID"] = request_id

        if extra:
            headers.update(extra)

        return headers
        
    async def send_result(
        self,
        request_id: str,
        status: str,
        result: Optional[EmailGenerationResult] = None,
        error: Optional[str] = None,
        quality_score: Optional[float] = None,
        approved: Optional[bool] = None,
        retries: int = 2
    ) -> bool:
        """Send processing result via webhook"""
        
        if not self.webhook_url:
            raise RuntimeError("LangGraph webhook URL not configured")
            
        # Prepare result payload robustly (handle dict or Pydantic model)
        result_payload = None
        if result is not None:
            try:
                # Pydantic v2 models - preserve API contract via aliases
                result_payload = result.model_dump(by_alias=True)  # type: ignore[attr-defined]
            except Exception:
                # If it's already a dict or not a pydantic model
                if isinstance(result, dict):  # type: ignore[arg-type]
                    result_payload = result  # type: ignore[assignment]
                else:
                    try:
                        # Pydantic v1 compatibility
                        result_payload = result.dict(by_alias=True)  # type: ignore[attr-defined]
                    except Exception:
                        result_payload = None

        # Build payload with only non-None values (Convex v.optional doesn't accept null)
        normalized_status = status.lower()
        if normalized_status not in ALLOWED_WEBHOOK_STATUSES:
            raise ValueError(
                f"Unsupported webhook status '{status}'. Expected one of {sorted(ALLOWED_WEBHOOK_STATUSES)}"
            )

        payload = {
            "request_id": request_id,
            "status": normalized_status,
            "timestamp": datetime.utcnow().isoformat(),
        }

        # Only include optional fields if they have values
        include_result = (
            normalized_status == "completed" and result_payload is not None
        )

        if include_result and isinstance(result_payload, dict):
            if isinstance(result_payload, dict):
                # Remove request_id from result since it's already at root payload level
                result_payload_clean = {k: v for k, v in result_payload.items() if k != "request_id"}

                sequence = result_payload_clean.get("follow_up_sequence")
                follow_up_emails: list[dict[str, Any]] = []

                if isinstance(sequence, dict):
                    emails = sequence.get("emails")
                    schedule = sequence.get("timing_schedule")

                    if isinstance(emails, list):
                        for idx, email in enumerate(emails):
                            if not isinstance(email, dict):
                                continue

                            subject = email.get("subject")
                            body = email.get("body")

                            delay_days = None
                            if isinstance(schedule, list) and idx < len(schedule):
                                maybe_delay = schedule[idx]
                                if isinstance(maybe_delay, (int, float)):
                                    delay_days = int(round(maybe_delay))

                            follow_up_emails.append(
                                {
                                    "subject": subject if isinstance(subject, str) else f"Follow Up {idx + 1}",
                                    "body": body if isinstance(body, str) else "",
                                    "delay_days": delay_days if delay_days is not None else (idx + 1) * 3,
                                }
                            )

                if follow_up_emails:
                    result_payload_clean["follow_up_emails"] = follow_up_emails

            payload["result"] = result_payload_clean

        if normalized_status == "error":
            payload["error"] = error or "Unknown error"
        elif error is not None:
            logger.warning(
                "Ignoring error payload for completed webhook %s: %s",
                request_id,
                error,
            )

        if normalized_status == "completed" and quality_score is not None:
            payload["quality_score"] = quality_score
        if normalized_status == "completed" and approved is not None:
            payload["approved"] = approved

        # Compute HMAC signature for additional security and prepare headers
        signature = self._compute_signature(payload)
        headers = self._prepare_headers(
            request_id=request_id,
            extra={
                "X-Worker-Timestamp": datetime.utcnow().isoformat(),
                "X-Webhook-Signature": signature,
            },
        )
        for attempt in range(retries + 1):
            try:
                logger.info(
                    f"Sending webhook (attempt {attempt + 1}/{retries + 1}) to {self.webhook_url[:50]}... "
                    f"[signature: {signature[:8]}...]"
                )

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
        retries: int = 2
    ) -> bool:
        """Send lead analysis result via webhook"""

        if not self.webhook_url:
            raise RuntimeError("LangGraph webhook URL not configured")

        # Construct analysis webhook URL - handle both auto-constructed and explicit URLs
        base_webhook_url = self.webhook_url or ""
        if "/webhooks/langgraph/email-completed" in base_webhook_url:
            analysis_webhook_url = base_webhook_url.replace(
                "/webhooks/langgraph/email-completed",
                "/webhooks/langgraph/analysis-completed"
            )
        elif base_webhook_url.endswith("/webhooks/langgraph/analysis-completed"):
            analysis_webhook_url = base_webhook_url
        elif base_webhook_url.endswith("/webhooks/langgraph"):
            analysis_webhook_url = f"{base_webhook_url}/analysis-completed"
        else:
            # For base webhook URLs, append the full analysis endpoint
            base_url = base_webhook_url.rstrip('/')
            analysis_webhook_url = f"{base_url}/webhooks/langgraph/analysis-completed"
            
        normalized_status = status.lower()
        if normalized_status not in ALLOWED_WEBHOOK_STATUSES:
            raise ValueError(
                f"Unsupported webhook status '{status}'. Expected one of {sorted(ALLOWED_WEBHOOK_STATUSES)}"
            )

        payload = {
            "request_id": request_id,
            "lead_id": lead_id,
            "status": normalized_status,
            "timestamp": datetime.utcnow().isoformat(),
        }

        if normalized_status == "completed" and analysis is not None:
            payload["analysis"] = analysis
        if normalized_status == "error":
            payload["error"] = error or "Analysis failed"
        elif error is not None:
            logger.warning(
                "Ignoring error payload for completed analysis webhook %s: %s",
                request_id,
                error,
            )
        if processing_time is not None:
            payload["processing_time"] = processing_time

        signature = self._compute_signature(payload)
        headers = self._prepare_headers(
            request_id=request_id,
            extra={
                "X-Lead-ID": lead_id,
                "X-Worker-Timestamp": datetime.utcnow().isoformat(),
                "X-Webhook-Signature": signature,
            },
        )
        for attempt in range(retries + 1):
            try:
                logger.info(
                    f"Sending analysis webhook (attempt {attempt + 1}/{retries + 1}) to {analysis_webhook_url[:50]}... "
                    f"for lead_id={lead_id}, request_id={request_id} [signature: {signature[:8]}...]"
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
                    headers=self._prepare_headers(request_id=request_id)
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

    async def send_batch_progress(
        self,
        batch_id: str,
        search_id: str,
        progress_percent: float,
        completed_count: int,
        total_count: int,
        success_count: int,
        failure_count: int,
        current_lead: Optional[str] = None,
        estimated_time_remaining: Optional[float] = None,
        retries: int = 2
    ) -> bool:
        """
        Send batch progress update webhook (sent every 3 leads)

        Args:
            batch_id: Unique batch identifier
            search_id: Search ID for tracking
            progress_percent: Progress percentage (0-100)
            completed_count: Number of leads completed
            total_count: Total leads in batch
            success_count: Successful completions
            failure_count: Failed completions
            current_lead: Currently processing lead name (optional)
            estimated_time_remaining: Estimated seconds remaining (optional)
            retries: Number of retry attempts
        """

        if not self.webhook_url:
            raise RuntimeError("LangGraph webhook URL not configured")

        # Construct batch progress webhook URL
        base_url = self.webhook_url.rstrip('/')
        if "/webhooks/langgraph/email-completed" in base_url:
            batch_webhook_url = base_url.replace(
                "/webhooks/langgraph/email-completed",
                "/webhooks/langgraph/batch-progress"
            )
        else:
            batch_webhook_url = f"{base_url}/webhooks/langgraph/batch-progress"

        payload = {
            "batchId": batch_id,
            "searchId": search_id,
            "progressPercent": progress_percent,
            "completedCount": completed_count,
            "totalCount": total_count,
            "successCount": success_count,
            "failureCount": failure_count,
            "timestamp": datetime.utcnow().isoformat(),
        }

        if current_lead:
            payload["currentLead"] = current_lead
        if estimated_time_remaining is not None:
            payload["estimatedTimeRemaining"] = estimated_time_remaining

        signature = self._compute_signature(payload)
        headers = self._prepare_headers(
            request_id=batch_id,
            extra={
                "X-Search-ID": search_id,
                "X-Worker-Timestamp": datetime.utcnow().isoformat(),
                "X-Webhook-Signature": signature,
            },
        )

        for attempt in range(retries + 1):
            try:
                logger.info(
                    f"Sending batch progress webhook (attempt {attempt + 1}/{retries + 1}) "
                    f"batch_id={batch_id}, progress={progress_percent:.1f}%, "
                    f"completed={completed_count}/{total_count}"
                )

                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=self.timeout)) as session:
                    async with session.post(
                        batch_webhook_url,
                        json=payload,
                        headers=headers
                    ) as response:
                        response_text = await response.text()

                        if response.status == 200:
                            logger.info(
                                f"Batch progress webhook sent successfully for batch {batch_id}"
                            )
                            return True
                        elif response.status in [401, 403]:
                            logger.error(
                                f"Batch progress webhook authentication failed: "
                                f"status={response.status}, batch_id={batch_id}"
                            )
                            raise RuntimeError(
                                f"Batch webhook authentication failed: {response_text}"
                            )
                        else:
                            logger.warning(
                                f"Batch progress webhook error: "
                                f"status={response.status}, batch_id={batch_id}, attempt={attempt + 1}"
                            )

            except asyncio.TimeoutError:
                logger.warning(
                    f"Batch progress webhook timeout: batch_id={batch_id}, attempt={attempt + 1}"
                )
            except Exception as e:
                logger.error(
                    f"Batch progress webhook error: {type(e).__name__}: {str(e)}, "
                    f"batch_id={batch_id}, attempt={attempt + 1}"
                )

            if attempt < retries:
                wait_time = 2 ** attempt
                logger.info(f"Retrying batch progress webhook in {wait_time} seconds...")
                await asyncio.sleep(wait_time)

        # Non-critical webhook - log warning but don't raise
        logger.warning(
            f"Failed to send batch progress webhook after {retries + 1} attempts for batch {batch_id}"
        )
        return False

    async def send_batch_completion(
        self,
        batch_id: str,
        search_id: str,
        status: str,
        results: list[Dict[str, Any]],
        summary: Dict[str, Any],
        total_processing_time: float,
        retries: int = 2
    ) -> bool:
        """
        Send batch completion webhook with all lead results

        Args:
            batch_id: Unique batch identifier
            search_id: Search ID for tracking
            status: Overall batch status (completed/partial/failed)
            results: List of individual lead results
            summary: Batch processing summary statistics
            total_processing_time: Total batch processing time in seconds
            retries: Number of retry attempts
        """

        if not self.webhook_url:
            raise RuntimeError("LangGraph webhook URL not configured")

        # Construct batch completion webhook URL
        base_url = self.webhook_url.rstrip('/')
        if "/webhooks/langgraph/email-completed" in base_url:
            batch_webhook_url = base_url.replace(
                "/webhooks/langgraph/email-completed",
                "/webhooks/langgraph/batch-completed"
            )
        else:
            batch_webhook_url = f"{base_url}/webhooks/langgraph/batch-completed"

        payload = {
            "batchId": batch_id,
            "searchId": search_id,
            "status": status,
            "results": results,
            "summary": summary,
            "totalProcessingTime": total_processing_time,
            "timestamp": datetime.utcnow().isoformat(),
        }

        signature = self._compute_signature(payload)
        headers = self._prepare_headers(
            request_id=batch_id,
            extra={
                "X-Search-ID": search_id,
                "X-Worker-Timestamp": datetime.utcnow().isoformat(),
                "X-Webhook-Signature": signature,
            },
        )

        for attempt in range(retries + 1):
            try:
                logger.info(
                    f"Sending batch completion webhook (attempt {attempt + 1}/{retries + 1}) "
                    f"batch_id={batch_id}, status={status}, "
                    f"results_count={len(results)}"
                )

                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=self.timeout)) as session:
                    async with session.post(
                        batch_webhook_url,
                        json=payload,
                        headers=headers
                    ) as response:
                        response_text = await response.text()

                        if response.status == 200:
                            logger.info(
                                f"Batch completion webhook sent successfully for batch {batch_id}"
                            )
                            return True
                        elif response.status in [401, 403]:
                            logger.error(
                                f"Batch completion webhook authentication failed: "
                                f"status={response.status}, batch_id={batch_id}"
                            )
                            raise RuntimeError(
                                f"Batch webhook authentication failed: {response_text}"
                            )
                        elif response.status == 400:
                            logger.error(
                                f"Batch completion webhook validation failed: "
                                f"batch_id={batch_id}, response={response_text[:500]}"
                            )
                            raise RuntimeError(
                                f"Batch webhook validation failed: {response_text}"
                            )
                        else:
                            logger.warning(
                                f"Batch completion webhook error: "
                                f"status={response.status}, batch_id={batch_id}, attempt={attempt + 1}"
                            )

            except asyncio.TimeoutError:
                logger.warning(
                    f"Batch completion webhook timeout: batch_id={batch_id}, attempt={attempt + 1}"
                )
            except Exception as e:
                logger.error(
                    f"Batch completion webhook error: {type(e).__name__}: {str(e)}, "
                    f"batch_id={batch_id}, attempt={attempt + 1}"
                )

            if attempt < retries:
                wait_time = 2 ** attempt
                logger.info(f"Retrying batch completion webhook in {wait_time} seconds...")
                await asyncio.sleep(wait_time)

        logger.error(
            f"Failed to send batch completion webhook after {retries + 1} attempts for batch {batch_id}"
        )
        raise RuntimeError(
            f"Unable to deliver batch completion webhook for batch {batch_id} after retries"
        )
