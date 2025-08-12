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
from .utils.performance import single_replica_optimizer, memory_monitor
from .utils.logger import setup_logger, log_request_details, log_response_details, log_error_details

# Configure logging
logger = setup_logger(__name__)

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
    logger.debug("Verifying API key")
    if credentials.credentials != settings.api_key:
        logger.warning("Invalid API key attempted")
        raise HTTPException(status_code=401, detail="Invalid API key")
    logger.debug("API key verified successfully")
    return True

# Initialize webhook client
webhook_client = WebhookClient(settings.webhook_url)

@app.on_event("startup")
async def startup_event():
    """Initialize background services on startup"""
    logger.info("=" * 60)
    logger.info("GENNI CREWAI WORKER STARTING UP")
    logger.info(f"Environment: {os.getenv('ENVIRONMENT', 'production')}")
    logger.info(f"OpenAI API Key configured: {'Yes' if settings.openai_api_key else 'No'}")
    logger.info(f"Webhook URL: {settings.webhook_url}")
    logger.debug(f"API Key configured: {'Yes' if settings.api_key else 'No'}")
    
    # Start the background processor
    asyncio.create_task(single_replica_optimizer.background_processor())
    logger.info("Background processor started successfully")
    logger.info("=" * 60)

@app.get("/")
async def root():
    """Health check endpoint"""
    logger.debug("Root endpoint accessed")
    response = {
        "service": "Genni CrewAI Worker",
        "status": "active",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0"
    }
    logger.debug(f"Root response: {response}")
    return response

@app.get("/health")
async def health_check():
    """Health check with detailed status"""
    logger.debug("Health check requested")
    optimizer_status = single_replica_optimizer.get_status()
    logger.debug(f"Optimizer status: {optimizer_status}")
    
    health_response = {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "services": {
            "fastapi": "running",
            "crewai": "initialized",
            "openai": "connected" if settings.openai_api_key else "not configured"
        },
        "performance": {
            "active_tasks": optimizer_status["active_tasks"],
            "queue_size": optimizer_status["queue_size"],
            "memory_usage_mb": round(optimizer_status["memory"]["rss"] / 1024 / 1024, 1),
            "memory_percent": round(optimizer_status["memory"]["percent"], 1)
        }
    }
    
    logger.info(f"Health check: Memory={health_response['performance']['memory_percent']}%, Queue={health_response['performance']['queue_size']}, Active={health_response['performance']['active_tasks']}")
    return health_response

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
    start_time = datetime.utcnow()
    
    try:
        logger.info(f"Processing email generation request for lead: {request.lead.company_name}")
        log_request_details(logger, request.dict(), "/generate-email")
        
        # Check system capacity
        optimizer_status = single_replica_optimizer.get_status()
        logger.debug(f"System status: {optimizer_status}")
        
        if optimizer_status["memory"]["percent"] > 90:
            raise HTTPException(
                status_code=503, 
                detail="System at capacity. Please try again in a few minutes."
            )
        
        # Queue the task for optimized processing
        task_data = {
            "id": request.request_id,
            "type": "email_generation",
            "request": request.dict(),
            "webhook_url": settings.webhook_url
        }
        
        queue_result = await single_replica_optimizer.process_with_queue(task_data)
        logger.debug(f"Queue result: {queue_result}")
        
        response = EmailGenerationResponse(
            request_id=request.request_id,
            status="queued",
            message=f"Email generation queued. {queue_result['message']} Queue size: {queue_result['queue_size']}"
        )
        
        duration = (datetime.utcnow() - start_time).total_seconds()
        log_response_details(logger, response.dict(), duration)
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        log_error_details(logger, e, {
            "request_id": request.request_id,
            "lead_company": request.lead.company_name,
            "duration": (datetime.utcnow() - start_time).total_seconds()
        })
        raise HTTPException(status_code=500, detail=f"Email generation failed: {str(e)}")

@memory_monitor
async def process_email_generation(
    crew: EmailPersonalizationCrew,
    request: EmailGenerationRequest,
    webhook_client: WebhookClient
):
    """Background task to process email generation with memory monitoring"""
    start_time = datetime.utcnow()
    logger.info(f"Starting email generation for request: {request.request_id}")
    logger.debug(f"Lead: {request.lead.company_name}, Industry: {request.lead.business_type}")
    
    try:
        logger.debug("Initializing CrewAI workflow")
        # Execute the CrewAI workflow
        result = await crew.execute_async(
            lead=request.lead,
            business_profile=request.business_profile,
            requirements=request.requirements
        )
        
        duration = (datetime.utcnow() - start_time).total_seconds()
        logger.info(f"CrewAI workflow completed in {duration:.2f}s")
        log_response_details(logger, result, duration)
        
        # Send success webhook
        logger.debug(f"Sending success webhook to: {webhook_client.webhook_url}")
        await webhook_client.send_result(
            request_id=request.request_id,
            status="completed",
            result=result
        )
        
        logger.info(f"✅ Email generation completed successfully for request: {request.request_id}")
        
    except Exception as e:
        duration = (datetime.utcnow() - start_time).total_seconds()
        log_error_details(logger, e, {
            "request_id": request.request_id,
            "lead": request.lead.company_name,
            "duration": duration
        })
        
        # Send error webhook
        logger.debug(f"Sending error webhook for request: {request.request_id}")
        await webhook_client.send_result(
            request_id=request.request_id,
            status="error",
            error=str(e)
        )

@app.post("/analyze-lead")
@memory_monitor
async def analyze_lead(
    lead: Lead,
    authenticated: bool = Depends(verify_api_key)
):
    """Quick lead analysis without full email generation"""
    start_time = datetime.utcnow()
    logger.info(f"Analyzing lead: {lead.company_name}")
    log_request_details(logger, lead.dict(), "/analyze-lead")
    
    try:
        logger.debug("Initializing EmailPersonalizationCrew for analysis")
        crew = EmailPersonalizationCrew()
        
        logger.debug("Starting lead analysis")
        analysis = await crew.analyze_lead_only(lead)
        
        duration = (datetime.utcnow() - start_time).total_seconds()
        logger.info(f"Lead analysis completed in {duration:.2f}s")
        logger.debug(f"Analysis results: relevance_score={analysis.get('relevance_score', 0)}")
        
        response = {
            "lead_id": lead.id,
            "relevance_score": analysis.get("relevance_score", 0),
            "pain_points": analysis.get("pain_points", []),
            "fit_assessment": analysis.get("fit_assessment", ""),
            "recommended_approach": analysis.get("recommended_approach", "")
        }
        
        log_response_details(logger, response, duration)
        return response
        
    except Exception as e:
        duration = (datetime.utcnow() - start_time).total_seconds()
        log_error_details(logger, e, {
            "lead_id": lead.id,
            "lead_company": lead.company_name,
            "duration": duration
        })
        raise HTTPException(status_code=500, detail=f"Lead analysis failed: {str(e)}")

@app.get("/status/{request_id}")
async def get_request_status(
    request_id: str,
    authenticated: bool = Depends(verify_api_key)
):
    """Get the status of a processing request"""
    logger.info(f"Status check for request: {request_id}")
    
    # In a production environment, this would check a database or cache
    # For now, return a simple response
    response = {
        "request_id": request_id,
        "status": "processing",
        "message": "Request status tracking not yet implemented"
    }
    
    logger.debug(f"Status response for {request_id}: {response}")
    return response

@app.get("/agents/info")
async def get_agents_info(authenticated: bool = Depends(verify_api_key)):
    """Get information about available agents"""
    logger.debug("Agents info requested")
    
    agents_info = {
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
    
    logger.debug(f"Returning info for {len(agents_info['agents'])} agents")
    return agents_info

@app.get("/performance")
async def get_performance_metrics(authenticated: bool = Depends(verify_api_key)):
    """Get detailed performance metrics"""
    logger.info("Performance metrics requested")
    metrics = single_replica_optimizer.get_status()
    
    logger.debug(f"Performance: Memory={metrics['memory']['percent']:.1f}%, Queue={metrics['queue_size']}, Active={metrics['active_tasks']}")
    return metrics

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)