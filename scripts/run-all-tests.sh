#!/bin/bash

# Comprehensive Testing Suite Runner for Genni Platform
# This script runs all testing layers: Unit, Integration, API, and E2E tests

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test results
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_separator() {
    echo ""
    echo "================================================================================================"
    echo "  $1"
    echo "================================================================================================"
    echo ""
}

run_test_suite() {
    local suite_name="$1"
    local command="$2"
    local directory="$3"

    log "Running $suite_name..."

    if [ -n "$directory" ]; then
        cd "$directory"
    fi

    if eval "$command"; then
        log_success "$suite_name completed successfully"
        PASSED_TESTS=$((PASSED_TESTS + 1))
        return 0
    else
        log_error "$suite_name failed"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        return 1
    fi
}

# Parse command line arguments
RUN_UNIT=true
RUN_INTEGRATION=true
RUN_API=true
RUN_E2E=true
RUN_PERFORMANCE=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --unit-only)
            RUN_INTEGRATION=false
            RUN_API=false
            RUN_E2E=false
            shift
            ;;
        --integration-only)
            RUN_UNIT=false
            RUN_API=false
            RUN_E2E=false
            shift
            ;;
        --api-only)
            RUN_UNIT=false
            RUN_INTEGRATION=false
            RUN_E2E=false
            shift
            ;;
        --e2e-only)
            RUN_UNIT=false
            RUN_INTEGRATION=false
            RUN_API=false
            shift
            ;;
        --performance)
            RUN_PERFORMANCE=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --unit-only        Run only unit tests"
            echo "  --integration-only Run only integration tests"
            echo "  --api-only         Run only API integration tests"
            echo "  --e2e-only         Run only end-to-end tests"
            echo "  --performance      Include performance benchmarks"
            echo "  --verbose          Verbose output"
            echo "  --help             Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                 # Run all tests"
            echo "  $0 --unit-only    # Run only unit tests"
            echo "  $0 --performance  # Run all tests including performance"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Start testing
log_separator "GENNI COMPREHENSIVE TESTING SUITE"
log "Starting comprehensive test suite..."
log "Configuration:"
log "  Unit Tests: $RUN_UNIT"
log "  Integration Tests: $RUN_INTEGRATION"
log "  API Tests: $RUN_API"
log "  E2E Tests: $RUN_E2E"
log "  Performance Tests: $RUN_PERFORMANCE"
log "  Verbose: $VERBOSE"

# Store original directory
ORIGINAL_DIR=$(pwd)

# Ensure we're in the project root
if [[ ! -f "package.json" ]]; then
    log_error "Please run this script from the project root directory"
    exit 1
fi

# Install dependencies if needed
log "Checking dependencies..."
if [[ ! -d "node_modules" ]]; then
    log "Installing root dependencies..."
    pnpm install
fi

# 1. Frontend Unit Tests
if [[ "$RUN_UNIT" == "true" ]]; then
    log_separator "FRONTEND UNIT TESTS"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))

    cd "$ORIGINAL_DIR/apps/web"

    if [[ ! -d "node_modules" ]]; then
        log "Installing frontend dependencies..."
        pnpm install
    fi

    # Add testing dependencies if not present
    if ! grep -q "vitest" package.json; then
        log "Adding testing dependencies..."
        pnpm add -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
    fi

    run_test_suite "Frontend Unit Tests" "pnpm test" ""
    cd "$ORIGINAL_DIR"
fi

# 2. LangGraph Integration Tests
if [[ "$RUN_INTEGRATION" == "true" ]]; then
    log_separator "LANGGRAPH INTEGRATION TESTS"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))

    cd "$ORIGINAL_DIR/apps/langgraph-worker"

    # Check Python dependencies
    if [[ ! -f "requirements.txt" ]]; then
        log_error "requirements.txt not found in LangGraph worker directory"
        FAILED_TESTS=$((FAILED_TESTS + 1))
    else
        # Install Python dependencies if needed
        log "Checking Python dependencies..."
        pip install -r requirements.txt > /dev/null 2>&1

        # Run comprehensive integration tests
        run_test_suite "LangGraph Comprehensive Integration Tests" "python test_comprehensive_integration.py" ""
    fi
    cd "$ORIGINAL_DIR"
fi

# 3. API Integration Tests
if [[ "$RUN_API" == "true" ]]; then
    log_separator "API INTEGRATION TESTS"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))

    cd "$ORIGINAL_DIR/apps/langgraph-worker"

    # Run API integration tests with mock responses
    run_test_suite "API Integration Tests" "python test_api_integrations.py" ""
    cd "$ORIGINAL_DIR"
fi

# 4. End-to-End Tests
if [[ "$RUN_E2E" == "true" ]]; then
    log_separator "END-TO-END TESTS"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))

    # Check if Playwright is installed
    if [[ ! -d "node_modules/@playwright" ]]; then
        log "Installing Playwright..."
        pnpm add -D @playwright/test
        npx playwright install
    fi

    # Ensure test servers are not running
    log "Checking for running test servers..."
    if lsof -i :3000 > /dev/null 2>&1; then
        log_warning "Port 3000 is in use, E2E tests may conflict"
    fi

    if lsof -i :8080 > /dev/null 2>&1; then
        log_warning "Port 8080 is in use, E2E tests may conflict"
    fi

    # Run E2E tests
    run_test_suite "End-to-End Tests" "npx playwright test" ""
fi

# 5. Performance Tests
if [[ "$RUN_PERFORMANCE" == "true" ]]; then
    log_separator "PERFORMANCE BENCHMARKS"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))

    cd "$ORIGINAL_DIR/apps/langgraph-worker"

    # Run performance-focused tests
    run_test_suite "Performance Benchmarks" "python test_comprehensive_integration.py --performance" ""
    cd "$ORIGINAL_DIR"
fi

# 6. Convex Backend Tests (if any exist)
if [[ -f "apps/convex-backend/convex/realtime/test.ts" ]]; then
    log_separator "CONVEX BACKEND TESTS"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))

    cd "$ORIGINAL_DIR/apps/convex-backend"

    if command -v npx convex >/dev/null 2>&1; then
        run_test_suite "Convex Backend Tests" "npx convex test" ""
    else
        log_warning "Convex CLI not available, skipping backend tests"
    fi
    cd "$ORIGINAL_DIR"
fi

# Generate comprehensive test report
log_separator "TEST RESULTS SUMMARY"

SUCCESS_RATE=0
if [[ $TOTAL_TESTS -gt 0 ]]; then
    SUCCESS_RATE=$(( (PASSED_TESTS * 100) / TOTAL_TESTS ))
fi

log "Total Test Suites: $TOTAL_TESTS"
log "Passed: $PASSED_TESTS"
log "Failed: $FAILED_TESTS"
log "Success Rate: $SUCCESS_RATE%"

if [[ $FAILED_TESTS -eq 0 ]]; then
    log_success "All test suites passed! 🎉"

    # Generate test report
    REPORT_FILE="test-report-$(date +'%Y%m%d-%H%M%S').json"
    cat > "$REPORT_FILE" << EOF
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "summary": {
    "total_suites": $TOTAL_TESTS,
    "passed_suites": $PASSED_TESTS,
    "failed_suites": $FAILED_TESTS,
    "success_rate": $SUCCESS_RATE
  },
  "configuration": {
    "unit_tests": $RUN_UNIT,
    "integration_tests": $RUN_INTEGRATION,
    "api_tests": $RUN_API,
    "e2e_tests": $RUN_E2E,
    "performance_tests": $RUN_PERFORMANCE
  },
  "environment": {
    "os": "$(uname -s)",
    "node_version": "$(node --version)",
    "python_version": "$(python --version 2>&1)",
    "git_commit": "$(git rev-parse HEAD 2>/dev/null || echo 'unknown')"
  }
}
EOF
    log "Test report saved to: $REPORT_FILE"

    exit 0
else
    log_error "Some test suites failed!"
    log "Check the output above for details on failed tests."

    # Provide debugging hints
    echo ""
    log "Debugging hints:"
    echo "  • Check server logs for API failures"
    echo "  • Verify environment variables are set correctly"
    echo "  • Ensure all dependencies are installed"
    echo "  • Run individual test suites for detailed error messages"
    echo ""
    log "Individual test commands:"

    if [[ "$RUN_UNIT" == "true" ]]; then
        echo "  Frontend Unit:     cd apps/web && pnpm test"
    fi

    if [[ "$RUN_INTEGRATION" == "true" ]]; then
        echo "  LangGraph:         cd apps/langgraph-worker && python test_comprehensive_integration.py"
    fi

    if [[ "$RUN_API" == "true" ]]; then
        echo "  API Integration:   cd apps/langgraph-worker && python test_api_integrations.py"
    fi

    if [[ "$RUN_E2E" == "true" ]]; then
        echo "  End-to-End:        npx playwright test"
    fi

    exit 1
fi
