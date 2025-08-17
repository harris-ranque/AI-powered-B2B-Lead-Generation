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
    
    def __init__(self, webhook_url: str, timeout: int = 30):
        self.webhook_url = webhook_url
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
            
        payload = WebhookPayload(
            request_id=request_id,
            status=status,
            timestamp=datetime.utcnow(),
            result=result,
            error=error
        )
        
        for attempt in range(retries + 1):
            try:
                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=self.timeout)) as session:
                    async with session.post(
                        self.webhook_url,
                        json=payload.model_dump(),
                        headers={"Content-Type": "application/json"}
                    ) as response:
                        if response.status == 200:
                            logger.info(f"Webhook sent successfully for request {request_id}")
                            return True
                        else:
                            logger.warning(f"Webhook failed with status {response.status}")
                            
            except asyncio.TimeoutError:
                logger.warning(f"Webhook timeout for request {request_id} (attempt {attempt + 1})")
            except Exception as e:
                logger.error(f"Webhook error for request {request_id}: {str(e)} (attempt {attempt + 1})")
            
            if attempt < retries:
                # Exponential backoff
                wait_time = 2 ** attempt
                logger.info(f"Retrying webhook in {wait_time} seconds...")
                await asyncio.sleep(wait_time)
        
        logger.error(f"Failed to send webhook after {retries + 1} attempts for request {request_id}")
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