#!/usr/bin/env python3
"""
Test script to demonstrate the logging utility functionality
Run with: python test_logging.py
"""

import os
import sys
import asyncio

# Add the app directory to the path so we can import our modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))

from app.utils.logger import setup_logger, log_request_details, log_response_details, log_error_details

def test_logging_utility():
    """Test the logging utility with different log levels and environments."""
    
    print("Testing logging utility...")
    print("=" * 50)
    
    # Test with development environment
    os.environ['ENVIRONMENT'] = 'development'
    dev_logger = setup_logger('test-dev')
    
    print("\n1. Testing DEVELOPMENT mode logging:")
    print("-" * 40)
    
    dev_logger.debug("This is a debug message in development mode")
    dev_logger.info("Application started successfully")
    dev_logger.warning("This is a warning message")
    dev_logger.error("This is an error message")
    
    # Test request logging
    sample_request = {
        "request_id": "test-123",
        "lead": {
            "company_name": "Acme Corp",
            "website": "acme.com",
            "business_type": "Software"
        },
        "business_profile": {
            "industry": "Technology",
            "services": ["Web Development", "AI Solutions"]
        }
    }
    
    log_request_details(dev_logger, sample_request, "/generate-email")
    
    # Test response logging
    sample_response = {
        "request_id": "test-123",
        "status": "completed",
        "email_content": "Dear John, I hope this email finds you well...",
        "subject": "Partnership Opportunity"
    }
    
    log_response_details(dev_logger, sample_response, 2.456)
    
    # Test error logging
    try:
        raise ValueError("Sample error for testing")
    except Exception as e:
        log_error_details(dev_logger, e, {
            "request_id": "test-123",
            "operation": "email_generation",
            "input_data": sample_request
        })
    
    print("\n2. Testing PRODUCTION mode logging:")
    print("-" * 40)
    
    # Test with production environment
    os.environ['ENVIRONMENT'] = 'production'
    prod_logger = setup_logger('test-prod')
    
    prod_logger.debug("This debug message should NOT appear in production")
    prod_logger.info("Application started successfully in production")
    prod_logger.warning("This is a warning in production")
    prod_logger.error("This is an error in production")
    
    # Test production request logging (should be minimal)
    log_request_details(prod_logger, sample_request, "/generate-email")
    log_response_details(prod_logger, sample_response, 1.234)
    
    print("\n3. Testing default logger convenience functions:")
    print("-" * 40)
    
    # Import and test convenience functions
    from app.utils.logger import debug, info, warning, error
    
    debug("Debug using convenience function")
    info("Info using convenience function")
    warning("Warning using convenience function") 
    error("Error using convenience function")
    
    print("\nLogging utility test completed!")
    print("=" * 50)

if __name__ == "__main__":
    test_logging_utility()