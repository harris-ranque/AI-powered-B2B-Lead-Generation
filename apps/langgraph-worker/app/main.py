"""
Genni LangGraph Worker Service
FastAPI application with LangGraph multi-agent AI system for email personalization
"""
import os
import logging
from datetime import datetime
import asyncio
import json
import time
from typing import List, Dict, Any, Optional, Set

# Initialize Sentry SDK before other imports
import sentry_sdk
from .utils.config import get_settings, validate_optional_settings

# Get settings first to configure Sentry
settings = get_settings()
try:
    validate_optional_settings()
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

from .models.lead_models import (
    Lead,
    EmailGenerationRequest,
    EmailGenerationResponse,
    ProviderKeyValidationRequest,
    ProviderKeyValidationResponse,
    LeadAnalysisRequest,
    CompanyResearchRequest,
    CompanyResearchResponse,
    BatchEmailGenerationRequest,
    BatchEmailGenerationResponse,
    BatchLeadResult,
)
from .models.people_discovery_models import (
    DiscoverPeopleRequest,
    DiscoverPeopleResponse,
)
from .langgraph.state import EmailGenerationState
from .langgraph.workflow import create_email_generation_workflow, execute_email_generation, execute_with_streaming
from .utils.webhook import WebhookClient
from .utils.performance import single_replica_optimizer
from .utils.concurrent_handler import concurrent_handler
from .utils.logger import setup_logger, log_request_details, log_response_details, log_error_details
from .utils.key_validation import validate_user_key
from .utils.analytics import capture_event, capture_error
from .utils.rate_limiting import get_rate_limit_manager, shutdown_rate_limiting

# Configure logging
logger = setup_logger(__name__)

# ============================================================
# GRACEFUL SHUTDOWN TRACKING
# ============================================================
# Track active batch processing tasks for graceful shutdown
# Railway sends SIGTERM → we have drainSeconds (120s) before SIGKILL
# Note: We rely on FastAPI's shutdown event (triggered by gunicorn) rather than
# direct signal handlers to avoid conflicts with gunicorn's multi-worker setup
active_batch_tasks: Set[str] = set()  # batch_id -> task tracking
active_batch_tasks_lock = asyncio.Lock()
shutdown_initiated = False

# Maximum time to wait for in-flight requests during shutdown
# Leave 10s buffer before Railway's SIGKILL at 120s
GRACEFUL_SHUTDOWN_TIMEOUT = 110

# ============================================================

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

    # Initialize adaptive rate limiting system
    logger.info("🔒 Initializing adaptive rate limiting system...")
    rate_limit_manager = await get_rate_limit_manager()
    logger.info(f"✅ Rate limiting initialized: {rate_limit_manager.get_stats()}")
    
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
        if getattr(settings, "api_key_placeholder_used", False):
            validation_errors.append("Convex API key is using a placeholder value")
        elif not settings.api_key:
            validation_errors.append("Convex API key not configured")
        if not settings.webhook_url:
            validation_errors.append("Webhook URL not configured")

        if validation_errors:
            validation_status = "failed"

    except Exception as e:
        validation_status = "error"
        validation_errors.append(str(e))

    # Determine overall health status (shutdown takes priority)
    if shutdown_initiated:
        overall_status = "draining"  # Signals to load balancer to stop sending traffic
    elif validation_status == "passed":
        overall_status = "healthy"
    else:
        overall_status = "degraded"

    health_response = {
        "status": overall_status,
        "timestamp": datetime.utcnow().isoformat(),
        "shutdown": {
            "initiated": shutdown_initiated,
            "active_batches": len(active_batch_tasks),
            "drain_timeout_seconds": GRACEFUL_SHUTDOWN_TIMEOUT if shutdown_initiated else None
        },
        "validation": {
            "status": validation_status,
            "errors": validation_errors
        },
        "services": {
            "fastapi": "running" if not shutdown_initiated else "draining",
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


@app.post("/validate-key", response_model=ProviderKeyValidationResponse)
async def validate_key_endpoint(
    request: ProviderKeyValidationRequest,
    authenticated: bool = Depends(verify_api_key)
):
    """Validate provider API keys for BYOK flows."""

    logger.info("Validating provider key", extra={"provider": request.provider})
    result = await validate_user_key(request.provider, request.key)
    return ProviderKeyValidationResponse(**result)


@app.get("/stats")
async def get_stats():
    """Get concurrent handler and system statistics"""
    logger.debug("Stats endpoint accessed")
    stats = concurrent_handler.get_stats()

    return {
        "service": "Genni LangGraph Worker",
        "version": "2.0.0",
        "timestamp": datetime.utcnow().isoformat(),
        "concurrent_handler": stats,
        "configuration": {
            "max_concurrent": concurrent_handler.max_concurrent,
            "rate_limit_per_client": "60 requests/minute",
            "burst_size": 20,
            "max_queue_size": concurrent_handler.max_queue_size,
        },
        "recommendations": {
            "current_capacity": f"{stats['active_requests']}/{stats['max_concurrent']}",
            "recommended_max_concurrent": stats['max_safe_concurrent'],
            "status": "healthy" if stats['active_requests'] < stats['max_concurrent'] * 0.8 else "at_capacity",
        },
    }

@app.get("/stats/client/{client_id}")
async def get_client_stats(client_id: str):
    """Get rate limit stats for a specific client/search"""
    logger.debug(f"Client stats requested for: {client_id}")
    stats = concurrent_handler.get_client_stats(client_id)

    return {
        "client_id": client_id,
        "rate_limit": stats,
        "timestamp": datetime.utcnow().isoformat(),
    }

@app.post("/cleanup-clients")
async def cleanup_inactive_clients(inactive_hours: int = 1):
    """
    Clean up inactive clients from rate limiter to prevent memory leaks

    Args:
        inactive_hours: Remove clients inactive for this many hours (default: 1)

    Returns:
        Number of clients removed and cleanup stats
    """
    logger.info(f"Manual client cleanup triggered: inactive_hours={inactive_hours}")

    removed_count = await concurrent_handler.cleanup_inactive_clients(inactive_hours)
    current_stats = concurrent_handler.get_stats()

    return {
        "status": "success",
        "removed_clients": removed_count,
        "remaining_clients": current_stats["tracked_clients"],
        "inactive_hours": inactive_hours,
        "timestamp": datetime.utcnow().isoformat(),
    }

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

    Multi-client architecture with:
    - Concurrent handling for 500+ requests
    - Per-client rate limiting (60 req/min)
    - Adaptive resource management
    - Graceful degradation under load

    Agent pipeline:
    1. Business Intelligence Agent - Comprehensive research (Tavily→Perplexity)
    2. Email Generation Agent - Personalized email writing
    3. Quality Assurance Agent - Validation and quality enforcement

    Benefits: 57% fewer LLM calls, 50% faster execution, better personalization
    """
    # Reject new requests during shutdown
    if shutdown_initiated:
        logger.warning(f"[Email] ⛔ Rejecting request {request.request_id} - service is shutting down")
        raise HTTPException(
            status_code=503,
            detail="Service is shutting down. Please retry with a different replica."
        )

    start_time = datetime.utcnow()

    # Extract client ID from request (use search ID as client identifier)
    # Format: searchId_leadId_attempt
    client_id = request.request_id.split("_")[0] if "_" in request.request_id else "unknown"
    provider_keys_payload = (
        request.provider_keys.model_dump(exclude_none=True)
        if request.provider_keys
        else None
    )
    analytics_context = {
        "request_id": request.request_id,
        "client_id": client_id,
        "lead_id": getattr(request.lead, "id", None),
        "company_name": request.lead.company_name,
        "user_id": request.user_id,
        "using_user_keys": provider_keys_payload is not None,
        "provider_keys_supplied": sorted(provider_keys_payload.keys()) if provider_keys_payload else [],
    }
    capture_event("api_generate_email_started", analytics_context)

    # Define the actual processing function
    async def process_email_generation():
        try:
            # Add Sentry context for this request
            sentry_sdk.set_context("email_generation", {
                "request_id": request.request_id,
                "client_id": client_id,
                "lead_company": request.lead.company_name,
                "lead_id": request.lead.id,
                "business_profile": request.business_profile.company_name if request.business_profile else "Unknown"
            })

            logger.info(f"[LangGraph] Processing email generation for lead: {request.lead.company_name} (client: {client_id})")
            log_request_details(
                logger,
                request.model_dump(exclude={"provider_keys"}, exclude_none=True),
                "/generate-email",
            )

            # Execute LangGraph workflow
            result = await execute_email_generation(
                lead=request.lead,
                business_profile=request.business_profile,
                requirements=request.requirements,
                request_id=request.request_id,
                provider_keys=provider_keys_payload,
                user_id=request.user_id,
            )

            return result

        except Exception as e:
            logger.error(f"Error in process_email_generation: {e}")
            return {
                "status": "error",
                "error": str(e),
            }

    try:
        # Process with concurrent handler (includes rate limiting and resource management)
        result = await concurrent_handler.process_request(
            request_id=request.request_id,
            client_id=client_id,
            process_fn=process_email_generation,
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
            capture_event(
                "api_generate_email_completed",
                {
                    **analytics_context,
                    "duration_ms": duration * 1000,
                    "quality_score": result.get("quality_score", 0),
                    "approved": result.get("approved", False),
                },
            )

            # Send webhook in background (non-blocking) - don't hold up HTTP response
            # TODO: Add exponential backoff retry for webhook delivery failures
            # Current fire-and-forget pattern can cause silent data loss if webhook fails.
            # Implement: 3 retries with exponential backoff (1s, 2s, 4s), log failures
            # for monitoring, consider dead letter queue for persistent failures.
            # See: https://github.com/user/repo/issues/XXX
            result_obj = result["result"]
            background_tasks.add_task(
                webhook_client.send_result,
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
            # Send error webhook in background (non-blocking)
            background_tasks.add_task(
                webhook_client.send_result,
                request_id=request.request_id,
                status="error",
                error=result.get("error", "Unknown error")
            )
            capture_event(
                "api_generate_email_failed",
                {
                    **analytics_context,
                    "error": result.get("error", "Unknown error"),
                },
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

        # Send error webhook in background (fire-and-forget, don't block exception handling)
        asyncio.create_task(
            webhook_client.send_result(
                request_id=request.request_id,
                status="error",
                error=str(e),
            )
        )

        log_error_details(logger, e, {
            "request_id": request.request_id,
            "lead_company": request.lead.company_name,
            "duration": duration
        })
        capture_error(
            "api_generate_email_unhandled",
            e,
            {
                **analytics_context,
                "duration_ms": duration * 1000,
            },
        )
        raise HTTPException(status_code=500, detail=f"Email generation failed: {str(e)}")

@app.post("/analyze-lead")
async def analyze_lead(
    analysis_request: LeadAnalysisRequest,
    request: Request,
    authenticated: bool = Depends(verify_api_key)
):
    """Quick lead analysis using relevance analyzer node only"""
    start_time = datetime.utcnow()

    request_id_header = request.headers.get("X-Request-ID")
    lead = analysis_request.lead
    request_id = request_id_header or f"analysis_{lead.id}"
    provider_keys_payload = (
        analysis_request.provider_keys.model_dump(exclude_none=True)
        if analysis_request.provider_keys
        else None
    )
    analysis_analytics_context = {
        "request_id": request_id,
        "lead_id": lead.id,
        "company_name": lead.company_name,
        "user_id": analysis_request.user_id,
        "using_user_keys": provider_keys_payload is not None,
        "provider_keys_supplied": sorted(provider_keys_payload.keys()) if provider_keys_payload else [],
    }
    capture_event("api_analyze_lead_started", analysis_analytics_context)
    
    # Add Sentry context for this analysis request
    sentry_sdk.set_context("lead_analysis", {
        "lead_id": lead.id,
        "lead_company": lead.company_name,
        "endpoint": "/analyze-lead",
        "request_id": request_id,
        "user_id": analysis_request.user_id,
    })
    
    logger.info(f"[LangGraph] Analyzing lead: {lead.company_name}")
    log_request_details(
        logger,
        analysis_request.model_dump(exclude={"provider_keys"}, exclude_none=True),
        "/analyze-lead",
    )
    
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
            contact_info={
                "name": "Alex Rivera",
                "email": "contact@genni.com",
            }
        )
        
        # Create minimal state
        state = {
            "request_id": request_id,
            "lead": lead,
            "business_profile": minimal_profile,
            "requirements": EmailRequirements(call_to_action="Schedule a call"),
            "agent_results": [],
            "processing_times": {},
            "confidence_scores": {},
            "provider_keys": provider_keys_payload,
            "user_id": analysis_request.user_id,
        }
        
        # Run relevance analysis
        result = await relevance_analyzer_node(state)
        
        duration = (datetime.utcnow() - start_time).total_seconds()
        logger.info(f"Lead analysis completed in {duration:.2f}s")
        capture_event(
            "api_analyze_lead_completed",
            {
                **analysis_analytics_context,
                "duration_ms": duration * 1000,
                "relevance_score": result.get("relevance_score", 0),
            },
        )
        
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
        capture_error(
            "api_analyze_lead_unhandled",
            e,
            {
                **analysis_analytics_context,
                "duration_ms": duration * 1000,
            },
        )
        raise HTTPException(status_code=500, detail=f"Lead analysis failed: {str(e)}")

@app.post("/research-company", response_model=CompanyResearchResponse)
async def research_company(
    request: CompanyResearchRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """
    Run company-level research once and return a normalized cache payload.

    Used before per-contact analysis so Tavily/Perplexity research is not repeated
  for every accepted contact at the same company.
    """
    start_time = datetime.utcnow()

    provider_keys_payload = (
        request.provider_keys.model_dump(exclude_none=True)
        if request.provider_keys
        else None
    )

    capture_event(
        "api_research_company_started",
        {
            "company_name": request.company_name,
            "domain": request.domain,
            "user_id": request.user_id,
            "user_tier": request.user_tier,
            "using_user_keys": provider_keys_payload is not None,
        },
    )

    try:
        from .utils.research_clients import (
            ClientRegistry,
            ResearchOrchestrator,
            ResearchTier,
        )
        from .config import CREDIT_COSTS

        registry = ClientRegistry.get_instance()
        orchestrator = ResearchOrchestrator(client_registry=registry)

        research_result = await orchestrator.research_company(
            company_name=request.company_name,
            domain=request.domain,
            location=request.location or "",
            user_tier=request.user_tier,
            lead_value=0.0,
            provider_keys=provider_keys_payload,
            user_id=request.user_id,
        )

        deep_research_used = research_result.tier == ResearchTier.PERPLEXITY
        additional_credits_used = (
            CREDIT_COSTS["DEEP_RESEARCH"] if deep_research_used else 0
        )

        raw_data = {
            "company_overview": research_result.company_overview,
            "services_products": research_result.services_products,
            "industry_insights": research_result.industry_insights,
            "competitors": research_result.competitors,
            "annual_revenue": research_result.annual_revenue,
            "employee_count": research_result.employee_count,
            "leadership_names": research_result.leadership_names,
            "recent_news": research_result.recent_news,
            "funding_investments": research_result.funding_investments,
            "research_metadata": research_result.raw_data,
        }

        research_payload = {
            "company_overview": research_result.company_overview or "",
            "raw_data": raw_data,
            "confidence_score": research_result.confidence_score,
            "research_tier": research_result.tier.value,
            "data_points": research_result.data_points,
            "sources_analyzed": research_result.sources_analyzed,
            "escalation_reason": research_result.escalation_reason,
            "deep_research_used": deep_research_used,
            "deep_research_reason": research_result.escalation_reason,
        }

        duration = (datetime.utcnow() - start_time).total_seconds()
        capture_event(
            "api_research_company_completed",
            {
                "company_name": request.company_name,
                "domain": request.domain,
                "user_id": request.user_id,
                "duration_ms": duration * 1000,
                "deep_research_used": deep_research_used,
                "research_tier": research_result.tier.value,
            },
        )

        return CompanyResearchResponse(
            research_payload=research_payload,
            deep_research_used=deep_research_used,
            deep_research_reason=research_result.escalation_reason,
            additional_credits_used=additional_credits_used,
            processing_time=duration,
        )
    except Exception as e:
        logger.error(f"Company research failed for {request.company_name}: {e}")
        capture_error(e, {
            "company_name": request.company_name,
            "domain": request.domain,
            "user_id": request.user_id,
        })
        raise HTTPException(
            status_code=500,
            detail=f"Company research failed: {str(e)}",
        )

@app.post("/discover-people", response_model=DiscoverPeopleResponse)
async def discover_people(
    request: DiscoverPeopleRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """
    Identify decision makers at a company before email lookup.
    Runs website scrape (team/about pages) and Perplexity in parallel,
    merges and deduplicates results for FindyMail name search.
    """
    start_time = datetime.utcnow()

    provider_keys_payload = (
        request.provider_keys.model_dump(exclude_none=True)
        if request.provider_keys
        else None
    )

    capture_event(
        "api_discover_people_started",
        {
            "company_name": request.company_name,
            "domain": request.domain,
            "user_id": request.user_id,
            "requested_roles": request.requested_roles,
        },
    )

    try:
        from .utils.people_discovery import discover_people_at_company

        result = await discover_people_at_company(
            company_name=request.company_name,
            domain=request.domain,
            location=request.location or "",
            industry=request.industry or "",
            requested_roles=request.requested_roles,
            provider_keys=provider_keys_payload,
        )

        duration = (datetime.utcnow() - start_time).total_seconds()
        logger.info(
            "discover-people completed %s (%s): %d people in %.1fs tier=%s",
            request.company_name,
            request.domain,
            len(result.people),
            duration,
            result.research_tier,
        )

        if result.research_tier == "error":
            capture_error(
                Exception(result.raw_data.get("error", "people_discovery_error") if result.raw_data else "people_discovery_error"),
                {
                    "company_name": request.company_name,
                    "domain": request.domain,
                    "user_id": request.user_id,
                    "research_tier": result.research_tier,
                },
            )
        else:
            capture_event(
                "api_discover_people_completed",
                {
                    "company_name": request.company_name,
                    "domain": request.domain,
                    "user_id": request.user_id,
                    "people_found": len(result.people),
                    "duration_ms": duration * 1000,
                },
            )

        return DiscoverPeopleResponse(
            people=result.people,
            company_overview=result.company_overview or "",
            processing_time=duration,
            research_tier=result.research_tier,
            additional_credits_used=result.additional_credits_used,
            raw_data=result.raw_data,
        )
    except Exception as e:
        duration = (datetime.utcnow() - start_time).total_seconds()
        logger.exception(
            "People discovery endpoint failed for %s (%s): %s",
            request.company_name,
            request.domain,
            e,
        )
        capture_error(e, {
            "company_name": request.company_name,
            "domain": request.domain,
            "user_id": request.user_id,
        })
        return DiscoverPeopleResponse(
            people=[],
            company_overview="",
            processing_time=duration,
            research_tier="error",
            additional_credits_used=0,
            raw_data={
                "error": str(e),
                "error_type": type(e).__name__,
            },
        )

@app.post("/batch-generate-emails", response_model=BatchEmailGenerationResponse)
async def batch_generate_emails(
    request: BatchEmailGenerationRequest,
    background_tasks: BackgroundTasks,
    authenticated: bool = Depends(verify_api_key)
):
    """
    Generate personalized emails for a batch of leads (up to 200)

    Processing strategy:
    - Concurrent processing (configurable 1-100, default 20)
    - Semaphore-based concurrency control for resource management
    - Tolerant error handling (continues on failures)
    - Progress webhooks every 3 completions
    - Final completion webhook with all results

    Parameters:
    - max_concurrent: Number of leads to process simultaneously (1-100)
      * Conservative: 5-10 for stability
      * Balanced: 20 (default) for optimal throughput
      * Aggressive: 50-100 for maximum speed

    Benefits:
    - 1 HTTP request instead of 200+
    - 95%+ faster processing with high concurrency
    - Predictable progress updates
    - Efficient resource utilization with controlled parallelism

    Performance examples @ 90s per lead:
    - 200 leads sequential: 5 hours
    - 200 leads @ 20x: ~15 minutes (95% faster)
    - 200 leads @ 50x: ~6 minutes (98% faster)
    """
    # Reject new batch requests during shutdown
    if shutdown_initiated:
        logger.warning(f"[Batch] ⛔ Rejecting batch {request.batch_id} - service is shutting down")
        raise HTTPException(
            status_code=503,
            detail="Service is shutting down. Please retry with a different replica."
        )

    start_time = datetime.utcnow()

    logger.info(
        f"[Batch] Starting batch processing: batch_id={request.batch_id}, "
        f"leads={len(request.leads)}, search_id={request.search_id}"
    )

    # Validate batch size
    if len(request.leads) > 200:
        raise HTTPException(status_code=400, detail="Maximum batch size is 200 leads")
    if len(request.leads) == 0:
        raise HTTPException(status_code=400, detail="Batch cannot be empty")

    # Validate max_concurrent
    if request.max_concurrent < 1 or request.max_concurrent > 100:
        raise HTTPException(status_code=400, detail="max_concurrent must be between 1 and 100")

    # Add Sentry context
    sentry_sdk.set_context("batch_processing", {
        "batch_id": request.batch_id,
        "search_id": request.search_id,
        "batch_size": len(request.leads),
        "user_id": request.user_id,
        "max_concurrent": request.max_concurrent
    })

    capture_event("api_batch_started", {
        "batch_id": request.batch_id,
        "search_id": request.search_id,
        "batch_size": len(request.leads),
        "user_id": request.user_id,
    })

    # Process batch in background
    background_tasks.add_task(
        process_batch_with_progress,
        batch_id=request.batch_id,
        search_id=request.search_id,
        user_id=request.user_id,
        leads=request.leads,
        business_profile=request.business_profile,
        requirements=request.requirements,
        provider_keys=request.provider_keys,
        max_concurrent=request.max_concurrent,
    )

    return BatchEmailGenerationResponse(
        batch_id=request.batch_id,
        status="processing",
        results=[],
        summary={
            "total": len(request.leads),
            "completed": 0,
            "success": 0,
            "failed": 0,
            "message": "Batch processing started, webhooks will be sent as each lead completes"
        },
        total_processing_time=0
    )


async def process_batch_with_progress(
    batch_id: str,
    search_id: str,
    user_id: str,
    leads: list[Lead],
    business_profile: Any,
    requirements: Any,
    provider_keys: Optional[Any] = None,
    max_concurrent: int = 20,
):
    """
    Process a batch of leads with concurrent processing and progress updates

    Strategy:
    - Concurrent processing with configurable max_concurrent (default: 20)
    - Semaphore-based concurrency control for resource management
    - Progress webhook every 3 completions (or at end)
    - Final completion webhook with all results
    - Tolerant error handling (continues on failures)
    - Graceful shutdown support: tracks in-flight batches for Railway SIGTERM handling

    Performance examples @ 90s per lead:
    - Sequential (1x): 200 leads = 5 hours
    - 10x concurrent: 200 leads = 30 minutes (90% faster)
    - 20x concurrent: 200 leads = 15 minutes (95% faster)
    - 50x concurrent: 200 leads = 6 minutes (98% faster)
    """
    global shutdown_initiated

    # Track this batch for graceful shutdown
    async with active_batch_tasks_lock:
        active_batch_tasks.add(batch_id)
        logger.info(f"[Batch] 📝 Tracking batch {batch_id} for graceful shutdown (active: {len(active_batch_tasks)})")

    batch_start = time.time()
    results: list[BatchLeadResult] = []
    completed_count = 0
    success_count = 0
    failure_count = 0

    # Concurrency control using request parameter (1-100 range)
    semaphore = asyncio.Semaphore(max_concurrent)

    # Thread-safe result tracking
    results_lock = asyncio.Lock()
    progress_lock = asyncio.Lock()

    # Global circuit breaker for quota exhaustion
    quota_exhausted = False
    quota_lock = asyncio.Lock()

    logger.info(
        f"[Batch] Processing {len(leads)} leads with {max_concurrent}x concurrency for batch {batch_id}"
    )

    # Prepare provider keys payload
    provider_keys_payload = (
        provider_keys.model_dump(exclude_none=True)
        if provider_keys
        else None
    )

    async def process_single_lead(lead: Lead, lead_index: int) -> None:
        """Process a single lead with semaphore control"""
        nonlocal completed_count, success_count, failure_count, quota_exhausted

        async with semaphore:
            # Circuit breaker: Skip if quota exhausted
            async with quota_lock:
                if quota_exhausted:
                    logger.warning(
                        f"[Batch] ⛔ Skipping lead {lead_index+1}/{len(leads)}: {lead.company_name} - Quota exhausted (excluded from export)"
                    )
                    async with results_lock:
                        # Do NOT add quota-exhausted leads to results (excluded from CSV export)
                        failure_count += 1
                    async with progress_lock:
                        completed_count += 1
                    return

            lead_start = time.time()
            lead_id = getattr(lead, "lead_id", None) or lead.id or f"lead_{lead_index}"
            contact_id = getattr(lead, "contact_id", None)

            try:
                logger.info(
                    f"[Batch] 🚀 Starting lead {lead_index+1}/{len(leads)}: {lead.company_name} (batch: {batch_id})"
                )

                try:
                    await webhook_client.send_batch_progress(
                        batch_id=batch_id,
                        search_id=search_id,
                        progress_percent=(completed_count / len(leads)) * 100,
                        completed_count=completed_count,
                        total_count=len(leads),
                        success_count=success_count,
                        failure_count=failure_count,
                        current_lead=lead.company_name,
                        activity_phase="researching",
                    )
                except Exception as webhook_error:
                    logger.warning(
                        f"[Batch] Failed to send start progress webhook: {webhook_error}"
                    )

                # Execute email generation
                result = await execute_email_generation(
                    lead=lead,
                    business_profile=business_profile,
                    requirements=requirements,
                    request_id=f"{batch_id}_{lead_id}",
                    provider_keys=provider_keys_payload,
                    user_id=user_id,
                )

                lead_time = time.time() - lead_start

                async with results_lock:
                    completed_count += 1

                    if result["status"] == "completed":
                        # Validate actual success - check if email was generated
                        final_result = result.get("result", {})

                        # Check for email (can be EmailContent object or dict)
                        primary_email = final_result.get("primary_email") if isinstance(final_result, dict) else getattr(final_result, "primary_email", None)
                        has_email = primary_email is not None

                        # Check approval status from QA (strict check - must be explicitly True)
                        is_approved = result.get("approved") is True

                        # Check quality_score against tier-aware threshold
                        # B-tier leads (less public data) use 0.50; A-tier uses 0.60
                        quality_score = result.get("quality_score", 0)
                        lead_tier = result.get("lead_tier", "A")
                        tier_threshold = 0.50 if lead_tier == "B" else 0.60
                        meets_quality_threshold = quality_score >= tier_threshold

                        # Check for errors in lead_analysis (where aggregator stores them)
                        lead_analysis = final_result.get("lead_analysis") if isinstance(final_result, dict) else getattr(final_result, "lead_analysis", {})
                        has_error = bool(lead_analysis.get("error") if isinstance(lead_analysis, dict) else False)

                        if has_email and is_approved and meets_quality_threshold and not has_error:
                            # True success - email generated and approved
                            results.append(BatchLeadResult(
                                leadId=lead_id,
                                contactId=contact_id,
                                status="completed",
                                result=final_result,
                                processingTime=lead_time
                            ))
                            success_count += 1

                            logger.info(
                                f"[Batch] ✅ Lead {lead_index+1}/{len(leads)} SUCCESS: {lead.company_name} "
                                f"({lead_time:.1f}s, success: {success_count}/{completed_count})"
                            )
                        else:
                            # Workflow completed but failed to generate valid email
                            # FIXED: Include failed leads in results so webhook handler can update their status
                            # This is required for search completion to trigger properly
                            error_msg = (
                                lead_analysis.get("error") if isinstance(lead_analysis, dict)
                                else "Email generation failed or not approved"
                            )
                            # Add failed lead to results so Convex can update analysisStatus to "failed"
                            results.append(BatchLeadResult(
                                leadId=lead_id,
                                contactId=contact_id,
                                status="failed",
                                result=None,
                                error=error_msg,
                                processingTime=lead_time
                            ))
                            failure_count += 1

                            logger.warning(
                                f"[Batch] ❌ Lead {lead_index+1}/{len(leads)} FAILED: {lead.company_name} - {error_msg} "
                                f"(has_email={has_email}, approved={is_approved}, quality={quality_score:.2f}, meets_threshold={meets_quality_threshold}, has_error={has_error})"
                            )
                    else:
                        # Workflow error - include in results so Convex can track failure
                        error_msg = result.get("error", "Unknown error")
                        # Add failed lead to results so Convex can update analysisStatus to "failed"
                        results.append(BatchLeadResult(
                            leadId=lead_id,
                            contactId=contact_id,
                            status="failed",
                            result=None,
                            error=error_msg,
                            processingTime=lead_time
                        ))
                        failure_count += 1

                        logger.warning(
                            f"[Batch] ❌ Lead {lead_index+1}/{len(leads)} FAILED: {lead.company_name} - {error_msg}"
                        )

            except Exception as e:
                lead_time = time.time() - lead_start
                error_msg = str(e)

                # Detect quota exhaustion and trigger circuit breaker
                if "insufficient_quota" in error_msg.lower() or "quota" in error_msg.lower() and "429" in error_msg:
                    async with quota_lock:
                        if not quota_exhausted:
                            quota_exhausted = True
                            logger.critical(
                                f"[Batch] 🚨 QUOTA EXHAUSTED - Circuit breaker activated! "
                                f"Stopping batch after lead {lead_index+1}/{len(leads)}"
                            )

                async with results_lock:
                    completed_count += 1
                    # FIXED: Include exception failures in results so Convex can update lead status
                    # This is required for search completion to trigger properly
                    results.append(BatchLeadResult(
                        leadId=lead_id,
                        contactId=contact_id,
                        status="failed",
                        result=None,
                        error=error_msg,
                        processingTime=lead_time
                    ))
                    failure_count += 1

                logger.error(
                    f"[Batch] 💥 Lead {lead_index+1}/{len(leads)} exception: {lead.company_name} - {error_msg}"
                )

            # Send progress if needed (completed_count already updated above)
            async with progress_lock:
                # Send progress webhook every 3 completions or at the end
                if completed_count % 3 == 0 or completed_count == len(leads):
                    progress_percent = (completed_count / len(leads)) * 100

                    # Estimate time remaining
                    elapsed = time.time() - batch_start
                    avg_time_per_lead = elapsed / completed_count
                    remaining_leads = len(leads) - completed_count
                    estimated_remaining = avg_time_per_lead * remaining_leads if remaining_leads > 0 else 0

                    try:
                        await webhook_client.send_batch_progress(
                            batch_id=batch_id,
                            search_id=search_id,
                            progress_percent=progress_percent,
                            completed_count=completed_count,
                            total_count=len(leads),
                            success_count=success_count,
                            failure_count=failure_count,
                            current_lead=lead.company_name,
                            estimated_time_remaining=estimated_remaining,
                            activity_phase="completed",
                        )

                        logger.info(
                            f"[Batch] 📊 Progress update sent: {completed_count}/{len(leads)} "
                            f"({progress_percent:.1f}%), {success_count} success, {failure_count} failed, "
                            f"~{estimated_remaining:.0f}s remaining"
                        )
                    except Exception as webhook_error:
                        logger.warning(
                            f"[Batch] Failed to send progress webhook: {webhook_error}"
                        )

    # Create tasks for all leads and process concurrently
    tasks = [process_single_lead(lead, i) for i, lead in enumerate(leads)]
    await asyncio.gather(*tasks, return_exceptions=False)

    # Calculate final stats
    total_time = time.time() - batch_start
    batch_status = "completed" if failure_count == 0 else "partial" if success_count > 0 else "failed"

    # Note: results now includes both success and failed leads for proper status tracking
    # "completed" in summary means total processed (success + failure)
    summary = {
        "total": len(leads),
        "completed": len(results),  # Now includes all processed leads (success + failed)
        "success": success_count,
        "failed": failure_count,
        "success_rate": (success_count / len(leads)) * 100 if len(leads) > 0 else 0,
        "avg_time_per_lead": total_time / len(leads) if len(leads) > 0 else 0
    }

    logger.info(
        f"[Batch] ✅ Batch {batch_id} {batch_status}: "
        f"{success_count} success, {failure_count} failed, "
        f"total time: {total_time:.1f}s"
    )

    # Send final completion webhook
    try:
        # Convert results to dict format for webhook (camelCase for JavaScript backend).
        # Omit contactId when absent — Convex v.optional(v.string()) rejects null.
        results_dicts = []
        for r in results:
            entry: dict = {
                "leadId": r.lead_id,
                "status": r.status,
                "result": r.result.model_dump(by_alias=True) if r.result else None,
                "error": r.error,
                "processingTime": r.processing_time,
            }
            if r.contact_id is not None:
                entry["contactId"] = r.contact_id
            results_dicts.append(entry)

        await webhook_client.send_batch_completion(
            batch_id=batch_id,
            search_id=search_id,
            status=batch_status,
            results=results_dicts,
            summary=summary,
            total_processing_time=total_time
        )

        logger.info(
            f"[Batch] 📨 Completion webhook sent for batch {batch_id}"
        )

        capture_event("api_batch_completed", {
            "batch_id": batch_id,
            "search_id": search_id,
            "status": batch_status,
            "total": len(leads),
            "success": success_count,
            "failed": failure_count,
            "duration_ms": total_time * 1000,
        })

    except Exception as webhook_error:
        logger.error(
            f"[Batch] Failed to send completion webhook for batch {batch_id}: {webhook_error}"
        )
        capture_error("api_batch_webhook_failed", webhook_error, {
            "batch_id": batch_id,
            "search_id": search_id,
        })

    # Remove batch from graceful shutdown tracking (always runs, even on error)
    async with active_batch_tasks_lock:
        active_batch_tasks.discard(batch_id)
        logger.info(f"[Batch] ✅ Untracked batch {batch_id} from graceful shutdown (remaining: {len(active_batch_tasks)})")

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
                "specialization": "Tiered research (Tavily→Perplexity), relevance analysis, pain point identification, value matching",
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
            "tier_2": "Perplexity (8-12s) - Comprehensive research and reporting", 
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

@app.get("/health/rate-limits")
async def get_rate_limit_status(authenticated: bool = Depends(verify_api_key)):
    """
    Get current rate limiting status and statistics.

    Provides visibility into:
    - Current effective RPM per provider
    - Learned API tier from 429 responses
    - Queue depths and wait times
    - Circuit breaker status
    """
    logger.debug("Rate limit status requested")
    manager = await get_rate_limit_manager()
    stats = manager.get_stats()

    return {
        "status": "active",
        "timestamp": datetime.utcnow().isoformat(),
        "rate_limiting": stats,
        "config": {
            "enabled": True,
            "adaptive_enabled": True,
            "queue_enabled": True,
        }
    }


@app.on_event("shutdown")
async def shutdown_event():
    """
    Graceful shutdown of background services.

    Railway graceful shutdown flow:
    1. SIGTERM received → handle_sigterm() sets shutdown_initiated=True
    2. FastAPI shutdown event triggered (this function)
    3. We wait up to GRACEFUL_SHUTDOWN_TIMEOUT (110s) for active batches
    4. Railway sends SIGKILL at drainSeconds (120s) if still running

    This prevents incomplete batch processing during deployments.
    """
    global shutdown_initiated
    shutdown_initiated = True

    logger.warning("=" * 60)
    logger.warning("🛑 GRACEFUL SHUTDOWN INITIATED")
    logger.warning(f"⏳ Active batch tasks: {len(active_batch_tasks)}")
    logger.warning(f"⏳ Max wait time: {GRACEFUL_SHUTDOWN_TIMEOUT}s")
    logger.warning("=" * 60)

    # Wait for active batch tasks to complete
    if active_batch_tasks:
        start_time = time.time()
        check_interval = 2  # Check every 2 seconds

        while active_batch_tasks and (time.time() - start_time) < GRACEFUL_SHUTDOWN_TIMEOUT:
            elapsed = time.time() - start_time
            remaining = GRACEFUL_SHUTDOWN_TIMEOUT - elapsed

            async with active_batch_tasks_lock:
                batch_count = len(active_batch_tasks)
                batch_ids = list(active_batch_tasks)[:3]  # Show first 3

            logger.warning(
                f"⏳ Waiting for {batch_count} active batches... "
                f"({elapsed:.0f}s elapsed, {remaining:.0f}s remaining)"
            )
            if batch_ids:
                logger.warning(f"   Active batches: {batch_ids}")

            await asyncio.sleep(check_interval)

        # Check final status
        async with active_batch_tasks_lock:
            remaining_batches = len(active_batch_tasks)

        if remaining_batches > 0:
            elapsed = time.time() - start_time
            logger.error(
                f"⚠️ SHUTDOWN TIMEOUT: {remaining_batches} batches still running after {elapsed:.1f}s"
            )
            logger.error(f"   Remaining batches will be terminated by Railway SIGKILL")

            # Send Sentry alert for forced shutdown
            sentry_sdk.capture_message(
                f"Graceful shutdown timeout: {remaining_batches} batches terminated",
                level="error"
            )
        else:
            elapsed = time.time() - start_time
            logger.info(f"✅ All batches completed successfully in {elapsed:.1f}s")
    else:
        logger.info("✅ No active batches - proceeding with immediate shutdown")

    # Shutdown rate limiting system
    await shutdown_rate_limiting()
    logger.info("Rate limiting system shutdown complete")

    logger.warning("=" * 60)
    logger.warning("👋 LANGGRAPH WORKER SHUTDOWN COMPLETE")
    logger.warning("=" * 60)


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
