"""
Logging utility for CrewAI worker with environment-based configuration.
"""

import logging
import os
import sys
from datetime import datetime
from typing import Any, Optional


class ColoredFormatter(logging.Formatter):
    """Custom formatter with colors for console output."""
    
    COLORS = {
        'DEBUG': '\033[36m',     # Cyan
        'INFO': '\033[32m',      # Green
        'WARNING': '\033[33m',   # Yellow
        'ERROR': '\033[31m',     # Red
        'CRITICAL': '\033[35m',  # Magenta
    }
    RESET = '\033[0m'
    
    def format(self, record):
        if record.levelname in self.COLORS:
            record.levelname = f"{self.COLORS[record.levelname]}{record.levelname}{self.RESET}"
        return super().format(record)


def setup_logger(name: str = __name__) -> logging.Logger:
    """
    Set up logger with environment-based configuration.
    
    Args:
        name: Logger name
        
    Returns:
        Configured logger instance
    """
    logger = logging.getLogger(name)
    
    # Avoid duplicate handlers
    if logger.handlers:
        return logger
    
    # Get environment
    environment = os.getenv('ENVIRONMENT', 'production').lower()
    is_development = environment in ('development', 'dev', 'local')
    
    # Set log level based on environment
    if is_development:
        log_level = logging.DEBUG
    else:
        log_level = logging.INFO
    
    logger.setLevel(log_level)
    
    # Create console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(log_level)
    
    # Create formatter
    if is_development:
        # Detailed format for development
        formatter = ColoredFormatter(
            '%(asctime)s | %(levelname)s | %(name)s:%(lineno)d | %(funcName)s() | %(message)s',
            datefmt='%H:%M:%S'
        )
    else:
        # Simple format for production
        formatter = logging.Formatter(
            '%(asctime)s | %(levelname)s | %(name)s | %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
    
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)
    
    # Prevent propagation to root logger
    logger.propagate = False
    
    return logger


def log_request_details(logger: logging.Logger, request_data: dict, endpoint: str):
    """Log detailed request information in development mode."""
    environment = os.getenv('ENVIRONMENT', 'production').lower()
    is_development = environment in ('development', 'dev', 'local')
    
    if is_development:
        logger.debug(f"=== REQUEST TO {endpoint} ===")
        logger.debug(f"Request data keys: {list(request_data.keys())}")
        for key, value in request_data.items():
            if isinstance(value, (str, int, float, bool)):
                logger.debug(f"  {key}: {value}")
            elif isinstance(value, (list, dict)):
                logger.debug(f"  {key}: {type(value).__name__} with {len(value)} items")
            else:
                logger.debug(f"  {key}: {type(value).__name__}")
        logger.debug("=" * 50)


def log_response_details(logger: logging.Logger, response_data: Any, duration: Optional[float] = None):
    """Log detailed response information in development mode."""
    environment = os.getenv('ENVIRONMENT', 'production').lower()
    is_development = environment in ('development', 'dev', 'local')
    
    if is_development:
        logger.debug("=== RESPONSE DETAILS ===")
        if duration:
            logger.debug(f"Duration: {duration:.3f}s")
        
        if isinstance(response_data, dict):
            logger.debug(f"Response keys: {list(response_data.keys())}")
            for key, value in response_data.items():
                if isinstance(value, str) and len(value) > 100:
                    logger.debug(f"  {key}: {type(value).__name__} ({len(value)} chars)")
                elif isinstance(value, (list, dict)):
                    logger.debug(f"  {key}: {type(value).__name__} with {len(value)} items")
                else:
                    logger.debug(f"  {key}: {value}")
        else:
            logger.debug(f"Response type: {type(response_data).__name__}")
        logger.debug("=" * 30)


def log_error_details(logger: logging.Logger, error: Exception, context: Optional[dict] = None):
    """Log detailed error information."""
    logger.error(f"Error: {type(error).__name__}: {str(error)}")
    
    environment = os.getenv('ENVIRONMENT', 'production').lower()
    is_development = environment in ('development', 'dev', 'local')
    
    if is_development and context:
        logger.debug("=== ERROR CONTEXT ===")
        for key, value in context.items():
            logger.debug(f"  {key}: {value}")
        logger.debug("=" * 25)


# Create default logger instance
default_logger = setup_logger('crewai-worker')

# Convenience functions using default logger
def debug(message: str, *args, **kwargs):
    default_logger.debug(message, *args, **kwargs)

def info(message: str, *args, **kwargs):
    default_logger.info(message, *args, **kwargs)

def warning(message: str, *args, **kwargs):
    default_logger.warning(message, *args, **kwargs)

def error(message: str, *args, **kwargs):
    default_logger.error(message, *args, **kwargs)

def critical(message: str, *args, **kwargs):
    default_logger.critical(message, *args, **kwargs)