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
        
    async def send_result(
        self,
        request_id: str,
        status: str,
        result: Optional[EmailGenerationResult] = None,
        error: Optional[str] = None,
        retries: int = 3
    ) -> bool:
        """Send processing result via webhook"""
        
        if not self.webhook_url:
            logger.warning("No webhook URL configured, skipping notification")
            return False
            
        payload = {
            "request_id": request_id,
            "status": status,
            "timestamp": datetime.utcnow().isoformat(),
            "result": result.model_dump() if result else None,
            "error": error
        }
        
        # Prepare headers
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        
        for attempt in range(retries + 1):
            try:
                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=self.timeout)) as session:
                    async with session.post(
                        self.webhook_url,
                        json=payload,
                        headers=headers
                    ) as response:
                        if response.status == 200:
                            logger.info(f"Webhook sent successfully for request {request_id}")
                            return True
                        elif response.status in [401, 403, 400]:
                            # Don't retry auth/validation errors
                            logger.error(f"Webhook failed with non-retryable status {response.status}")
                            return False
                        else:
                            logger.warning(f"Webhook failed with status {response.status}")
                            
            except asyncio.TimeoutError:
                logger.warning(f"Webhook timeout for request {request_id} (attempt {attempt + 1})")
            except Exception as e:
                logger.error(f"Webhook error for request {request_id}: {str(e)} (attempt {attempt + 1})")
            
            if attempt < retries:
                # Enhanced exponential backoff with jitter
                import random
                base_wait = 2 ** attempt
                jitter = base_wait * 0.1 * (2 * random.random() - 1)  # Add jitter
                wait_time = max(base_wait + jitter, 0.5)  # Minimum 0.5s wait
                logger.info(f"Retrying webhook in {wait_time:.1f} seconds...")
                await asyncio.sleep(wait_time)
        
        logger.error(f"Failed to send webhook after {retries + 1} attempts for request {request_id}")
        return False
    
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
            logger.warning("No webhook URL configured, skipping analysis notification")
            return False
        
        # Construct analysis webhook URL
        analysis_webhook_url = self.webhook_url.replace(
            "/webhooks/langgraph/email-completed", 
            "/webhooks/langgraph/analysis-completed"
        )
            
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
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        
        for attempt in range(retries + 1):
            try:
                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=self.timeout)) as session:
                    async with session.post(
                        analysis_webhook_url,
                        json=payload,
                        headers=headers
                    ) as response:
                        if response.status == 200:
                            logger.info(f"Analysis webhook sent successfully for request {request_id}")
                            return True
                        else:
                            logger.warning(f"Analysis webhook failed with status {response.status}")
                            
            except asyncio.TimeoutError:
                logger.warning(f"Analysis webhook timeout for request {request_id} (attempt {attempt + 1})")
            except Exception as e:
                logger.error(f"Analysis webhook error for request {request_id}: {str(e)} (attempt {attempt + 1})")
            
            if attempt < retries:
                # Exponential backoff
                wait_time = 2 ** attempt
                logger.info(f"Retrying analysis webhook in {wait_time} seconds...")
                await asyncio.sleep(wait_time)
        
        logger.error(f"Failed to send analysis webhook after {retries + 1} attempts for request {request_id}")
        return False
    
    async def send_status_update(
        self,
        request_id: str,
        status: str,
        message: str,
        progress: Optional[float] = None
    ) -> bool:
        """Send intermediate status update"""
        
        if not self.webhook_url:
            return False
            
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
                    headers={"Content-Type": "application/json"}
                ) as response:
                    return response.status == 200
                    
        except Exception as e:
            logger.warning(f"Status update webhook failed: {str(e)}")
            return False