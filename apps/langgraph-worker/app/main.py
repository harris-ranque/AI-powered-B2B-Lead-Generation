"""
Genni LangGraph Worker Service
FastAPI application with LangGraph multi-agent AI system for email personalization
"""
import os
import logging
from datetime import datetime
import asyncio
import json
from typing import List, Dict, Any, Optional

# Initialize Sentry SDK before other imports
import sentry_sdk
from .utils.config import get_settings, validate_required_settings

# Get settings first to configure Sentry
settings = get_settings()
try:
    validate_required_settings()
except ValueError as config_error:
    logging.getLogger(__name__).critical(
        "LangGraph worker configuration invalid: %s",
        config_error,
    )
    raise

# Initialize Sentry if DSN is configured
if settings.sentry_dsn:
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        # Add data like request headers and IP for users
        send_default_pii=True,
        # Enable sending logs to Sentry
        enable_logs=settings.sentry_enable_logs,
        environment=settings.environment,
        # FastAPI integration will be enabled automatically
    )
    logging.getLogger(__name__).info(f"Sentry initialized for environment: {settings.environment}")

from fastapi import (
    FastAPI,
    HTTPException,
    BackgroundTasks,
    Depends,
    Security,
    Request,
)
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .models.lead_models import Lead, EmailGenerationRequest, EmailGenerationResponse
from .langgraph.state import EmailGenerationState
from .langgraph.workflow import create_email_generation_workflow, execute_email_generation, execute_with_streaming
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

def verify_api_key(credentials: HTTPAuthorizationCredentials = Security(security)) -> bool:
    """Verify API key for authentication"""
    logger.debug("Verifying API key")
    if credentials.credentials != settings.api_key:
        logger.warning("Invalid API key attempted")
        raise HTTPException(status_code=401, detail="Invalid API key")
    logger.debug("API key verified successfully")
    return True

# Initialize webhook client with enhanced logging
logger.info(f"Initializing webhook client with URL: {settings.webhook_url}")
logger.info(f"Convex URL setting: {settings.convex_url}")
logger.info(f"Environment WEBHOOK_URL: {os.getenv('WEBHOOK_URL', 'Not set')}")
logger.info(f"Environment CONVEX_URL: {os.getenv('CONVEX_URL', 'Not set')}")

webhook_client = WebhookClient(settings.webhook_url, settings.api_key)

@app.on_event("startup")
async def startup_event():
    """Initialize background services on startup with comprehensive validation"""
    from .utils.startup_validation import run_startup_validation, StartupValidationError

    logger.info("=" * 60)
    logger.info("GENNI LANGGRAPH WORKER STARTING UP")
    logger.info(f"Environment: {os.getenv('ENVIRONMENT', 'production')}")

    try:
        # Run comprehensive startup validation
        logger.info("🔍 Running startup validation...")
        await run_startup_validation()
        logger.info("✅ Startup validation completed successfully!")

        # Log configuration details after validation passes
        logger.info(f"OpenAI API Key configured: {'Yes' if settings.openai_api_key else 'No'}")
        logger.info(f"Convex URL: {settings.convex_url}")
        logger.info(f"Webhook URL: {settings.webhook_url} {'(auto-calculated)' if settings.convex_url and not os.getenv('WEBHOOK_URL') else '(explicit)'}")
        logger.info(f"Default Model: {settings.default_model}")
        logger.info(f"Sentry monitoring: {'Enabled' if settings.sentry_dsn else 'Disabled'}")
        if settings.sentry_dsn:
            logger.info(f"Sentry traces sample rate: {settings.sentry_traces_sample_rate}")
            logger.info(f"Sentry logs enabled: {settings.sentry_enable_logs}")
        logger.debug(f"API Key configured: {'Yes' if settings.api_key else 'No'}")

    except StartupValidationError as e:
        logger.error("💥 STARTUP VALIDATION FAILED!")
        logger.error(f"Error: {str(e)}")
        logger.error("❌ Server will not start. Please fix the configuration issues above.")
        # Exit with error code to fail the deployment
        import sys
        sys.exit(1)
    except Exception as e:
        logger.error(f"💥 Unexpected error during startup validation: {str(e)}")
        logger.error("❌ Server will not start due to unexpected error.")
        import sys
        sys.exit(1)

    # Start the background processor
    asyncio.create_task(single_replica_optimizer.background_processor())
    logger.info("Background processor started successfully")
    logger.info("LangGraph workflow system initialized")
    
    # Send startup event to Sentry
    if settings.sentry_dsn:
        sentry_sdk.set_context("startup", {
            "environment": settings.environment,
            "service": "langgraph-worker",
            "version": "2.0.0",
            "convex_configured": bool(settings.convex_url),
            "openai_configured": bool(settings.openai_api_key)
        })
        sentry_sdk.logger.info("LangGraph Worker service started successfully")
    
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
    """Health check with detailed status and validation results"""
    from .utils.startup_validation import StartupValidator

    logger.debug("Health check requested")
    optimizer_status = single_replica_optimizer.get_status()
    logger.debug(f"Optimizer status: {optimizer_status}")

    # Run lightweight validation check
    validator = StartupValidator()
    validation_status = "passed"
    validation_errors = []

    try:
        # Quick validation without full startup check
        if not settings.openai_api_key or settings.openai_api_key == "test-openai-key":
            validation_errors.append("OpenAI API key not configured")
        if not settings.api_key or settings.api_key == "default-secure-key-change-in-production":
            validation_errors.append("Convex API key not configured")
        if not settings.webhook_url:
            validation_errors.append("Webhook URL not configured")

        if validation_errors:
            validation_status = "failed"

    except Exception as e:
        validation_status = "error"
        validation_errors.append(str(e))

    health_response = {
        "status": "healthy" if validation_status == "passed" else "degraded",
        "timestamp": datetime.utcnow().isoformat(),
        "validation": {
            "status": validation_status,
            "errors": validation_errors
        },
        "services": {
            "fastapi": "running",
            "langgraph": "initialized",
            "openai": "connected" if settings.openai_api_key and settings.openai_api_key != "test-openai-key" else "not configured",
            "convex": "connected" if settings.webhook_url and settings.api_key else "not configured"
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

@app.get("/sentry-debug")
async def trigger_sentry_error():
    """Sentry debug endpoint to test error tracking"""
    logger.info("Sentry debug endpoint triggered - intentional error for testing")
    
    # Send some logs to Sentry first
    sentry_sdk.logger.info('Sentry test - info log message')
    sentry_sdk.logger.warning('Sentry test - warning message')
    
    # Add some context for debugging
    sentry_sdk.set_context("debug_test", {
        "endpoint": "/sentry-debug",
        "timestamp": datetime.utcnow().isoformat(),
        "service": "langgraph-worker",
        "version": "2.0.0"
    })
    
    # Trigger an intentional error
    division_by_zero = 1 / 0
    return {"message": "This should not be reached"}

@app.post("/generate-email", response_model=EmailGenerationResponse)
async def generate_email(
    request: EmailGenerationRequest,
    background_tasks: BackgroundTasks,
    authenticated: bool = Depends(verify_api_key)
):
    """
    Generate personalized email using optimized 3-agent LangGraph system
    
    This endpoint processes a lead through our streamlined 3-agent system:
    1. Business Intelligence Agent - Comprehensive research and analysis (Tavily→Exa→Perplexity)
    2. Email Generation Agent - Personalized email writing with rich context
    3. Quality Assurance Agent - Validation and quality enforcement
    
    Benefits: 57% fewer LLM calls, 50% faster execution, better personalization
    """
    start_time = datetime.utcnow()
    
    try:
        # Add Sentry context for this request
        sentry_sdk.set_context("email_generation", {
            "request_id": request.request_id,
            "lead_company": request.lead.company_name,
            "lead_id": request.lead.id,
            "business_profile": request.business_profile.company_name if request.business_profile else "Unknown"
        })
        
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
            # Add success metrics to Sentry
            duration = (datetime.utcnow() - start_time).total_seconds()
            sentry_sdk.set_context("success_metrics", {
                "processing_time": duration,
                "quality_score": result.get("quality_score", 0),
                "approved": result.get("approved", False),
                "agents_used": 3,
                "workflow_engine": "LangGraph"
            })
            
            # Send success webhook with quality metrics
            result_obj = result["result"]
            await webhook_client.send_result(
                request_id=request.request_id,
                status="completed",
                result=result_obj,
                quality_score=result.get("quality_score", 0),
                approved=result.get("approved", False)
            )
            
            # Create response with quality information
            message = f"Email generation completed via optimized 3-agent LangGraph. "
            message += f"Quality score: {result.get('quality_score', 0):.2f}. "
            message += f"Status: {'Approved' if result.get('approved') else 'Needs Review'}. "
            message += f"Processing time: {result.get('processing_time', 0):.1f}s"
            
            response = EmailGenerationResponse(
                request_id=request.request_id,
                status="completed",
                message=message,
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
        duration = (datetime.utcnow() - start_time).total_seconds()
        
        # Add additional context to Sentry for this error
        sentry_sdk.set_context("error_details", {
            "duration_seconds": duration,
            "system_memory_percent": single_replica_optimizer.get_status()["memory"]["percent"],
            "error_type": type(e).__name__,
            "error_message": str(e)
        })
        
        # Capture the exception in Sentry
        sentry_sdk.capture_exception(e)
        
        try:
            await webhook_client.send_result(
                request_id=request.request_id,
                status="error",
                error=str(e),
            )
        except Exception as webhook_error:
            logger.error(
                "Failed to send failure webhook for %s: %s",
                request.request_id,
                webhook_error,
            )

        log_error_details(logger, e, {
            "request_id": request.request_id,
            "lead_company": request.lead.company_name,
            "duration": duration
        })
        raise HTTPException(status_code=500, detail=f"Email generation failed: {str(e)}")

@app.post("/analyze-lead")
async def analyze_lead(
    lead: Lead,
    request: Request,
    authenticated: bool = Depends(verify_api_key)
):
    """Quick lead analysis using relevance analyzer node only"""
    start_time = datetime.utcnow()

    request_id_header = request.headers.get("X-Request-ID")
    request_id = request_id_header or f"analysis_{lead.id}"
    
    # Add Sentry context for this analysis request
    sentry_sdk.set_context("lead_analysis", {
        "lead_id": lead.id,
        "lead_company": lead.company_name,
        "endpoint": "/analyze-lead",
        "request_id": request_id,
    })
    
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
            "request_id": request_id,
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
        
        # Prepare analysis result for webhook
        analysis_result = {
            "relevance_score": result.get("relevance_score", 0),
            "qualification_level": relevance_analysis.get("qualification_level", "Unknown"),
            "fit_assessment": relevance_analysis.get("fit_assessment", ""),
            "key_factors": relevance_analysis.get("key_factors", []),
            "opportunities": relevance_analysis.get("opportunities", []),
            "red_flags": relevance_analysis.get("red_flags", []),
            "confidence": result.get("confidence_scores", {}).get("relevance_analyzer", 0.5),
            "pain_points": relevance_analysis.get("pain_points", []),
            "value_matches": relevance_analysis.get("value_matches", []),
            "recommended_approach": relevance_analysis.get("recommended_approach", "")
        }
        
        # Send webhook notification with debug logging
        logger.info(f"Preparing to send analysis webhook for lead {lead.id}")
        logger.debug(f"Analysis result keys: {list(analysis_result.keys())}")
        logger.debug(f"Webhook client URL: {webhook_client.webhook_url}")

        await webhook_client.send_analysis_result(
            request_id=request_id,
            lead_id=lead.id,
            status="completed",
            analysis=analysis_result,
            processing_time=duration
        )

        logger.info(f"Analysis webhook sent successfully for lead {lead.id}")
        
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
        
        # Add additional context to Sentry for this error
        sentry_sdk.set_context("analysis_error", {
            "duration_seconds": duration,
            "error_type": type(e).__name__,
            "error_message": str(e)
        })
        
        # Capture the exception in Sentry
        sentry_sdk.capture_exception(e)
        
        try:
            logger.info(f"Sending analysis error webhook for lead {lead.id}: {str(e)}")
            logger.debug(f"Error webhook URL: {webhook_client.webhook_url}")

            await webhook_client.send_analysis_result(
                request_id=request_id,
                lead_id=lead.id,
                status="error",
                error=str(e),
                processing_time=duration
            )

            logger.info(f"Analysis error webhook sent successfully for lead {lead.id}")
        except Exception as webhook_error:
            logger.error(
                "Failed to send analysis failure webhook for %s: %s, webhook_url=%s",
                lead.id,
                webhook_error,
                webhook_client.webhook_url,
            )
        
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
    """Get information about optimized 3-agent architecture"""
    logger.debug("Agents info requested")
    
    agents_info = {
        "workflow_engine": "LangGraph",
        "architecture": "Optimized 3-agent linear flow",
        "version": "3.0.0",
        "performance": {
            "llm_calls": 3,
            "execution_time": "25-30 seconds",
            "improvement": "57% fewer calls, 50% faster than previous 7-agent system"
        },
        "agents": [
            {
                "name": "Business Intelligence Agent",
                "role": "Comprehensive research and analysis consolidation",
                "specialization": "Tiered research (Tavily→Exa→Perplexity), relevance analysis, pain point identification, value matching",
                "capabilities": [
                    "3-tier research system with intelligent escalation",
                    "Real-time progress broadcasting to Convex backend",
                    "Competitor analysis and industry insights",
                    "Lead qualification and fit assessment",
                    "Pain point identification and urgency analysis",
                    "Value proposition alignment and benefit quantification"
                ],
                "output": "Comprehensive business intelligence profile with research metadata",
                "processing_time": "8-12 seconds"
            },
            {
                "name": "Email Generation Agent",
                "role": "Personalized email writing with rich business context",
                "specialization": "Context-rich email creation, follow-up sequence planning",
                "capabilities": [
                    "Deep personalization using business intelligence",
                    "Industry-specific messaging and competitive differentiation", 
                    "Multi-touch email sequence generation",
                    "Proof point integration and credibility building",
                    "Engagement optimization and conversion focus"
                ],
                "output": "Primary email and optional follow-up sequence with effectiveness scoring",
                "processing_time": "10-15 seconds"
            },
            {
                "name": "Quality Assurance Agent",
                "role": "Email validation and quality enforcement",
                "specialization": "Quality standards validation, personalization depth assessment",
                "capabilities": [
                    "Comprehensive quality scoring across multiple dimensions",
                    "Personalization depth validation and accuracy assessment",
                    "Professional communication standards enforcement",
                    "Business context integration verification",
                    "Improvement recommendations and quality gates"
                ],
                "output": "Quality assessment with approval status and improvement suggestions",
                "processing_time": "5-8 seconds"
            }
        ],
        "features": [
            "Linear workflow with direct agent-to-agent flow",
            "Integrated 3-tier business research system",
            "Real-time progress updates and quality scoring",
            "Comprehensive business intelligence integration",
            "Advanced personalization with competitive insights",
            "Quality assurance with professional standards validation",
            "Streaming execution with stage-specific progress updates",
            "Error handling with graceful degradation"
        ],
        "research_tiers": {
            "tier_1": "Tavily (2-3s) - Fast basic business context",
            "tier_2": "Exa (3-4s) - Semantic search and competitor analysis", 
            "tier_3": "Perplexity (10-15s) - Comprehensive business reports"
        }
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
    """Get information about the optimized workflow engine"""
    logger.debug("Workflow engine info requested")
    
    engine_info = {
        "name": "LangGraph",
        "version": "3.0.0",
        "architecture": "Optimized 3-agent linear flow",
        "endpoint": "/generate-email",
        "status": "active",
        "description": "Streamlined 3-agent LangGraph system with integrated business intelligence",
        "performance": {
            "agents": 3,
            "llm_calls": 3,
            "avg_execution_time": "25-30 seconds",
            "improvement_vs_previous": "57% fewer calls, 50% faster execution"
        },
        "features": [
            "Direct linear workflow (no supervisor overhead)",
            "Integrated 3-tier business research system",
            "Real-time progress broadcasting",
            "Comprehensive business intelligence integration",
            "Quality assurance with professional standards",
            "Advanced personalization with competitive insights",
            "Streaming execution with detailed progress updates",
            "Error handling with graceful degradation",
            "State persistence capability",
            "Structured outputs with quality scoring"
        ],
        "architecture_benefits": [
            "Simplified maintenance (3 vs 7 components)",
            "Better personalization (consolidated business context)",
            "Faster execution (linear flow vs complex routing)",
            "Lower costs (fewer LLM calls)",
            "Easier debugging (clear stage boundaries)"
        ],
        "migration_status": "completed",
        "migration_history": [
            "v1.0: CrewAI (removed)",
            "v2.0: 7-agent LangGraph with supervisor",
            "v3.0: Optimized 3-agent linear flow (current)"
        ]
    }
    
    return engine_info

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)
