"""
Universal Error Handling Utilities for Bulletproof LangGraph Worker
Enterprise-grade error handling, logging, and recovery for Python AI operations
"""

import logging
import traceback
import time
import asyncio
from typing import Any, Dict, Optional, Callable, TypeVar, Union, List
from enum import Enum
from dataclasses import dataclass
from datetime import datetime
from functools import wraps

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)

# Type variables
T = TypeVar('T')
F = TypeVar('F', bound=Callable[..., Any])

class ErrorSeverity(Enum):
    """Error severity levels for classification"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class ErrorCategory(Enum):
    """Error categories for systematic handling"""
    VALIDATION = "validation"
    AI_MODEL = "ai_model"
    EXTERNAL_API = "external_api"
    RATE_LIMIT = "rate_limit"
    TIMEOUT = "timeout"
    BUSINESS_LOGIC = "business_logic"
    SYSTEM = "system"
    NETWORK = "network"
    UNKNOWN = "unknown"

@dataclass
class EnhancedError:
    """Enhanced error information for comprehensive tracking"""
    category: ErrorCategory
    severity: ErrorSeverity
    message: str
    code: Optional[str] = None
    details: Dict[str, Any] = None
    timestamp: float = None
    correlation_id: Optional[str] = None
    user_id: Optional[str] = None
    function_name: Optional[str] = None
    retryable: bool = False
    stack_trace: Optional[str] = None
    
    def __post_init__(self):
        if self.timestamp is None:
            self.timestamp = time.time()
        if self.details is None:
            self.details = {}

class LangGraphError(Exception):
    """Custom exception for LangGraph worker operations"""
    
    def __init__(self, enhanced_error: EnhancedError):
        self.enhanced_error = enhanced_error
        super().__init__(enhanced_error.message)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert error to dictionary for API responses"""
        return {
            'error': True,
            'category': self.enhanced_error.category.value,
            'severity': self.enhanced_error.severity.value,
            'message': self.enhanced_error.message,
            'code': self.enhanced_error.code,
            'timestamp': self.enhanced_error.timestamp,
            'correlation_id': self.enhanced_error.correlation_id,
            'retryable': self.enhanced_error.retryable,
            'details': self.enhanced_error.details
        }

# Error codes for consistent error handling
class ErrorCodes:
    # Validation errors
    INVALID_INPUT = "INVALID_INPUT"
    MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD"
    VALIDATION_FAILED = "VALIDATION_FAILED"
    
    # AI Model errors
    MODEL_UNAVAILABLE = "MODEL_UNAVAILABLE"
    MODEL_TIMEOUT = "MODEL_TIMEOUT"
    MODEL_RATE_LIMIT = "MODEL_RATE_LIMIT"
    MODEL_QUOTA_EXCEEDED = "MODEL_QUOTA_EXCEEDED"
    PROMPT_TOO_LONG = "PROMPT_TOO_LONG"
    
    # External API errors
    EXTERNAL_API_ERROR = "EXTERNAL_API_ERROR"
    API_TIMEOUT = "API_TIMEOUT"
    API_RATE_LIMIT = "API_RATE_LIMIT"
    API_UNAUTHORIZED = "API_UNAUTHORIZED"
    
    # System errors
    INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR"
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"
    TIMEOUT = "TIMEOUT"
    NETWORK_ERROR = "NETWORK_ERROR"

def create_enhanced_error(
    category: ErrorCategory,
    message: str,
    code: Optional[str] = None,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    details: Optional[Dict[str, Any]] = None,
    correlation_id: Optional[str] = None,
    user_id: Optional[str] = None,
    function_name: Optional[str] = None,
    retryable: bool = False,
    original_error: Optional[Exception] = None
) -> EnhancedError:
    """Create an enhanced error with comprehensive tracking"""
    
    error_details = details or {}
    if original_error:
        error_details.update({
            'original_error': str(original_error),
            'original_type': type(original_error).__name__
        })
    
    enhanced_error = EnhancedError(
        category=category,
        severity=severity,
        message=message,
        code=code,
        details=error_details,
        correlation_id=correlation_id,
        user_id=user_id,
        function_name=function_name,
        retryable=retryable,
        stack_trace=traceback.format_exc() if original_error else None
    )
    
    # Log error with appropriate level
    log_level = {
        ErrorSeverity.LOW: logging.INFO,
        ErrorSeverity.MEDIUM: logging.WARNING,
        ErrorSeverity.HIGH: logging.ERROR,
        ErrorSeverity.CRITICAL: logging.CRITICAL
    }[severity]
    
    logger.log(log_level, f"[{severity.value.upper()}] {category.value} error in {function_name}: {message}", extra={
        'category': category.value,
        'code': code,
        'correlation_id': correlation_id,
        'user_id': user_id,
        'details': error_details
    })
    
    return enhanced_error

def safe_async_operation(
    category: ErrorCategory = ErrorCategory.SYSTEM,
    function_name: Optional[str] = None,
    correlation_id: Optional[str] = None,
    user_id: Optional[str] = None,
    retryable: bool = False
):
    """Decorator for safe async operation handling"""
    def decorator(func: F) -> F:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except LangGraphError:
                # Re-raise our custom errors
                raise
            except Exception as e:
                error = create_enhanced_error(
                    category=category,
                    message=f"Operation failed: {str(e)}",
                    code=ErrorCodes.INTERNAL_SERVER_ERROR,
                    severity=ErrorSeverity.HIGH,
                    function_name=function_name or func.__name__,
                    correlation_id=correlation_id,
                    user_id=user_id,
                    retryable=retryable,
                    original_error=e
                )
                raise LangGraphError(error)
        return wrapper
    return decorator

def safe_sync_operation(
    category: ErrorCategory = ErrorCategory.SYSTEM,
    function_name: Optional[str] = None,
    correlation_id: Optional[str] = None,
    user_id: Optional[str] = None,
    retryable: bool = False
):
    """Decorator for safe sync operation handling"""
    def decorator(func: F) -> F:
        @wraps(func)
        def wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except LangGraphError:
                # Re-raise our custom errors
                raise
            except Exception as e:
                error = create_enhanced_error(
                    category=category,
                    message=f"Operation failed: {str(e)}",
                    code=ErrorCodes.INTERNAL_SERVER_ERROR,
                    severity=ErrorSeverity.HIGH,
                    function_name=function_name or func.__name__,
                    correlation_id=correlation_id,
                    user_id=user_id,
                    retryable=retryable,
                    original_error=e
                )
                raise LangGraphError(error)
        return wrapper
    return decorator

async def safe_ai_model_call(
    model_call: Callable[[], Any],
    context: Dict[str, Any],
    timeout: float = 30.0,
    max_retries: int = 3
) -> Any:
    """Safe wrapper for AI model API calls with retry logic"""
    function_name = context.get('function_name', 'ai_model_call')
    correlation_id = context.get('correlation_id')
    user_id = context.get('user_id')
    
    for attempt in range(max_retries + 1):
        try:
            # Add timeout protection
            return await asyncio.wait_for(model_call(), timeout=timeout)
            
        except asyncio.TimeoutError:
            if attempt == max_retries:
                error = create_enhanced_error(
                    category=ErrorCategory.AI_MODEL,
                    message=f"AI model call timeout after {timeout}s",
                    code=ErrorCodes.MODEL_TIMEOUT,
                    severity=ErrorSeverity.HIGH,
                    function_name=function_name,
                    correlation_id=correlation_id,
                    user_id=user_id,
                    retryable=True,
                    details={'timeout': timeout, 'attempts': attempt + 1}
                )
                raise LangGraphError(error)
                
        except Exception as e:
            # Check if it's a rate limit error
            if "rate_limit" in str(e).lower() or "quota" in str(e).lower():
                if attempt == max_retries:
                    error = create_enhanced_error(
                        category=ErrorCategory.RATE_LIMIT,
                        message="AI model rate limit exceeded",
                        code=ErrorCodes.MODEL_RATE_LIMIT,
                        severity=ErrorSeverity.MEDIUM,
                        function_name=function_name,
                        correlation_id=correlation_id,
                        user_id=user_id,
                        retryable=True,
                        original_error=e,
                        details={'attempts': attempt + 1}
                    )
                    raise LangGraphError(error)
                    
                # Wait before retry for rate limits
                await asyncio.sleep(2 ** attempt)
                continue
                
            # Non-retryable error
            if attempt == max_retries:
                error = create_enhanced_error(
                    category=ErrorCategory.AI_MODEL,
                    message=f"AI model call failed: {str(e)}",
                    code=ErrorCodes.MODEL_UNAVAILABLE,
                    severity=ErrorSeverity.HIGH,
                    function_name=function_name,
                    correlation_id=correlation_id,
                    user_id=user_id,
                    retryable=False,
                    original_error=e,
                    details={'attempts': attempt + 1}
                )
                raise LangGraphError(error)
        
        # Exponential backoff for retries
        if attempt < max_retries:
            await asyncio.sleep(min(2 ** attempt, 10))

def validate_input(
    data: Any,
    validator: Callable[[Any], bool],
    field_name: str,
    context: Dict[str, Any]
) -> Any:
    """Validate input data with enhanced error handling"""
    try:
        if not validator(data):
            error = create_enhanced_error(
                category=ErrorCategory.VALIDATION,
                message=f"Invalid {field_name}",
                code=ErrorCodes.VALIDATION_FAILED,
                severity=ErrorSeverity.LOW,
                function_name=context.get('function_name'),
                correlation_id=context.get('correlation_id'),
                user_id=context.get('user_id'),
                retryable=False,
                details={
                    'field_name': field_name,
                    'received_type': type(data).__name__,
                    'received_value': str(data)[:100]  # Truncate long values
                }
            )
            raise LangGraphError(error)
        return data
    except LangGraphError:
        raise
    except Exception as e:
        error = create_enhanced_error(
            category=ErrorCategory.VALIDATION,
            message=f"Validation error for {field_name}: {str(e)}",
            code=ErrorCodes.VALIDATION_FAILED,
            severity=ErrorSeverity.MEDIUM,
            function_name=context.get('function_name'),
            correlation_id=context.get('correlation_id'),
            user_id=context.get('user_id'),
            retryable=False,
            original_error=e,
            details={'field_name': field_name}
        )
        raise LangGraphError(error)

async def safe_external_api_call(
    api_call: Callable[[], Any],
    context: Dict[str, Any],
    timeout: float = 10.0,
    max_retries: int = 2
) -> Any:
    """Safe wrapper for external API calls"""
    function_name = context.get('function_name', 'external_api_call')
    api_name = context.get('api_name', 'unknown_api')
    correlation_id = context.get('correlation_id')
    user_id = context.get('user_id')
    
    for attempt in range(max_retries + 1):
        try:
            return await asyncio.wait_for(api_call(), timeout=timeout)
            
        except asyncio.TimeoutError:
            if attempt == max_retries:
                error = create_enhanced_error(
                    category=ErrorCategory.TIMEOUT,
                    message=f"{api_name} API timeout after {timeout}s",
                    code=ErrorCodes.API_TIMEOUT,
                    severity=ErrorSeverity.MEDIUM,
                    function_name=function_name,
                    correlation_id=correlation_id,
                    user_id=user_id,
                    retryable=True,
                    details={'api_name': api_name, 'timeout': timeout, 'attempts': attempt + 1}
                )
                raise LangGraphError(error)
                
        except Exception as e:
            if attempt == max_retries:
                # Determine if retryable based on error type
                retryable = any(keyword in str(e).lower() for keyword in ['timeout', '503', '502', 'connection'])
                severity = ErrorSeverity.MEDIUM if retryable else ErrorSeverity.HIGH
                
                error = create_enhanced_error(
                    category=ErrorCategory.EXTERNAL_API,
                    message=f"{api_name} API error: {str(e)}",
                    code=ErrorCodes.EXTERNAL_API_ERROR,
                    severity=severity,
                    function_name=function_name,
                    correlation_id=correlation_id,
                    user_id=user_id,
                    retryable=retryable,
                    original_error=e,
                    details={'api_name': api_name, 'attempts': attempt + 1}
                )
                raise LangGraphError(error)
        
        # Wait before retry
        if attempt < max_retries:
            await asyncio.sleep(min(2 ** attempt, 5))

class PerformanceMonitor:
    """Performance monitoring for operations"""
    
    @staticmethod
    def monitor_performance(
        warning_threshold: float = 5.0,
        error_threshold: float = 30.0
    ):
        """Decorator to monitor operation performance"""
        def decorator(func: F) -> F:
            @wraps(func)
            async def async_wrapper(*args, **kwargs):
                start_time = time.time()
                try:
                    result = await func(*args, **kwargs)
                    duration = time.time() - start_time
                    
                    if duration > warning_threshold:
                        logger.warning(f"Slow operation {func.__name__}: {duration:.2f}s", extra={
                            'function_name': func.__name__,
                            'duration': duration,
                            'threshold': warning_threshold
                        })
                    
                    if duration > error_threshold:
                        logger.error(f"Very slow operation {func.__name__}: {duration:.2f}s", extra={
                            'function_name': func.__name__,
                            'duration': duration,
                            'threshold': error_threshold
                        })
                    
                    return result
                except Exception as e:
                    duration = time.time() - start_time
                    logger.error(f"Failed operation {func.__name__} after {duration:.2f}s: {str(e)}")
                    raise
            
            @wraps(func)
            def sync_wrapper(*args, **kwargs):
                start_time = time.time()
                try:
                    result = func(*args, **kwargs)
                    duration = time.time() - start_time
                    
                    if duration > warning_threshold:
                        logger.warning(f"Slow operation {func.__name__}: {duration:.2f}s")
                    
                    return result
                except Exception as e:
                    duration = time.time() - start_time
                    logger.error(f"Failed operation {func.__name__} after {duration:.2f}s: {str(e)}")
                    raise
            
            return async_wrapper if asyncio.iscoroutinefunction(func) else sync_wrapper
        return decorator

# Global error handler for FastAPI
class ErrorHandler:
    """Global error handling for FastAPI application"""
    
    @staticmethod
    def handle_langgraph_error(error: LangGraphError) -> Dict[str, Any]:
        """Handle LangGraph custom errors"""
        return error.to_dict()
    
    @staticmethod
    def handle_generic_error(error: Exception, correlation_id: Optional[str] = None) -> Dict[str, Any]:
        """Handle generic exceptions"""
        enhanced_error = create_enhanced_error(
            category=ErrorCategory.UNKNOWN,
            message="Internal server error",
            code=ErrorCodes.INTERNAL_SERVER_ERROR,
            severity=ErrorSeverity.CRITICAL,
            correlation_id=correlation_id,
            original_error=error
        )
        return LangGraphError(enhanced_error).to_dict()

# Context manager for operation tracking
class OperationContext:
    """Context manager for tracking operations with error handling"""
    
    def __init__(
        self,
        operation_name: str,
        correlation_id: Optional[str] = None,
        user_id: Optional[str] = None
    ):
        self.operation_name = operation_name
        self.correlation_id = correlation_id
        self.user_id = user_id
        self.start_time = None
        self.context = {
            'function_name': operation_name,
            'correlation_id': correlation_id,
            'user_id': user_id
        }
    
    def __enter__(self):
        self.start_time = time.time()
        logger.info(f"Starting operation: {self.operation_name}", extra=self.context)
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        duration = time.time() - self.start_time if self.start_time else 0
        
        if exc_type is None:
            logger.info(f"Completed operation: {self.operation_name} in {duration:.2f}s", extra={
                **self.context,
                'duration': duration
            })
        else:
            logger.error(f"Failed operation: {self.operation_name} after {duration:.2f}s", extra={
                **self.context,
                'duration': duration,
                'error': str(exc_val)
            })
        
        return False  # Don't suppress exceptions

# Utility functions
def is_retryable_error(error: Exception) -> bool:
    """Determine if an error is retryable"""
    if isinstance(error, LangGraphError):
        return error.enhanced_error.retryable
    
    error_str = str(error).lower()
    return any(keyword in error_str for keyword in [
        'timeout', 'connection', 'network', '502', '503', '504',
        'rate_limit', 'quota', 'temporary'
    ])

def get_error_severity(error: Exception) -> ErrorSeverity:
    """Determine error severity based on error type"""
    if isinstance(error, LangGraphError):
        return error.enhanced_error.severity
    
    error_str = str(error).lower()
    
    if any(keyword in error_str for keyword in ['critical', 'fatal', 'corrupt']):
        return ErrorSeverity.CRITICAL
    elif any(keyword in error_str for keyword in ['error', 'failed', 'exception']):
        return ErrorSeverity.HIGH
    elif any(keyword in error_str for keyword in ['warning', 'deprecated']):
        return ErrorSeverity.MEDIUM
    else:
        return ErrorSeverity.LOW