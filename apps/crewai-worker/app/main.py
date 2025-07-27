"""
Genni CrewAI Worker Service
FastAPI application with multi-agent AI system for email personalization
"""
from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import os
import logging
from datetime import datetime
import asyncio
import json

from .models.lead_models import Lead, EmailGenerationRequest, EmailGenerationResponse
from .crews.email_crew import EmailPersonalizationCrew
from .utils.config import get_settings
from .utils.webhook import WebhookClient

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Genni CrewAI Worker",
    description="AI-powered email personalization service using CrewAI multi-agent system",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure based on environment
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security
security = HTTPBearer()
settings = get_settings()

def verify_api_key(credentials: HTTPAuthorizationCredentials = Security(security)) -> bool:
    """Verify API key for authentication"""
    if credentials.credentials != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return True

# Initialize webhook client
webhook_client = WebhookClient(settings.webhook_url)

@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "service": "Genni CrewAI Worker",
        "status": "active",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0"
    }

@app.get("/health")
async def health_check():
    """Health check with detailed status"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "services": {
            "fastapi": "running",
            "crewai": "initialized",
            "openai": "connected" if settings.openai_api_key else "not configured"
        }
    }

@app.post("/generate-email", response_model=EmailGenerationResponse)
async def generate_email(
    request: EmailGenerationRequest,
    background_tasks: BackgroundTasks,
    authenticated: bool = Depends(verify_api_key)
):
    """
    Generate personalized email using CrewAI multi-agent system
    
    This endpoint processes a lead through our 5-agent system:
    1. Relevance Analyzer - Determines lead relevance and fit
    2. Pain Point Researcher - Identifies customer challenges  
    3. Value Matcher - Aligns solutions to problems
    4. Email Writer - Crafts personalized emails
    5. Follow-up Strategist - Plans email sequences
    """
    try:
        logger.info(f"Processing email generation request for lead: {request.lead.company_name}")
        
        # Initialize the email personalization crew
        crew = EmailPersonalizationCrew()
        
        # Start async processing
        background_tasks.add_task(
            process_email_generation,
            crew,
            request,
            webhook_client
        )
        
        return EmailGenerationResponse(
            request_id=request.request_id,
            status="processing",
            message="Email generation started. Results will be sent via webhook."
        )
        
    except Exception as e:
        logger.error(f"Error generating email: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Email generation failed: {str(e)}")

async def process_email_generation(
    crew: EmailPersonalizationCrew,
    request: EmailGenerationRequest,
    webhook_client: WebhookClient
):
    """Background task to process email generation"""
    try:
        # Execute the CrewAI workflow
        result = await crew.execute_async(
            lead=request.lead,
            business_profile=request.business_profile,
            requirements=request.requirements
        )
        
        # Send success webhook
        await webhook_client.send_result(
            request_id=request.request_id,
            status="completed",
            result=result
        )
        
        logger.info(f"Email generation completed for request: {request.request_id}")
        
    except Exception as e:
        logger.error(f"Error in background processing: {str(e)}")
        
        # Send error webhook
        await webhook_client.send_result(
            request_id=request.request_id,
            status="error",
            error=str(e)
        )

@app.post("/analyze-lead")
async def analyze_lead(
    lead: Lead,
    authenticated: bool = Depends(verify_api_key)
):
    """Quick lead analysis without full email generation"""
    try:
        crew = EmailPersonalizationCrew()
        analysis = await crew.analyze_lead_only(lead)
        
        return {
            "lead_id": lead.id,
            "relevance_score": analysis.get("relevance_score", 0),
            "pain_points": analysis.get("pain_points", []),
            "fit_assessment": analysis.get("fit_assessment", ""),
            "recommended_approach": analysis.get("recommended_approach", "")
        }
        
    except Exception as e:
        logger.error(f"Error analyzing lead: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Lead analysis failed: {str(e)}")

@app.get("/status/{request_id}")
async def get_request_status(
    request_id: str,
    authenticated: bool = Depends(verify_api_key)
):
    """Get the status of a processing request"""
    # In a production environment, this would check a database or cache
    # For now, return a simple response
    return {
        "request_id": request_id,
        "status": "processing",
        "message": "Request status tracking not yet implemented"
    }

@app.get("/agents/info")
async def get_agents_info(authenticated: bool = Depends(verify_api_key)):
    """Get information about available agents"""
    return {
        "agents": [
            {
                "name": "Relevance Analyzer",
                "role": "Determines lead relevance and fit",
                "specialization": "Lead qualification and scoring"
            },
            {
                "name": "Pain Point Researcher", 
                "role": "Identifies customer challenges",
                "specialization": "Problem identification and analysis"
            },
            {
                "name": "Value Matcher",
                "role": "Aligns solutions to problems", 
                "specialization": "Solution-problem mapping"
            },
            {
                "name": "Email Writer",
                "role": "Crafts personalized emails",
                "specialization": "Content creation and personalization"
            },
            {
                "name": "Follow-up Strategist",
                "role": "Plans email sequences",
                "specialization": "Sequence planning and optimization"
            }
        ],
        "workflow": "Sequential multi-agent collaboration with feedback loops"
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)