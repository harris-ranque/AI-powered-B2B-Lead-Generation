"""
Genni LangGraph Worker Service
FastAPI application with LangGraph multi-agent AI system for email personalization
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
from .langgraph.state import EmailGenerationState
from .langgraph.workflow import create_email_generation_workflow, execute_email_generation, execute_with_streaming
from .utils.config import get_settings
from .utils.webhook import WebhookClient
from .utils.performance import single_replica_optimizer
from .utils.logger import setup_logger, log_request_details, log_response_details, log_error_details

# Configure logging
logger = setup_logger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Genni LangGraph Worker",
    description="AI-powered email personalization service using LangGraph multi-agent system",
    version="2.0.0",
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
    logger.info("GENNI LANGGRAPH WORKER STARTING UP")
    logger.info(f"Environment: {os.getenv('ENVIRONMENT', 'production')}")
    logger.info(f"OpenAI API Key configured: {'Yes' if settings.openai_api_key else 'No'}")
    logger.info(f"Convex URL: {settings.convex_url}")
    logger.info(f"Webhook URL: {settings.webhook_url} {'(auto-calculated)' if settings.convex_url and not os.getenv('WEBHOOK_URL') else '(explicit)'}")
    logger.debug(f"API Key configured: {'Yes' if settings.api_key else 'No'}")
    
    # Start the background processor
    asyncio.create_task(single_replica_optimizer.background_processor())
    logger.info("Background processor started successfully")
    logger.info("LangGraph workflow system initialized")
    logger.info("=" * 60)

@app.get("/")
async def root():
    """Health check endpoint"""
    logger.debug("Root endpoint accessed")
    response = {
        "service": "Genni LangGraph Worker",
        "status": "active",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "2.0.0",
        "workflow_engine": "LangGraph"
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
            "langgraph": "initialized",
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
    Generate personalized email using LangGraph multi-agent system
    
    This endpoint processes a lead through our 5-agent system:
    1. Relevance Analyzer - Determines lead relevance and fit
    2. Pain Point Researcher - Identifies customer challenges  
    3. Value Matcher - Aligns solutions to problems
    4. Email Writer - Crafts personalized emails
    5. Follow-up Strategist - Plans email sequences
    """
    start_time = datetime.utcnow()
    
    try:
        logger.info(f"[LangGraph] Processing email generation for lead: {request.lead.company_name}")
        log_request_details(logger, request.dict(), "/generate-email")
        
        # Check system capacity
        optimizer_status = single_replica_optimizer.get_status()
        if optimizer_status["memory"]["percent"] > 90:
            raise HTTPException(
                status_code=503, 
                detail="System at capacity. Please try again in a few minutes."
            )
        
        # Execute LangGraph workflow
        result = await execute_email_generation(
            lead=request.lead,
            business_profile=request.business_profile,
            requirements=request.requirements,
            request_id=request.request_id
        )
        
        if result["status"] == "completed":
            # Send success webhook
            result_dict = result["result"].dict() if result["result"] else {}
            await webhook_client.send_result(
                request_id=request.request_id,
                status="completed",
                result=result_dict
            )
            
            response = EmailGenerationResponse(
                request_id=request.request_id,
                status="completed",
                message="Email generation completed successfully via LangGraph",
                result=result["result"]
            )
        else:
            # Send error webhook
            await webhook_client.send_result(
                request_id=request.request_id,
                status="error",
                error=result.get("error", "Unknown error")
            )
            
            response = EmailGenerationResponse(
                request_id=request.request_id,
                status="error",
                message=f"Email generation failed: {result.get('error', 'Unknown error')}",
                error=result.get("error")
            )
        
        duration = (datetime.utcnow() - start_time).total_seconds()
        log_response_details(logger, response.dict(), duration)
        
        return response
        
    except Exception as e:
        log_error_details(logger, e, {
            "request_id": request.request_id,
            "lead_company": request.lead.company_name,
            "duration": (datetime.utcnow() - start_time).total_seconds()
        })
        raise HTTPException(status_code=500, detail=f"Email generation failed: {str(e)}")

@app.post("/analyze-lead")
async def analyze_lead(
    lead: Lead,
    authenticated: bool = Depends(verify_api_key)
):
    """Quick lead analysis using relevance analyzer node only"""
    start_time = datetime.utcnow()
    logger.info(f"[LangGraph] Analyzing lead: {lead.company_name}")
    log_request_details(logger, lead.dict(), "/analyze-lead")
    
    try:
        # Create minimal state for relevance analysis only
        from .langgraph.nodes.relevance_analyzer import relevance_analyzer_node
        from .models.lead_models import BusinessProfile, EmailRequirements
        
        # Create minimal business profile for analysis
        minimal_profile = BusinessProfile(
            company_name="Genni",
            industry="Business Services",
            value_proposition="AI-powered lead generation and personalization",
            services=["Lead Generation", "Email Personalization", "Sales Automation"],
            target_markets=["B2B", "SaaS", "Professional Services"],
            key_differentiators=["AI-powered", "Multi-agent system", "Personalized outreach"],
            contact_info={"email": "contact@genni.com"}
        )
        
        # Create minimal state
        state = {
            "request_id": f"analysis_{lead.id}",
            "lead": lead,
            "business_profile": minimal_profile,
            "requirements": EmailRequirements(call_to_action="Schedule a call"),
            "agent_results": [],
            "processing_times": {},
            "confidence_scores": {}
        }
        
        # Run relevance analysis
        result = await relevance_analyzer_node(state)
        
        duration = (datetime.utcnow() - start_time).total_seconds()
        logger.info(f"Lead analysis completed in {duration:.2f}s")
        
        relevance_analysis = result.get("relevance_analysis", {})
        
        response = {
            "lead_id": lead.id,
            "relevance_score": result.get("relevance_score", 0),
            "qualification_level": relevance_analysis.get("qualification_level", "Unknown"),
            "fit_assessment": relevance_analysis.get("fit_assessment", ""),
            "key_factors": relevance_analysis.get("key_factors", []),
            "opportunities": relevance_analysis.get("opportunities", []),
            "red_flags": relevance_analysis.get("red_flags", []),
            "processing_time": duration
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
        "workflow_engine": "LangGraph",
        "orchestration": "Supervisor-based routing with conditional logic",
        "agents": [
            {
                "name": "Relevance Analyzer",
                "role": "Determines lead relevance and fit",
                "specialization": "Lead qualification and scoring",
                "output": "Structured relevance analysis with confidence scoring"
            },
            {
                "name": "Pain Point Researcher", 
                "role": "Identifies customer challenges",
                "specialization": "Problem identification and analysis",
                "output": "Categorized pain points with severity assessment"
            },
            {
                "name": "Value Matcher",
                "role": "Aligns solutions to problems", 
                "specialization": "Solution-problem mapping",
                "output": "Value propositions with quantified benefits"
            },
            {
                "name": "Email Writer",
                "role": "Crafts personalized emails",
                "specialization": "Content creation and personalization",
                "output": "Complete email with personalization notes"
            },
            {
                "name": "Follow-up Strategist",
                "role": "Plans email sequences",
                "specialization": "Sequence planning and optimization",
                "output": "Multi-touch strategy with timing and content themes"
            },
            {
                "name": "Supervisor",
                "role": "Orchestrates workflow and routing",
                "specialization": "Dynamic agent coordination",
                "output": "Routing decisions and workflow management"
            },
            {
                "name": "Result Aggregator",
                "role": "Compiles final results",
                "specialization": "Result synthesis and recommendations",
                "output": "Comprehensive EmailGenerationResult"
            }
        ],
        "features": [
            "Supervisor-based orchestration",
            "Conditional routing logic",
            "State persistence capability",
            "Streaming execution support",
            "Quality gates and validation",
            "Structured outputs with confidence scoring",
            "Error handling and recovery"
        ]
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

@app.get("/workflow-engine")
async def get_workflow_engine(authenticated: bool = Depends(verify_api_key)):
    """Get information about the current workflow engine"""
    logger.debug("Workflow engine info requested")
    
    engine_info = {
        "name": "LangGraph",
        "version": "2.0.0",
        "endpoint": "/generate-email",
        "status": "active",
        "description": "LangGraph-based supervisor orchestration system",
        "features": [
            "Supervisor-based routing",
            "State persistence capability",
            "Streaming execution support",
            "Better observability",
            "Conditional routing logic",
            "Quality gates and validation",
            "Structured outputs with confidence scoring",
            "Error handling and recovery"
        ],
        "migration_status": "completed",
        "previous_engine": "CrewAI (removed)"
    }
    
    return engine_info

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)