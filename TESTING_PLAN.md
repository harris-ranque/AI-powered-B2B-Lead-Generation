# Genni Testing Plan & Implementation Strategy

## Executive Summary

This document outlines a comprehensive testing strategy for the Genni lead generation platform, covering unit tests, integration tests, and UI tests. The plan prioritizes implementable tests based on existing infrastructure and identifies critical paths requiring coverage.

## Current Testing State

### ✅ What We Have

**Frontend (apps/web)**:
- ✅ Vitest + React Testing Library setup
- ✅ Test configuration: `vitest.config.ts`
- ✅ Test setup file with mocks: `src/test/setup.ts`
- ✅ Two example tests:
  - `GenniApp.test.tsx` - Dashboard navigation and user interface
  - `PipelineProgressPanel.test.tsx` - Real-time pipeline progress tracking
- ✅ Test commands configured: `test`, `test:ui`, `test:coverage`, `test:watch`
- ✅ Mock data utilities for users, profiles, searches, and leads

**Backend (Convex)**:
- ❌ No test framework configured
- ✅ Complex business logic requiring testing
- ✅ Well-structured modular architecture

**LangGraph Worker (Python)**:
- ❌ No test framework in requirements.txt
- ✅ Multi-agent AI system with predictable workflows
- ✅ Clear separation of concerns

### 🎯 Testing Goals

1. **95% Critical Path Coverage** - Core user flows must be reliable
2. **Regression Prevention** - Catch bugs before production
3. **Fast Feedback Loop** - Tests run in <30s locally
4. **Maintainable Tests** - Clear, focused, easy to update
5. **Documentation** - Tests serve as living documentation

---

## Testing Strategy by Layer

### 1. Frontend Testing (React + TypeScript)

**Framework**: Vitest + React Testing Library + jsdom

#### 1.1 Unit Tests (Component-Level)

**Priority Components to Test**:

| Component | Test File | Priority | Complexity | Est. Time |
|-----------|-----------|----------|------------|-----------|
| `CreditManager` | `CreditManager.test.tsx` | HIGH | Medium | 2h |
| `LeadSearchHistory` | `LeadSearchHistory.test.tsx` | HIGH | Medium | 2h |
| `EnhancedLeadCard` | `EnhancedLeadCard.test.tsx` | HIGH | Low | 1h |
| `BusinessProfileWizard` | `BusinessProfileWizard.test.tsx` | HIGH | High | 3h |
| `SearchProgressTracker` | `SearchProgressTracker.test.tsx` | MEDIUM | Medium | 2h |
| `DashboardOverview` | `DashboardOverview.test.tsx` | MEDIUM | Medium | 2h |
| `EmailStudio` | `EmailStudio.test.tsx` | MEDIUM | High | 3h |
| `SubscriptionStatusCard` | `SubscriptionStatusCard.test.tsx` | LOW | Low | 1h |
| `UsageMetersCard` | `UsageMetersCard.test.tsx` | LOW | Low | 1h |

**Test Coverage Areas**:
- ✅ Rendering with different states (loading, error, success)
- ✅ User interactions (clicks, form submissions)
- ✅ Data display and formatting
- ✅ Conditional rendering based on props/state
- ✅ Accessibility (ARIA labels, keyboard navigation)

#### 1.2 Integration Tests (Feature-Level)

**Priority Flows to Test**:

| Feature Flow | Test File | Priority | Complexity | Est. Time |
|--------------|-----------|----------|------------|-----------|
| Lead Search Creation | `search-flow.test.tsx` | HIGH | High | 4h |
| Credit Purchase Flow | `credit-purchase.test.tsx` | HIGH | Medium | 3h |
| Email Generation Flow | `email-generation.test.tsx` | HIGH | High | 4h |
| Profile Setup Wizard | `profile-wizard.test.tsx` | HIGH | Medium | 3h |
| Pipeline Progress Tracking | `pipeline-tracking.test.tsx` | MEDIUM | High | 3h |
| Dashboard Navigation | `dashboard-navigation.test.tsx` | MEDIUM | Low | 2h |
| Lead Export | `lead-export.test.tsx` | MEDIUM | Medium | 2h |

**Test Coverage Areas**:
- ✅ Multi-step workflows end-to-end
- ✅ State management across components
- ✅ Real-time data synchronization
- ✅ Error handling and retry logic
- ✅ User feedback mechanisms (toasts, progress indicators)

#### 1.3 Custom Hooks Testing

**Priority Hooks to Test**:

| Hook | Test File | Priority | Complexity | Est. Time |
|------|-----------|----------|------------|-----------|
| `useAuth` | `useAuth.test.ts` | HIGH | Low | 1h |
| `useProfile` | `useProfile.test.ts` | HIGH | Medium | 1.5h |
| `useBilling` / `useCredits` | `useBilling.test.ts` | HIGH | Medium | 2h |
| `useSearches` | `useSearches.test.ts` | HIGH | Medium | 2h |
| `useLeads` | `useLeads.test.ts` | HIGH | Medium | 2h |
| `useStatusBroadcasts` | `useStatusBroadcasts.test.ts` | MEDIUM | High | 3h |
| `useLangGraph` | `useLangGraph.test.ts` | MEDIUM | Medium | 2h |

**Test Coverage Areas**:
- ✅ Return values in different states
- ✅ Side effects (API calls, state updates)
- ✅ Error handling
- ✅ Cleanup and unmounting
- ✅ Caching and memoization

#### 1.4 Utility Functions Testing

**Priority Utils to Test**:

| Utility Module | Test File | Priority | Complexity | Est. Time |
|----------------|-----------|----------|------------|-----------|
| Formatters | `formatters.test.ts` | MEDIUM | Low | 1h |
| Validators | `validators.test.ts` | HIGH | Low | 1h |
| Date/Time Utils | `date-utils.test.ts` | LOW | Low | 1h |
| CSV Export | `csv-export.test.ts` | MEDIUM | Medium | 2h |
| API Helpers | `api-helpers.test.ts` | MEDIUM | Low | 1h |

---

### 2. Backend Testing (Convex)

**Framework**: Vitest (recommended) or Jest

#### 2.1 Unit Tests (Function-Level)

**Priority Modules to Test**:

| Module | Test File | Priority | Complexity | Est. Time |
|--------|-----------|----------|------------|-----------|
| `credits/transactions.ts` | `transactions.test.ts` | CRITICAL | High | 4h |
| `leads/enrichment/provider.ts` | `provider.test.ts` | HIGH | High | 4h |
| `search/orchestrator.ts` | `orchestrator.test.ts` | CRITICAL | Very High | 6h |
| `search/batchProcessor.ts` | `batchProcessor.test.ts` | HIGH | High | 4h |
| `rateLimit/internal.ts` | `rateLimit.test.ts` | HIGH | Medium | 3h |
| `lib/correlation.ts` | `correlation.test.ts` | MEDIUM | Low | 2h |
| `lib/logging.ts` | `logging.test.ts` | MEDIUM | Low | 2h |

**Test Coverage Areas**:
- ✅ Pure function logic
- ✅ Database schema validation
- ✅ Business rule enforcement
- ✅ Error handling and edge cases
- ✅ Transaction integrity (especially credits)

#### 2.2 Integration Tests (API-Level)

**Priority Endpoints to Test**:

| Endpoint Type | Test File | Priority | Complexity | Est. Time |
|---------------|-----------|----------|------------|-----------|
| Search Creation | `search-api.test.ts` | CRITICAL | High | 4h |
| Lead Enrichment | `enrichment-api.test.ts` | HIGH | High | 4h |
| Credit Operations | `credits-api.test.ts` | CRITICAL | Medium | 3h |
| User Management | `user-api.test.ts` | MEDIUM | Medium | 3h |
| Webhook Handlers | `webhooks.test.ts` | HIGH | Medium | 3h |

**Test Coverage Areas**:
- ✅ Request/response validation
- ✅ Authentication and authorization
- ✅ Rate limiting behavior
- ✅ Error responses
- ✅ Database side effects

#### 2.3 Convex-Specific Testing Approach

**Recommended Setup**:

```typescript
// apps/convex-backend/test/setup.ts
import { convexTest } from "convex-test";
import { schema } from "../convex/schema";

export const testConvex = convexTest(schema);

// Mock external APIs
export const mockFindymail = vi.fn();
export const mockGoogleMaps = vi.fn();
export const mockLangGraph = vi.fn();
```

**Test Pattern Example**:

```typescript
describe("Credit Transactions", () => {
  it("should atomically reserve and commit credits", async () => {
    const t = testConvex();

    // Create test user
    const userId = await t.mutation(internal.users.create, {
      email: "test@example.com",
      credits: 100
    });

    // Reserve credits
    const reservation = await t.mutation(api.credits.reserve, {
      userId,
      amount: 25,
      operation: "search"
    });

    expect(reservation.status).toBe("reserved");

    // Commit credits
    await t.mutation(api.credits.commit, {
      reservationId: reservation._id
    });

    // Verify balance
    const balance = await t.query(api.credits.getBalance, { userId });
    expect(balance.credits).toBe(75);
  });
});
```

---

### 3. LangGraph Worker Testing (Python)

**Framework**: pytest + pytest-asyncio

#### 3.1 Unit Tests (Agent-Level)

**Priority Modules to Test**:

| Module | Test File | Priority | Complexity | Est. Time |
|--------|-----------|----------|------------|-----------|
| `business_intelligence_agent.py` | `test_business_intelligence.py` | HIGH | High | 4h |
| `email_generation_agent.py` | `test_email_generation.py` | HIGH | High | 4h |
| `quality_assurance_agent.py` | `test_quality_assurance.py` | HIGH | Medium | 3h |
| `relevance_analyzer.py` | `test_relevance_analyzer.py` | MEDIUM | Medium | 3h |
| `workflow.py` | `test_workflow.py` | CRITICAL | Very High | 6h |
| `data_validation.py` | `test_data_validation.py` | HIGH | Low | 2h |
| `webhook.py` | `test_webhook.py` | MEDIUM | Medium | 2h |

**Test Coverage Areas**:
- ✅ Agent input/output validation
- ✅ LLM prompt engineering (mock responses)
- ✅ Error handling and retries
- ✅ State transitions
- ✅ Performance benchmarks

#### 3.2 Integration Tests (Workflow-Level)

**Priority Workflows to Test**:

| Workflow | Test File | Priority | Complexity | Est. Time |
|----------|-----------|----------|------------|-----------|
| Full Pipeline | `test_full_pipeline.py` | CRITICAL | Very High | 6h |
| Research Tier Flow | `test_research_tiers.py` | HIGH | High | 4h |
| Quality Gates | `test_quality_gates.py` | HIGH | Medium | 3h |
| Error Recovery | `test_error_recovery.py` | MEDIUM | High | 4h |

**Test Coverage Areas**:
- ✅ End-to-end workflow execution
- ✅ Inter-agent communication
- ✅ State persistence and checkpointing
- ✅ Webhook delivery
- ✅ Timeout handling

#### 3.3 Python Testing Setup

**Required Dependencies** (`requirements-dev.txt`):

```txt
# Testing frameworks
pytest>=8.0.0,<9.0.0
pytest-asyncio>=0.23.0,<1.0.0
pytest-cov>=4.1.0,<5.0.0
pytest-mock>=3.12.0,<4.0.0

# Test utilities
faker>=22.0.0,<23.0.0
freezegun>=1.4.0,<2.0.0
responses>=0.24.0,<1.0.0

# Code quality
mypy>=1.8.0,<2.0.0
black>=24.0.0,<25.0.0
ruff>=0.1.0,<1.0.0
```

**Test Configuration** (`pytest.ini`):

```ini
[tool:pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
addopts =
    --verbose
    --tb=short
    --cov=app
    --cov-report=term-missing
    --cov-report=html
    --asyncio-mode=auto
markers =
    unit: Unit tests
    integration: Integration tests
    slow: Slow tests that hit external APIs
```

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1-2)

**Goal**: Set up testing infrastructure and high-priority unit tests

#### Week 1: Frontend Foundation
- [ ] Configure additional test utilities
- [ ] Create test factory functions for common entities
- [ ] Implement `CreditManager.test.tsx`
- [ ] Implement `LeadSearchHistory.test.tsx`
- [ ] Implement `EnhancedLeadCard.test.tsx`
- [ ] Implement `useAuth.test.ts`
- [ ] Implement `useProfile.test.ts`

**Deliverables**: 7 test files, ~50 test cases, 30-40% coverage of critical UI components

#### Week 2: Backend Foundation
- [ ] Set up Convex testing environment
- [ ] Configure test database and mocks
- [ ] Implement `transactions.test.ts` (Credit system)
- [ ] Implement `correlation.test.ts`
- [ ] Implement `logging.test.ts`
- [ ] Implement `validators.test.ts`

**Deliverables**: 4 test files, ~40 test cases, core utility coverage

---

### Phase 2: Critical Paths (Week 3-4)

**Goal**: Test business-critical workflows end-to-end

#### Week 3: Search & Pipeline
- [ ] Implement `search-flow.test.tsx` (Integration)
- [ ] Implement `pipeline-tracking.test.tsx` (Integration)
- [ ] Implement `search-api.test.ts` (Backend)
- [ ] Implement `orchestrator.test.ts` (Backend)
- [ ] Implement `batchProcessor.test.ts` (Backend)

**Deliverables**: 5 test files, ~60 test cases, search pipeline coverage

#### Week 4: Enrichment & AI
- [ ] Implement `email-generation.test.tsx` (Integration)
- [ ] Implement `enrichment-api.test.ts` (Backend)
- [ ] Implement `provider.test.ts` (Backend)
- [ ] Implement `rateLimit.test.ts` (Backend)

**Deliverables**: 4 test files, ~50 test cases, enrichment pipeline coverage

---

### Phase 3: Python Worker (Week 5-6)

**Goal**: Comprehensive LangGraph agent testing

#### Week 5: Agent Unit Tests
- [ ] Set up pytest infrastructure
- [ ] Implement `test_business_intelligence.py`
- [ ] Implement `test_email_generation.py`
- [ ] Implement `test_quality_assurance.py`
- [ ] Implement `test_data_validation.py`

**Deliverables**: 4 test files, ~40 test cases, agent logic coverage

#### Week 6: Workflow Integration
- [ ] Implement `test_full_pipeline.py`
- [ ] Implement `test_research_tiers.py`
- [ ] Implement `test_quality_gates.py`
- [ ] Implement `test_webhook.py`

**Deliverables**: 4 test files, ~35 test cases, workflow coverage

---

### Phase 4: Comprehensive Coverage (Week 7-8)

**Goal**: Fill gaps and add remaining tests

#### Week 7: Secondary Components
- [ ] Implement `BusinessProfileWizard.test.tsx`
- [ ] Implement `EmailStudio.test.tsx`
- [ ] Implement `DashboardOverview.test.tsx`
- [ ] Implement `useSearches.test.ts`
- [ ] Implement `useLeads.test.ts`
- [ ] Implement `useBilling.test.ts`

**Deliverables**: 6 test files, ~70 test cases

#### Week 8: Advanced Features
- [ ] Implement `credit-purchase.test.tsx` (Integration)
- [ ] Implement `lead-export.test.tsx` (Integration)
- [ ] Implement `useStatusBroadcasts.test.ts`
- [ ] Implement `webhooks.test.ts` (Backend)
- [ ] Implement `test_error_recovery.py` (Python)

**Deliverables**: 5 test files, ~50 test cases

---

## Test Implementation Examples

### Example 1: Component Unit Test

```typescript
// apps/web/src/components/__tests__/CreditManager.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreditManager } from '../CreditManager';
import { useCredits } from '@/hooks/useBilling';
import { useAuth } from '@/hooks/useAuth';

vi.mock('@/hooks/useBilling');
vi.mock('@/hooks/useAuth');

const mockUseCredits = vi.mocked(useCredits);
const mockUseAuth = vi.mocked(useAuth);

describe('CreditManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseAuth.mockReturnValue({
      user: { _id: 'user-1', role: 'user' },
      isAuthenticated: true,
      isLoading: false,
    });

    mockUseCredits.mockReturnValue({
      balance: { credits: 150 },
      transactions: [],
      isLoading: false,
      purchaseCredits: vi.fn(),
    });
  });

  it('displays current credit balance', () => {
    render(<CreditManager currentCredits={150} />);

    expect(screen.getByText(/150/)).toBeInTheDocument();
    expect(screen.getByText(/credits/i)).toBeInTheDocument();
  });

  it('opens purchase modal when clicking add credits button', async () => {
    render(<CreditManager currentCredits={150} />);

    const addButton = screen.getByRole('button', { name: /add credits/i });
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(screen.getByText(/purchase credits/i)).toBeInTheDocument();
    });
  });

  it('shows low balance warning when credits are below threshold', () => {
    mockUseCredits.mockReturnValue({
      balance: { credits: 15 },
      transactions: [],
      isLoading: false,
      purchaseCredits: vi.fn(),
    });

    render(<CreditManager currentCredits={15} />);

    expect(screen.getByText(/low balance/i)).toBeInTheDocument();
  });

  it('handles credit purchase flow', async () => {
    const purchaseCredits = vi.fn().mockResolvedValue({ success: true });

    mockUseCredits.mockReturnValue({
      balance: { credits: 150 },
      transactions: [],
      isLoading: false,
      purchaseCredits,
    });

    render(<CreditManager currentCredits={150} />);

    // Open modal
    const addButton = screen.getByRole('button', { name: /add credits/i });
    fireEvent.click(addButton);

    // Select package
    const package100 = await screen.findByText(/100 credits/i);
    fireEvent.click(package100);

    // Confirm purchase
    const confirmButton = screen.getByRole('button', { name: /confirm/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(purchaseCredits).toHaveBeenCalledWith({ amount: 100 });
    });
  });
});
```

### Example 2: Integration Test

```typescript
// apps/web/src/__tests__/integration/search-flow.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GenniApp } from '@/components/GenniApp';

describe('Lead Search Flow', () => {
  beforeEach(() => {
    // Setup comprehensive mocks
    setupAuthMocks();
    setupConvexMocks();
  });

  it('creates a new search from start to finish', async () => {
    const user = userEvent.setup();
    render(<GenniApp />);

    // 1. Navigate to search tab
    const searchTab = screen.getByRole('button', { name: /new search/i });
    await user.click(searchTab);

    // 2. Enter search parameters
    const locationInput = screen.getByLabelText(/location/i);
    await user.type(locationInput, 'San Francisco, CA');

    const keywordInput = screen.getByLabelText(/keywords/i);
    await user.type(keywordInput, 'AI consulting');

    // 3. Set radius
    const radiusSlider = screen.getByRole('slider', { name: /radius/i });
    fireEvent.change(radiusSlider, { target: { value: '25' } });

    // 4. Verify credit estimate
    await waitFor(() => {
      expect(screen.getByText(/estimated cost: ~20 credits/i)).toBeInTheDocument();
    });

    // 5. Submit search
    const startButton = screen.getByRole('button', { name: /start search/i });
    await user.click(startButton);

    // 6. Verify progress tracking appears
    await waitFor(() => {
      expect(screen.getByText(/discovering leads/i)).toBeInTheDocument();
    });

    // 7. Verify search appears in history
    const historyTab = screen.getByRole('button', { name: /search history/i });
    await user.click(historyTab);

    await waitFor(() => {
      expect(screen.getByText(/ai consulting/i)).toBeInTheDocument();
    });
  });

  it('prevents search when insufficient credits', async () => {
    const user = userEvent.setup();

    // Mock low credit balance
    mockUseCredits.mockReturnValue({
      balance: { credits: 5 },
      transactions: [],
      isLoading: false,
    });

    render(<GenniApp />);

    // Navigate to search
    const searchTab = screen.getByRole('button', { name: /new search/i });
    await user.click(searchTab);

    // Fill form
    const locationInput = screen.getByLabelText(/location/i);
    await user.type(locationInput, 'San Francisco, CA');

    // Verify start button is disabled
    const startButton = screen.getByRole('button', { name: /start search/i });
    expect(startButton).toBeDisabled();

    // Verify warning message
    expect(screen.getByText(/insufficient credits/i)).toBeInTheDocument();
  });
});
```

### Example 3: Backend Function Test

```typescript
// apps/convex-backend/convex/credits/__tests__/transactions.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { testConvex } from '../../test/setup';
import { api } from '../_generated/api';
import { internal } from '../_generated/api';

describe('Credit Transactions', () => {
  let t: ReturnType<typeof testConvex>;
  let userId: string;

  beforeEach(async () => {
    t = testConvex();

    // Create test user with initial balance
    userId = await t.mutation(internal.users.create, {
      email: 'test@example.com',
      credits: 100,
    });
  });

  describe('Reservation Flow', () => {
    it('reserves credits successfully', async () => {
      const reservation = await t.mutation(api.credits.reserve, {
        userId,
        amount: 25,
        operation: 'search',
        metadata: { searchId: 'test-search' },
      });

      expect(reservation.status).toBe('reserved');
      expect(reservation.amount).toBe(25);
      expect(reservation.userId).toBe(userId);
    });

    it('prevents over-reservation', async () => {
      await expect(
        t.mutation(api.credits.reserve, {
          userId,
          amount: 150, // More than available
          operation: 'search',
        })
      ).rejects.toThrow(/insufficient credits/i);
    });

    it('handles concurrent reservations correctly', async () => {
      // Attempt 5 concurrent reservations
      const reservations = await Promise.all([
        t.mutation(api.credits.reserve, { userId, amount: 20, operation: 'search' }),
        t.mutation(api.credits.reserve, { userId, amount: 20, operation: 'search' }),
        t.mutation(api.credits.reserve, { userId, amount: 20, operation: 'search' }),
        t.mutation(api.credits.reserve, { userId, amount: 20, operation: 'search' }),
        t.mutation(api.credits.reserve, { userId, amount: 20, operation: 'search' }),
      ]);

      // All should succeed
      expect(reservations).toHaveLength(5);
      reservations.forEach(r => {
        expect(r.status).toBe('reserved');
      });
    });
  });

  describe('Commit Flow', () => {
    it('commits reserved credits with actual usage', async () => {
      // Reserve
      const reservation = await t.mutation(api.credits.reserve, {
        userId,
        amount: 25,
        operation: 'search',
      });

      // Commit with actual usage (less than reserved)
      await t.mutation(api.credits.commit, {
        reservationId: reservation._id,
        actualUsed: 18,
      });

      // Verify balance
      const balance = await t.query(api.credits.getBalance, { userId });
      expect(balance.credits).toBe(82); // 100 - 18
    });

    it('commits full reserved amount if not specified', async () => {
      const reservation = await t.mutation(api.credits.reserve, {
        userId,
        amount: 25,
        operation: 'search',
      });

      await t.mutation(api.credits.commit, {
        reservationId: reservation._id,
      });

      const balance = await t.query(api.credits.getBalance, { userId });
      expect(balance.credits).toBe(75); // 100 - 25
    });
  });

  describe('Rollback Flow', () => {
    it('rolls back reserved credits on failure', async () => {
      const reservation = await t.mutation(api.credits.reserve, {
        userId,
        amount: 25,
        operation: 'search',
      });

      await t.mutation(api.credits.rollback, {
        reservationId: reservation._id,
        reason: 'Search failed',
      });

      // Verify full balance restored
      const balance = await t.query(api.credits.getBalance, { userId });
      expect(balance.credits).toBe(100);

      // Verify reservation marked as rolled back
      const reservationStatus = await t.query(api.credits.getReservation, {
        reservationId: reservation._id,
      });
      expect(reservationStatus.status).toBe('rolled_back');
    });
  });

  describe('Transaction History', () => {
    it('records all credit operations', async () => {
      // Perform operations
      const res1 = await t.mutation(api.credits.reserve, {
        userId,
        amount: 20,
        operation: 'search',
      });
      await t.mutation(api.credits.commit, { reservationId: res1._id });

      const res2 = await t.mutation(api.credits.reserve, {
        userId,
        amount: 15,
        operation: 'enrichment',
      });
      await t.mutation(api.credits.rollback, {
        reservationId: res2._id,
        reason: 'Test rollback',
      });

      // Check transaction history
      const transactions = await t.query(api.credits.getTransactions, {
        userId,
      });

      expect(transactions).toHaveLength(4); // 2 reserves + 1 commit + 1 rollback
      expect(transactions.filter(t => t.type === 'reserve')).toHaveLength(2);
      expect(transactions.filter(t => t.type === 'commit')).toHaveLength(1);
      expect(transactions.filter(t => t.type === 'rollback')).toHaveLength(1);
    });
  });
});
```

### Example 4: Python Agent Test

```python
# apps/langgraph-worker/tests/test_business_intelligence.py
import pytest
from unittest.mock import Mock, patch, AsyncMock
from app.langgraph.nodes.business_intelligence_agent import (
    business_intelligence_node,
    BusinessIntelligenceState
)
from app.langgraph.state import EmailGenerationState

@pytest.fixture
def sample_lead():
    return {
        "businessName": "TechFlow Solutions",
        "website": "https://techflowsolutions.com",
        "category": "Software Company",
        "location": "San Francisco, CA"
    }

@pytest.fixture
def sample_profile():
    return {
        "companyName": "AI Consulting Co",
        "valueProposition": "We help businesses automate with AI",
        "services": ["AI Consulting", "Automation"],
        "targetMarkets": ["B2B", "SaaS"]
    }

@pytest.fixture
def initial_state(sample_lead, sample_profile):
    return EmailGenerationState(
        lead=sample_lead,
        profile=sample_profile,
        research_tier="comprehensive",
        business_context={},
        research_sources=[],
        relevance_score=0.0,
        pain_points=[],
        value_matches=[],
        email_content="",
        quality_score=0.0,
        quality_feedback="",
        processing_times={},
        errors=[],
        stage="business_intelligence"
    )

class TestBusinessIntelligenceAgent:

    @pytest.mark.asyncio
    @patch('app.utils.research_clients.tavily_client.search')
    async def test_basic_research_tier(self, mock_tavily, initial_state, sample_lead):
        """Test basic tier research using Tavily"""
        # Mock Tavily response
        mock_tavily.return_value = {
            "results": [
                {
                    "title": "TechFlow Solutions - Company Overview",
                    "content": "TechFlow provides software automation...",
                    "url": "https://example.com/techflow"
                }
            ]
        }

        # Update state to basic tier
        initial_state.research_tier = "basic"

        # Execute agent
        result = await business_intelligence_node(initial_state)

        # Assertions
        assert result["business_context"] is not None
        assert len(result["research_sources"]) > 0
        assert result["research_sources"][0]["tier"] == "basic"
        assert result["research_sources"][0]["provider"] == "tavily"
        assert "processing_times" in result
        assert result["processing_times"]["business_intelligence"] < 15.0  # Should be fast

        # Verify Tavily was called with correct query
        mock_tavily.assert_called_once()
        call_args = mock_tavily.call_args[0][0]
        assert "TechFlow Solutions" in call_args
        assert "Software Company" in call_args

    @pytest.mark.asyncio
    @patch('app.utils.research_clients.perplexity_client.generate')
    @patch('app.utils.research_clients.tavily_client.search')
    async def test_comprehensive_research_tier(
        self,
        mock_tavily,
        mock_perplexity,
        initial_state
    ):
        """Test comprehensive tier using Tavily + Perplexity"""
        # Mock responses
        mock_tavily.return_value = {
            "results": [
                {"title": "Basic info", "content": "Quick overview", "url": "https://example.com"}
            ]
        }

        mock_perplexity.return_value = {
            "choices": [{
                "message": {
                    "content": """
                    # TechFlow Solutions Business Analysis

                    ## Company Overview
                    TechFlow Solutions is a mid-sized software company specializing in automation...

                    ## Key Challenges
                    - Manual processes slowing growth
                    - Scaling infrastructure
                    - High support costs

                    ## Technology Stack
                    React, Node.js, AWS infrastructure
                    """
                }
            }],
            "citations": ["https://techflow.com", "https://news.example.com/techflow"]
        }

        # Execute agent
        result = await business_intelligence_node(initial_state)

        # Assertions
        assert result["business_context"]["company_overview"] is not None
        assert len(result["research_sources"]) >= 2  # Tavily + Perplexity
        assert any(s["provider"] == "perplexity" for s in result["research_sources"])
        assert any(s["tier"] == "comprehensive" for s in result["research_sources"])
        assert result["processing_times"]["business_intelligence"] < 20.0

        # Verify both services were called
        mock_tavily.assert_called_once()
        mock_perplexity.assert_called_once()

    @pytest.mark.asyncio
    async def test_relevance_analysis(self, initial_state):
        """Test relevance scoring and pain point identification"""
        # Mock successful research
        initial_state.business_context = {
            "company_overview": "Software company with manual processes",
            "challenges": ["Manual workflows", "Scaling issues"],
            "tech_stack": ["React", "Node.js"]
        }

        result = await business_intelligence_node(initial_state)

        # Should extract pain points
        assert len(result["pain_points"]) > 0
        assert any("manual" in p.lower() for p in result["pain_points"])

        # Should calculate relevance score
        assert result["relevance_score"] > 0.0
        assert result["relevance_score"] <= 1.0

    @pytest.mark.asyncio
    async def test_value_matching(self, initial_state, sample_profile):
        """Test value proposition matching"""
        initial_state.business_context = {
            "challenges": ["Manual processes", "Need automation"],
            "goals": ["Improve efficiency", "Scale operations"]
        }

        result = await business_intelligence_node(initial_state)

        # Should identify value matches
        assert len(result["value_matches"]) > 0
        assert any("automat" in v.lower() for v in result["value_matches"])

    @pytest.mark.asyncio
    @patch('app.utils.research_clients.tavily_client.search')
    async def test_error_handling_research_failure(self, mock_tavily, initial_state):
        """Test graceful handling of research API failures"""
        # Mock API failure
        mock_tavily.side_effect = Exception("API timeout")

        result = await business_intelligence_node(initial_state)

        # Should handle error gracefully
        assert len(result["errors"]) > 0
        assert any("research" in e.lower() for e in result["errors"])
        assert result["business_context"] == {}  # Empty but present
        assert result["relevance_score"] == 0.0

    @pytest.mark.asyncio
    async def test_performance_tracking(self, initial_state):
        """Test that performance metrics are recorded"""
        result = await business_intelligence_node(initial_state)

        assert "processing_times" in result
        assert "business_intelligence" in result["processing_times"]
        assert isinstance(result["processing_times"]["business_intelligence"], float)
        assert result["processing_times"]["business_intelligence"] > 0

    @pytest.mark.asyncio
    @patch('app.utils.research_clients.tavily_client.search')
    async def test_caching_duplicate_research(self, mock_tavily, initial_state, sample_lead):
        """Test that duplicate research requests are cached"""
        mock_tavily.return_value = {"results": [{"title": "Test", "content": "Content"}]}

        # First call
        await business_intelligence_node(initial_state)
        first_call_count = mock_tavily.call_count

        # Second call with same lead
        await business_intelligence_node(initial_state)
        second_call_count = mock_tavily.call_count

        # Should use cache, not make additional API calls
        assert second_call_count == first_call_count
```

---

## Testing Best Practices

### 1. Test Organization

```
apps/web/src/
├── components/
│   ├── __tests__/           # Component tests
│   │   ├── CreditManager.test.tsx
│   │   └── LeadSearchHistory.test.tsx
│   ├── CreditManager.tsx
│   └── LeadSearchHistory.tsx
├── hooks/
│   ├── __tests__/           # Hook tests
│   │   ├── useAuth.test.ts
│   │   └── useBilling.test.ts
│   ├── useAuth.ts
│   └── useBilling.ts
├── utils/
│   ├── __tests__/           # Utility tests
│   │   ├── formatters.test.ts
│   │   └── validators.test.ts
│   ├── formatters.ts
│   └── validators.ts
└── __tests__/
    └── integration/         # Integration tests
        ├── search-flow.test.tsx
        └── credit-purchase.test.tsx
```

### 2. Naming Conventions

- **Test files**: `[ComponentName].test.tsx` or `[moduleName].test.ts`
- **Test suites**: `describe('[ComponentName] | [Feature]', () => {})`
- **Test cases**: `it('[should] do something specific', () => {})`
- **Mocks**: `mock[ServiceName]` or `[functionName]Mock`

### 3. Test Structure (AAA Pattern)

```typescript
it('updates user profile successfully', async () => {
  // Arrange - Set up test data and mocks
  const mockProfile = { name: 'John Doe', email: 'john@example.com' };
  const updateProfile = vi.fn().mockResolvedValue({ success: true });

  // Act - Perform the action being tested
  render(<ProfileEditor onUpdate={updateProfile} />);
  await userEvent.type(screen.getByLabelText(/name/i), 'John Doe');
  await userEvent.click(screen.getByRole('button', { name: /save/i }));

  // Assert - Verify the expected outcome
  await waitFor(() => {
    expect(updateProfile).toHaveBeenCalledWith(expect.objectContaining({
      name: 'John Doe'
    }));
  });
});
```

### 4. Test Data Management

Create reusable test factories:

```typescript
// apps/web/src/test/factories.ts
export const createMockUser = (overrides = {}) => ({
  _id: 'user-1',
  email: 'test@example.com',
  credits: 100,
  plan: 'professional',
  role: 'user',
  ...overrides
});

export const createMockSearch = (overrides = {}) => ({
  _id: 'search-1',
  userId: 'user-1',
  status: 'completed',
  parameters: { location: 'San Francisco', keywords: ['AI'] },
  ...overrides
});
```

### 5. Mock Management

**Prefer function-level mocks over global mocks when possible**:

```typescript
// Good - Scoped mock
describe('CreditManager', () => {
  it('handles purchase', () => {
    const purchaseCredits = vi.fn();
    mockUseCredits.mockReturnValue({ purchaseCredits });
    // ... test logic
  });
});

// Avoid - Global mock affecting all tests
vi.mock('@/hooks/useBilling', () => ({
  useCredits: () => ({ purchaseCredits: vi.fn() })
}));
```

### 6. Async Testing

**Always use proper async utilities**:

```typescript
// Good
await waitFor(() => {
  expect(screen.getByText(/success/i)).toBeInTheDocument();
});

// Avoid
setTimeout(() => {
  expect(screen.getByText(/success/i)).toBeInTheDocument();
}, 1000);
```

### 7. Accessibility Testing

**Include accessibility checks in component tests**:

```typescript
import { axe, toHaveNoViolations } from 'jest-axe';
expect.extend(toHaveNoViolations);

it('has no accessibility violations', async () => {
  const { container } = render(<CreditManager currentCredits={100} />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

---

## CI/CD Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/test.yml
name: Test Suite

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  frontend-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install

      - name: Run frontend tests
        run: cd apps/web && pnpm test:coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./apps/web/coverage/coverage-final.json
          flags: frontend

  backend-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install dependencies
        run: cd apps/convex-backend && pnpm install

      - name: Run backend tests
        run: cd apps/convex-backend && pnpm test:coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./apps/convex-backend/coverage/coverage-final.json
          flags: backend

  python-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: 'pip'

      - name: Install dependencies
        run: |
          cd apps/langgraph-worker
          pip install -r requirements.txt
          pip install -r requirements-dev.txt

      - name: Run Python tests
        run: cd apps/langgraph-worker && pytest --cov=app --cov-report=xml

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./apps/langgraph-worker/coverage.xml
          flags: python
```

---

## Success Metrics

### Coverage Targets

| Layer | Current | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|-------|---------|---------|---------|---------|---------|
| Frontend Components | ~5% | 40% | 55% | 70% | 85% |
| Frontend Hooks | 0% | 60% | 75% | 85% | 90% |
| Backend Functions | 0% | 35% | 60% | 75% | 85% |
| Python Agents | 0% | 0% | 50% | 70% | 85% |
| **Overall** | ~2% | 35% | 55% | 70% | 85% |

### Quality Metrics

- **Test Execution Time**: <30s for unit tests, <2min for integration tests
- **Test Stability**: >99% pass rate on CI
- **Code Coverage**: 85% for critical paths, 70% overall
- **Mutation Testing**: 70% mutation score (future enhancement)

### Business Impact

- **Regression Reduction**: 80% fewer production bugs
- **Development Speed**: 30% faster feature development (confidence in changes)
- **Onboarding Time**: 50% faster for new developers (tests as documentation)
- **Code Review Time**: 40% faster (tests validate behavior)

---

## Next Steps

### Immediate Actions (This Week)

1. **Review this plan** with the team
2. **Set up Convex testing infrastructure**
3. **Install Python testing dependencies**
4. **Create test factory utilities** for frontend
5. **Implement first 3 high-priority tests**:
   - `CreditManager.test.tsx`
   - `useAuth.test.ts`
   - `transactions.test.ts`

### Questions to Answer

1. What's our target code coverage threshold for blocking merges?
2. Should we run tests on pre-commit hooks (Husky)?
3. Do we need visual regression testing (Percy, Chromatic)?
4. Should we implement contract testing between frontend and backend?
5. What's our approach to end-to-end testing with real AI models?

---

## Resources

### Documentation
- [Vitest Documentation](https://vitest.dev/)
- [React Testing Library](https://testing-library.com/react)
- [Convex Testing Guide](https://docs.convex.dev/testing)
- [Pytest Documentation](https://docs.pytest.org/)

### Tools
- [Testing Library Playground](https://testing-playground.com/)
- [Mock Service Worker](https://mswjs.io/) - API mocking
- [Storybook](https://storybook.js.org/) - Component development
- [Playwright](https://playwright.dev/) - E2E testing (future)

---

**Document Version**: 1.0
**Last Updated**: 2025-01-10
**Author**: AI Testing Consultant
**Status**: Ready for Review
