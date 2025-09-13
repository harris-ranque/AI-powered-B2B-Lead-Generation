# Comprehensive Testing Strategy for Genni AI Platform

## Current Testing Infrastructure Analysis

### ✅ **Strong Areas**

1. **Convex Backend Testing**
   - Well-structured test functions using `internalAction` and `internalMutation`
   - Comprehensive correlation logging tests (`test_correlation.ts`)
   - Real-time broadcasting system tests (`realtime/test.ts`)
   - Google Maps API integration tests (`search/test_api.ts`)
   - CLI-friendly testing with `npx convex dev --once --run`

2. **LangGraph Worker Testing**
   - 6 comprehensive Python test files covering different aspects
   - Integration testing suite (`test_integration_comprehensive.py`)
   - API testing with realistic scenarios
   - Test data models and workflow validation
   - Multi-scenario testing (high/medium/low relevance)

### ⚠️ **Gaps Identified**

1. **Frontend Testing**: No test files found in React app
2. **E2E Testing**: No cross-service integration testing
3. **Test Infrastructure**: Missing test frameworks (Jest/Vitest)
4. **Automated Testing**: No CI/CD test pipelines
5. **Performance Testing**: Limited load/stress testing
6. **Security Testing**: No dedicated security test suites

---

## Comprehensive Testing Strategy

### **Tier 1: Foundation (High Priority)**

#### 1.1 Frontend Testing Setup

```bash
# Add to apps/web/package.json
"devDependencies": {
  "@testing-library/react": "^14.0.0",
  "@testing-library/jest-dom": "^6.0.0",
  "@testing-library/user-event": "^14.0.0",
  "vitest": "^1.0.0",
  "@vitest/ui": "^1.0.0",
  "jsdom": "^23.0.0"
}

"scripts": {
  "test": "vitest",
  "test:ui": "vitest --ui",
  "test:coverage": "vitest --coverage"
}
```

**Test Structure:**

```
apps/web/
├── src/
│   ├── components/
│   │   ├── __tests__/
│   │   │   ├── GenniApp.test.tsx
│   │   │   ├── LeadGenApp.test.tsx
│   │   │   ├── ChatInterface.test.tsx
│   │   │   └── Dashboard.test.tsx
│   │   └── ui/
│   │       └── __tests__/
│   │           ├── Button.test.tsx
│   │           ├── Input.test.tsx
│   │           └── Card.test.tsx
│   ├── hooks/
│   │   └── __tests__/
│   │       ├── useAuth.test.ts
│   │       ├── useLeads.test.ts
│   │       └── useSearch.test.ts
│   └── lib/
│       └── __tests__/
│           ├── utils.test.ts
│           ├── api.test.ts
│           └── validation.test.ts
├── test-setup.ts
└── vitest.config.ts
```

#### 1.2 Python Testing Standardization

```bash
# Add to apps/langgraph-worker/requirements-test.txt
pytest==7.4.0
pytest-asyncio==0.21.0
pytest-cov==4.1.0
pytest-mock==3.11.0
httpx==0.24.0
respx==0.20.0

# Standardize test execution
python -m pytest tests/ -v --cov=app --cov-report=html
```

**Standardized Structure:**

```
apps/langgraph-worker/
├── tests/
│   ├── unit/
│   │   ├── test_agents.py
│   │   ├── test_workflow.py
│   │   └── test_utils.py
│   ├── integration/
│   │   ├── test_api_endpoints.py
│   │   ├── test_convex_integration.py
│   │   └── test_openai_integration.py
│   └── e2e/
│       ├── test_full_workflow.py
│       └── test_performance.py
├── conftest.py (pytest configuration)
└── pytest.ini
```

#### 1.3 Convex Testing Enhancement

**Expand current testing with:**

```typescript
// Enhanced test commands
npx convex dev --once --run lib/test_correlation:testCorrelationLogging
npx convex dev --once --run search/test_api:testGoogleMapsAPISimple
npx convex dev --once --run realtime/test:testBroadcasting

// New test areas to add:
// - Credit system tests
// - Rate limiting tests
// - Batch processing tests
// - Error recovery tests
// - Performance benchmarks
```

### **Tier 2: Integration & E2E (Medium Priority)**

#### 2.1 Cross-Service Integration Testing

```bash
# Add to root package.json
"scripts": {
  "test:integration": "pnpm test:convex && pnpm test:worker && pnpm test:frontend",
  "test:e2e": "playwright test",
  "test:all": "pnpm test:integration && pnpm test:e2e"
}
```

**E2E Test Scenarios:**

1. **Complete Lead Generation Flow**
   - User creates search → Google Maps discovery → FindyMail enrichment → LangGraph analysis → Results
2. **Real-time Updates Testing**
   - Status broadcasting across all pipeline stages
3. **Error Recovery Testing**
   - API failures, timeout handling, retry mechanisms
4. **Performance Testing**
   - Load testing with multiple concurrent users
   - Memory leak detection
   - Response time validation

#### 2.2 Playwright E2E Setup

```typescript
// playwright.config.ts
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    {
      command: "pnpm dev:web",
      port: 3000,
    },
    {
      command: "pnpm dev:worker",
      port: 8080,
    },
  ],
});
```

### **Tier 3: Advanced Testing (Lower Priority)**

#### 3.1 Performance & Load Testing

```python
# Add locust for load testing
from locust import HttpUser, task, between

class GenniLoadTest(HttpUser):
    wait_time = between(1, 3)

    @task(3)
    def test_lead_search(self):
        self.client.post("/generate-email", json={
            "lead": {...},
            "business_profile": {...}
        })

    @task(1)
    def test_health_check(self):
        self.client.get("/health")
```

#### 3.2 Security Testing

```bash
# Security test tools
npm install --save-dev @security/eslint-plugin
pip install bandit safety

# Add security test commands
"test:security": "eslint --ext .ts,.tsx . && bandit -r apps/langgraph-worker/"
```

#### 3.3 Visual Regression Testing

```typescript
// Add to Playwright tests
await expect(page).toHaveScreenshot("dashboard.png");
await expect(page.locator(".lead-card")).toHaveScreenshot("lead-card.png");
```

---

## Testing Commands Standardization

### **Root Level Commands**

```bash
# Install all test dependencies
pnpm install-test-deps

# Run all tests
pnpm test

# Run tests by service
pnpm test:web           # Frontend tests
pnpm test:worker        # LangGraph worker tests
pnpm test:convex        # Convex backend tests

# Run by test type
pnpm test:unit          # Unit tests only
pnpm test:integration   # Integration tests only
pnpm test:e2e          # End-to-end tests only

# Coverage and reporting
pnpm test:coverage     # Generate coverage reports
pnpm test:report       # Generate test reports
```

### **Service-Specific Commands**

#### Frontend (apps/web)

```bash
cd apps/web
pnpm test                    # Run all frontend tests
pnpm test:watch             # Watch mode
pnpm test:coverage          # Coverage report
pnpm test:ui                # Vitest UI
pnpm test components/       # Test specific directory
```

#### LangGraph Worker (apps/langgraph-worker)

```bash
cd apps/langgraph-worker
python -m pytest tests/                    # All tests
python -m pytest tests/unit/              # Unit tests only
python -m pytest tests/integration/       # Integration tests only
python -m pytest --cov=app --cov-report=html  # Coverage
python -m pytest -v -s                    # Verbose output
```

#### Convex Backend (apps/convex-backend)

```bash
cd apps/convex-backend
npx convex dev --once --run search/test_api:testGoogleMapsAPISimple
npx convex dev --once --run lib/test_correlation:testCorrelationLogging
npx convex dev --once --run realtime/test:testBroadcasting
pnpm test:convex-all    # Run all Convex tests sequentially
```

---

## Test Quality Standards

### **Coverage Requirements**

- **Unit Tests**: ≥80% line coverage
- **Integration Tests**: ≥70% critical path coverage
- **E2E Tests**: 100% critical user journeys

### **Performance Benchmarks**

- **Frontend**: Page load <3s, interaction response <100ms
- **API**: Response time <200ms for 95th percentile
- **LangGraph**: Email generation <30s end-to-end

### **Quality Gates**

- All tests must pass before deployment
- Coverage thresholds must be met
- No security vulnerabilities above medium severity
- Performance benchmarks must be maintained

---

## Implementation Roadmap

### **Phase 1: Foundation (Week 1-2)**

1. Set up Vitest for React frontend
2. Standardize Python testing with pytest
3. Create basic unit tests for critical components
4. Establish CI/CD pipeline integration

### **Phase 2: Integration (Week 3-4)**

1. Implement cross-service integration tests
2. Set up Playwright for E2E testing
3. Create performance benchmarking
4. Add automated test reporting

### **Phase 3: Advanced (Week 5-6)**

1. Implement security testing
2. Add visual regression testing
3. Set up load testing infrastructure
4. Create comprehensive test documentation

### **Phase 4: Optimization (Week 7-8)**

1. Optimize test execution speed
2. Implement parallel test execution
3. Add advanced monitoring and alerting
4. Create automated test maintenance

---

## Monitoring & Maintenance

### **Test Health Monitoring**

- Test execution time tracking
- Flaky test detection and resolution
- Coverage trend analysis
- Performance regression alerts

### **Automated Maintenance**

- Dependency updates for test frameworks
- Test data refresh and cleanup
- Report archival and cleanup
- Performance baseline updates

This comprehensive testing strategy provides a clear roadmap for transforming Genni's testing infrastructure from its current state to a robust, enterprise-grade testing system that ensures reliability, performance, and quality across all services.
