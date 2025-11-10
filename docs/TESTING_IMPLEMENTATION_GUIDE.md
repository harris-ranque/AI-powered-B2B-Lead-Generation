# Testing Implementation Guide - Quick Start

This guide provides step-by-step instructions to implement the testing framework across the Genni platform.

## Table of Contents

1. [Quick Start (15 minutes)](#quick-start-15-minutes)
2. [Frontend Testing Setup](#frontend-testing-setup)
3. [Backend Testing Setup](#backend-testing-setup)
4. [Python Testing Setup](#python-testing-setup)
5. [Your First Tests](#your-first-tests)
6. [Running Tests](#running-tests)
7. [Debugging Failed Tests](#debugging-failed-tests)

---

## Quick Start (15 minutes)

### 1. Verify Current Setup

```bash
# Check frontend testing works
cd apps/web
pnpm test

# Expected: 2 tests pass (GenniApp, PipelineProgressPanel)
```

### 2. Install Additional Dependencies

```bash
# Frontend (if needed)
cd apps/web
pnpm add -D @testing-library/user-event@^14.5.2 vitest-mock-extended@^1.3.1

# Backend (new setup)
cd ../../apps/convex-backend
pnpm add -D vitest@^1.3.1 @vitest/ui@^1.3.1 convex-test@^0.0.25

# Python (new setup)
cd ../langgraph-worker
pip install -r requirements-dev.txt  # Create this file first
```

### 3. Create Development Requirements File

Create `apps/langgraph-worker/requirements-dev.txt`:

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
httpx>=0.26.0  # For async HTTP mocking

# Code quality
mypy>=1.8.0,<2.0.0
black>=24.0.0,<25.0.0
ruff>=0.1.0,<1.0.0
```

---

## Frontend Testing Setup

### 1. Enhance Test Setup File

Edit `apps/web/src/test/setup.ts` to add test utilities:

```typescript
// Add to existing setup.ts
import { vi } from 'vitest'
import '@testing-library/jest-dom'

// Re-export testing utilities for convenience
export { render, screen, fireEvent, waitFor } from '@testing-library/react'
export { default as userEvent } from '@testing-library/user-event'

// Test ID helpers
export const testIds = {
  creditManager: 'credit-manager',
  searchForm: 'search-form',
  leadCard: 'lead-card',
  pipelineProgress: 'pipeline-progress',
  // Add more as needed
}

// Common test utilities
export const waitForLoadingToFinish = () =>
  waitFor(() => expect(screen.queryByText(/loading/i)).not.toBeInTheDocument())

export const expectNoErrors = () =>
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
```

### 2. Create Test Factory File

Create `apps/web/src/test/factories.ts`:

```typescript
import type { Id } from '@genni/convex-types/dataModel'
import type { User, Profile, Search, Lead } from '@/lib/types'

export const createMockUser = (overrides: Partial<User> = {}): User => ({
  _id: 'user-1' as Id<'users'>,
  clerkId: 'clerk-user-1',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  credits: 100,
  plan: 'professional',
  role: 'user',
  isActive: true,
  emailVerified: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
})

export const createMockProfile = (overrides: Partial<Profile> = {}): Profile => ({
  _id: 'profile-1' as Id<'businessProfiles'>,
  userId: 'user-1' as Id<'users'>,
  companyName: 'Test Company',
  industry: 'Technology',
  valueProposition: 'We help businesses grow',
  services: ['Consulting', 'Development'],
  targetMarkets: ['B2B', 'SaaS'],
  keyDifferentiators: ['Fast', 'Reliable'],
  contactInfo: {
    name: 'Test User',
    email: 'hello@test.com',
    phone: '+1-555-0123',
    website: 'https://test.com',
  },
  isComplete: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
})

export const createMockSearch = (overrides: Partial<Search> = {}): Search => ({
  _id: 'search-1' as Id<'searches'>,
  userId: 'user-1' as Id<'users'>,
  name: 'Test Search',
  parameters: {
    location: 'San Francisco, CA',
    radius: 25,
    keywords: ['SaaS', 'technology'],
    maxResults: 50,
  },
  status: 'completed',
  progress: {
    discovered: 25,
    enriched: 20,
    analyzed: 15,
    total: 25,
  },
  results: {
    totalFound: 25,
    enrichedCount: 20,
    analyzedCount: 15,
    avgRelevanceScore: 0.78,
  },
  creditsReserved: 20,
  creditsUsed: 15,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  completedAt: Date.now(),
  ...overrides,
} as Search)

export const createMockLead = (overrides: Partial<Lead> = {}): Lead => ({
  _id: 'lead-1' as Id<'leads'>,
  searchId: 'search-1' as Id<'searches'>,
  userId: 'user-1' as Id<'users'>,
  businessName: 'TechFlow Solutions',
  address: '123 Tech St, San Francisco, CA 94105',
  phone: '+1-555-0123',
  website: 'https://techflow.com',
  rating: 4.5,
  reviewCount: 42,
  category: 'Software Company',
  placeId: 'test-place-id',
  location: {
    lat: 37.7749,
    lng: -122.4194,
    formattedAddress: '123 Tech St, San Francisco, CA 94105',
    city: 'San Francisco',
    state: 'CA',
    country: 'USA',
    postalCode: '94105',
  },
  enrichmentStatus: 'completed',
  contactInfo: {
    emails: [{
      email: 'contact@techflow.com',
      type: 'general',
      confidence: 0.9,
    }],
    contacts: [{
      name: 'Sarah Chen',
      title: 'CEO',
      email: 'sarah@techflow.com',
      confidence: 0.85,
    }],
  },
  aiAnalysis: {
    relevanceScore: 0.92,
    painPoints: ['Manual processes', 'Scaling challenges'],
    valueMatches: ['Automation', 'AI solutions'],
    confidence: 0.88,
    processingTime: 12.5,
  },
  status: 'qualified',
  tags: ['high-priority'],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
} as Lead)

// Batch creation helpers
export const createMockLeads = (count: number): Lead[] =>
  Array.from({ length: count }, (_, i) =>
    createMockLead({
      _id: `lead-${i + 1}` as Id<'leads'>,
      businessName: `Business ${i + 1}`,
    })
  )

export const createMockSearches = (count: number): Search[] =>
  Array.from({ length: count }, (_, i) =>
    createMockSearch({
      _id: `search-${i + 1}` as Id<'searches'>,
      name: `Search ${i + 1}`,
    })
  )
```

### 3. Create Render Helper

Create `apps/web/src/test/renderWithProviders.tsx`:

```typescript
import React, { ReactElement } from 'react'
import { render, RenderOptions } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Create a test query client
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        cacheTime: 0,
      },
    },
  })

interface AllTheProvidersProps {
  children: React.ReactNode
}

const AllTheProviders: React.FC<AllTheProvidersProps> = ({ children }) => {
  const queryClient = createTestQueryClient()

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => render(ui, { wrapper: AllTheProviders, ...options })

export * from '@testing-library/react'
export { customRender as render }
```

---

## Backend Testing Setup

### 1. Configure Vitest for Convex

Create `apps/convex-backend/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['**/*.test.ts'],
    exclude: ['node_modules', 'dist', '.git', '_generated'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'test/',
        '**/*.d.ts',
        '**/*.config.*',
        '_generated/**',
        '**/coverage/**'
      ]
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './convex'),
    },
  },
})
```

### 2. Create Test Setup

Create `apps/convex-backend/test/setup.ts`:

```typescript
import { vi } from 'vitest'
import { convexTest } from 'convex-test'
import schema from '../convex/schema'

// Initialize test Convex instance
export const testConvex = () => convexTest(schema)

// Mock external services
export const mockFindymail = vi.fn()
export const mockGoogleMaps = vi.fn()
export const mockLangGraph = vi.fn()
export const mockStripe = vi.fn()

// Mock environment variables
process.env.OPENAI_API_KEY = 'test-openai-key'
process.env.FINDYMAIL_API_KEY = 'test-findymail-key'
process.env.GOOGLE_MAPS_API_KEY = 'test-maps-key'
process.env.LANGGRAPH_API_KEY = 'test-langgraph-key'
process.env.STRIPE_SECRET_KEY = 'sk_test_123'

// Setup global mocks
vi.mock('openai', () => ({
  OpenAI: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'Test response' } }]
        })
      }
    }
  }))
}))
```

### 3. Create Test Factories

Create `apps/convex-backend/test/factories.ts`:

```typescript
import { Id } from '../convex/_generated/dataModel'

export const createTestUser = (overrides = {}) => ({
  clerkId: 'test-clerk-id',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  credits: 100,
  plan: 'professional' as const,
  role: 'user' as const,
  isActive: true,
  emailVerified: true,
  ...overrides,
})

export const createTestSearch = (userId: Id<'users'>, overrides = {}) => ({
  userId,
  name: 'Test Search',
  parameters: {
    location: 'San Francisco, CA',
    radius: 25,
    keywords: ['SaaS'],
    maxResults: 50,
  },
  status: 'in_progress' as const,
  progress: {
    discovered: 0,
    enriched: 0,
    analyzed: 0,
    total: 0,
  },
  creditsReserved: 20,
  ...overrides,
})

export const createTestLead = (
  searchId: Id<'searches'>,
  userId: Id<'users'>,
  overrides = {}
) => ({
  searchId,
  userId,
  businessName: 'Test Business',
  address: '123 Test St',
  placeId: 'test-place-id',
  location: {
    lat: 37.7749,
    lng: -122.4194,
    formattedAddress: '123 Test St, SF, CA',
    city: 'San Francisco',
    state: 'CA',
    country: 'USA',
    postalCode: '94105',
  },
  enrichmentStatus: 'pending' as const,
  status: 'new' as const,
  ...overrides,
})
```

### 4. Add Test Scripts to package.json

Edit `apps/convex-backend/package.json`:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest run --coverage"
  }
}
```

---

## Python Testing Setup

### 1. Create pytest Configuration

Create `apps/langgraph-worker/pytest.ini`:

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
    --cov-report=xml
    --asyncio-mode=auto
    --strict-markers
markers =
    unit: Unit tests
    integration: Integration tests
    slow: Slow tests that hit external APIs
    asyncio: Async tests
```

### 2. Create Test Configuration

Create `apps/langgraph-worker/tests/conftest.py`:

```python
"""Pytest configuration and shared fixtures"""
import pytest
from unittest.mock import Mock, AsyncMock, patch
from app.langgraph.state import EmailGenerationState

@pytest.fixture
def sample_lead():
    """Sample lead data for testing"""
    return {
        "businessName": "TechFlow Solutions",
        "website": "https://techflowsolutions.com",
        "category": "Software Company",
        "location": "San Francisco, CA",
        "phone": "+1-555-0123",
        "address": "123 Tech St, SF, CA 94105"
    }

@pytest.fixture
def sample_profile():
    """Sample business profile for testing"""
    return {
        "companyName": "AI Consulting Co",
        "valueProposition": "We help businesses automate with AI",
        "services": ["AI Consulting", "Automation"],
        "targetMarkets": ["B2B", "SaaS"],
        "keyDifferentiators": ["Fast", "AI-powered"]
    }

@pytest.fixture
def initial_state(sample_lead, sample_profile):
    """Initial state for workflow testing"""
    return EmailGenerationState(
        lead=sample_lead,
        profile=sample_profile,
        research_tier="basic",
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
        stage="initialization"
    )

@pytest.fixture
def mock_openai():
    """Mock OpenAI client"""
    with patch('app.utils.research_clients.openai_client') as mock:
        mock.chat.completions.create = AsyncMock(return_value={
            "choices": [{
                "message": {
                    "content": "Test AI response"
                }
            }]
        })
        yield mock

@pytest.fixture
def mock_tavily():
    """Mock Tavily search client"""
    with patch('app.utils.research_clients.tavily_client.search') as mock:
        mock.return_value = {
            "results": [{
                "title": "Test Result",
                "content": "Test content",
                "url": "https://example.com"
            }]
        }
        yield mock

@pytest.fixture
def mock_perplexity():
    """Mock Perplexity research client"""
    with patch('app.utils.research_clients.perplexity_client.generate') as mock:
        mock.return_value = {
            "choices": [{
                "message": {
                    "content": "Comprehensive business analysis"
                }
            }],
            "citations": ["https://example.com"]
        }
        yield mock

@pytest.fixture
def mock_webhook():
    """Mock webhook delivery"""
    with patch('app.utils.webhook.send_webhook') as mock:
        mock.return_value = AsyncMock(return_value={"success": True})
        yield mock

# Test markers
def pytest_configure(config):
    config.addinivalue_line("markers", "unit: Unit tests")
    config.addinivalue_line("markers", "integration: Integration tests")
    config.addinivalue_line("markers", "slow: Slow tests")
    config.addinivalue_line("markers", "asyncio: Async tests")
```

### 3. Create Test Utilities

Create `apps/langgraph-worker/tests/utils.py`:

```python
"""Test utility functions"""
from typing import Any, Dict
from app.langgraph.state import EmailGenerationState

def create_mock_research_result(
    confidence: float = 0.85,
    sources: int = 3
) -> Dict[str, Any]:
    """Create mock research result"""
    return {
        "business_context": {
            "company_overview": "Test company overview",
            "challenges": ["Challenge 1", "Challenge 2"],
            "goals": ["Goal 1", "Goal 2"]
        },
        "research_sources": [
            {
                "url": f"https://example.com/source-{i}",
                "title": f"Source {i}",
                "content": f"Content from source {i}",
                "tier": "basic",
                "provider": "tavily"
            }
            for i in range(sources)
        ],
        "confidence": confidence
    }

def create_mock_email_content(quality_score: float = 0.85) -> Dict[str, Any]:
    """Create mock email content"""
    return {
        "subject": "Transform Your Business with AI",
        "body": "Dear [Name],\n\nI noticed your company...",
        "personalization_notes": ["CEO title", "Company focus"],
        "estimated_effectiveness": quality_score
    }

def assert_state_valid(state: EmailGenerationState) -> None:
    """Assert that state is in a valid format"""
    assert isinstance(state.lead, dict)
    assert isinstance(state.profile, dict)
    assert isinstance(state.research_sources, list)
    assert isinstance(state.errors, list)
    assert 0 <= state.relevance_score <= 1
    assert 0 <= state.quality_score <= 1
```

### 4. Add Test Scripts

Add to `apps/langgraph-worker/package.json`:

```json
{
  "scripts": {
    "test": "pytest",
    "test:unit": "pytest -m unit",
    "test:integration": "pytest -m integration",
    "test:coverage": "pytest --cov-report=html",
    "test:watch": "pytest-watch"
  }
}
```

---

## Your First Tests

### Frontend: CreditManager Component Test

Create `apps/web/src/components/__tests__/CreditManager.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreditManager } from '../CreditManager'
import { useCredits } from '@/hooks/useBilling'
import { createMockUser } from '@/test/factories'

vi.mock('@/hooks/useBilling')
const mockUseCredits = vi.mocked(useCredits)

describe('CreditManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseCredits.mockReturnValue({
      balance: { credits: 150 },
      transactions: [],
      isLoading: false,
      purchaseCredits: vi.fn(),
    })
  })

  it('displays current credit balance', () => {
    render(<CreditManager currentCredits={150} />)

    expect(screen.getByText('150')).toBeInTheDocument()
    expect(screen.getByText(/credits/i)).toBeInTheDocument()
  })

  it('shows low balance warning when credits below threshold', () => {
    mockUseCredits.mockReturnValue({
      balance: { credits: 15 },
      transactions: [],
      isLoading: false,
      purchaseCredits: vi.fn(),
    })

    render(<CreditManager currentCredits={15} />)

    expect(screen.getByText(/low balance/i)).toBeInTheDocument()
  })

  it('opens purchase modal on button click', async () => {
    const user = userEvent.setup()
    render(<CreditManager currentCredits={150} />)

    const button = screen.getByRole('button', { name: /add credits/i })
    await user.click(button)

    await waitFor(() => {
      expect(screen.getByText(/purchase credits/i)).toBeInTheDocument()
    })
  })
})
```

### Backend: Credit Transaction Test

Create `apps/convex-backend/convex/credits/__tests__/transactions.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { testConvex } from '../../../test/setup'
import { createTestUser } from '../../../test/factories'
import { api } from '../../_generated/api'
import { internal } from '../../_generated/api'

describe('Credit Transactions', () => {
  let t: ReturnType<typeof testConvex>
  let userId: string

  beforeEach(async () => {
    t = testConvex()

    // Create test user
    userId = await t.mutation(internal.users.create, createTestUser())
  })

  it('reserves credits successfully', async () => {
    const reservation = await t.mutation(api.credits.reserve, {
      userId,
      amount: 25,
      operation: 'search',
    })

    expect(reservation.status).toBe('reserved')
    expect(reservation.amount).toBe(25)
  })

  it('prevents over-reservation', async () => {
    await expect(
      t.mutation(api.credits.reserve, {
        userId,
        amount: 150, // More than available
        operation: 'search',
      })
    ).rejects.toThrow(/insufficient credits/i)
  })

  it('commits reserved credits', async () => {
    const reservation = await t.mutation(api.credits.reserve, {
      userId,
      amount: 25,
      operation: 'search',
    })

    await t.mutation(api.credits.commit, {
      reservationId: reservation._id,
      actualUsed: 18,
    })

    const balance = await t.query(api.credits.getBalance, { userId })
    expect(balance.credits).toBe(82) // 100 - 18
  })
})
```

### Python: Business Intelligence Agent Test

Create `apps/langgraph-worker/tests/test_business_intelligence.py`:

```python
import pytest
from app.langgraph.nodes.business_intelligence_agent import business_intelligence_node

@pytest.mark.asyncio
@pytest.mark.unit
async def test_basic_research_tier(initial_state, mock_tavily):
    """Test basic tier research using Tavily"""
    initial_state.research_tier = "basic"

    result = await business_intelligence_node(initial_state)

    assert result["business_context"] is not None
    assert len(result["research_sources"]) > 0
    assert result["research_sources"][0]["provider"] == "tavily"
    assert result["processing_times"]["business_intelligence"] < 15.0

    # Verify Tavily was called
    mock_tavily.assert_called_once()

@pytest.mark.asyncio
@pytest.mark.unit
async def test_relevance_analysis(initial_state):
    """Test relevance scoring"""
    initial_state.business_context = {
        "challenges": ["Manual workflows", "Scaling issues"],
        "tech_stack": ["React", "Node.js"]
    }

    result = await business_intelligence_node(initial_state)

    assert len(result["pain_points"]) > 0
    assert 0 <= result["relevance_score"] <= 1.0

@pytest.mark.asyncio
@pytest.mark.unit
async def test_error_handling(initial_state, mock_tavily):
    """Test graceful error handling"""
    mock_tavily.side_effect = Exception("API timeout")

    result = await business_intelligence_node(initial_state)

    assert len(result["errors"]) > 0
    assert "research" in result["errors"][0].lower()
```

---

## Running Tests

### Frontend Tests

```bash
cd apps/web

# Run all tests
pnpm test

# Run in watch mode
pnpm test:watch

# Run with UI
pnpm test:ui

# Run with coverage
pnpm test:coverage

# Run specific test file
pnpm test CreditManager

# Run tests matching pattern
pnpm test --grep "credit"
```

### Backend Tests

```bash
cd apps/convex-backend

# Run all tests
pnpm test

# Run in watch mode
pnpm test:watch

# Run with coverage
pnpm test:coverage

# Run specific test file
pnpm test transactions

# Run with debugging
pnpm test --inspect-brk
```

### Python Tests

```bash
cd apps/langgraph-worker

# Run all tests
pytest

# Run unit tests only
pytest -m unit

# Run integration tests only
pytest -m integration

# Run specific test file
pytest tests/test_business_intelligence.py

# Run specific test function
pytest tests/test_business_intelligence.py::test_basic_research_tier

# Run with coverage
pytest --cov

# Run with verbose output
pytest -vv

# Run and stop on first failure
pytest -x

# Run in watch mode (requires pytest-watch)
ptw
```

---

## Debugging Failed Tests

### Frontend Debugging

#### 1. Use Vitest UI

```bash
cd apps/web
pnpm test:ui
```

Opens a browser interface with:
- Interactive test runner
- Component tree visualization
- Console logs
- Test coverage

#### 2. Debug with VS Code

Add to `.vscode/launch.json`:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Vitest Tests",
  "runtimeExecutable": "pnpm",
  "runtimeArgs": ["test", "--inspect-brk", "--run"],
  "console": "integratedTerminal",
  "internalConsoleOptions": "neverOpen"
}
```

#### 3. Use screen.debug()

```typescript
it('debugs component output', () => {
  render(<MyComponent />)

  // Print entire DOM
  screen.debug()

  // Print specific element
  screen.debug(screen.getByRole('button'))

  // Print with custom depth
  screen.debug(undefined, 20000)
})
```

#### 4. Check for Async Issues

```typescript
// ❌ Bad - might fail
it('loads data', () => {
  render(<Component />)
  expect(screen.getByText('Data')).toBeInTheDocument()
})

// ✅ Good - waits for async updates
it('loads data', async () => {
  render(<Component />)
  await waitFor(() => {
    expect(screen.getByText('Data')).toBeInTheDocument()
  })
})
```

### Backend Debugging

#### 1. Add console.log()

```typescript
it('debugs credit transaction', async () => {
  const reservation = await t.mutation(api.credits.reserve, {
    userId,
    amount: 25,
    operation: 'search',
  })

  console.log('Reservation:', JSON.stringify(reservation, null, 2))

  expect(reservation.status).toBe('reserved')
})
```

#### 2. Check Mock Setup

```typescript
beforeEach(() => {
  // Verify mocks are reset
  vi.clearAllMocks()

  // Log mock calls
  mockFunction.mockImplementation((...args) => {
    console.log('Mock called with:', args)
    return 'result'
  })
})
```

### Python Debugging

#### 1. Use pytest -s for Print Output

```bash
# Show print statements
pytest -s tests/test_business_intelligence.py
```

#### 2. Use pytest --pdb for Interactive Debugging

```bash
# Drop into debugger on failure
pytest --pdb tests/test_business_intelligence.py

# Drop into debugger on first failure
pytest -x --pdb
```

#### 3. Add Breakpoints in Tests

```python
def test_complex_logic(initial_state):
    result = await business_intelligence_node(initial_state)

    # Set breakpoint
    import pdb; pdb.set_trace()

    assert result["relevance_score"] > 0.5
```

#### 4. Check Async Issues

```python
# ❌ Bad - missing await
def test_async_function():
    result = async_function()  # Returns coroutine, not result
    assert result is not None

# ✅ Good - properly awaited
@pytest.mark.asyncio
async def test_async_function():
    result = await async_function()
    assert result is not None
```

---

## Common Patterns & Solutions

### Pattern 1: Testing Form Submissions

```typescript
import userEvent from '@testing-library/user-event'

it('submits form with valid data', async () => {
  const onSubmit = vi.fn()
  const user = userEvent.setup()

  render(<SearchForm onSubmit={onSubmit} />)

  // Fill form
  await user.type(screen.getByLabelText(/location/i), 'San Francisco')
  await user.type(screen.getByLabelText(/keywords/i), 'AI')

  // Submit
  await user.click(screen.getByRole('button', { name: /search/i }))

  // Verify
  await waitFor(() => {
    expect(onSubmit).toHaveBeenCalledWith({
      location: 'San Francisco',
      keywords: 'AI'
    })
  })
})
```

### Pattern 2: Testing Async Data Loading

```typescript
it('loads and displays data', async () => {
  mockUseSearches.mockReturnValue({
    searches: [],
    isLoading: true,
  })

  const { rerender } = render(<SearchHistory />)

  // Verify loading state
  expect(screen.getByText(/loading/i)).toBeInTheDocument()

  // Update mock to loaded state
  mockUseSearches.mockReturnValue({
    searches: [createMockSearch()],
    isLoading: false,
  })

  rerender(<SearchHistory />)

  // Verify data displayed
  expect(screen.getByText('Test Search')).toBeInTheDocument()
})
```

### Pattern 3: Testing Error States

```typescript
it('displays error message on failure', async () => {
  const error = new Error('Failed to load searches')
  mockUseSearches.mockReturnValue({
    searches: [],
    isLoading: false,
    error,
  })

  render(<SearchHistory />)

  expect(screen.getByRole('alert')).toHaveTextContent(/failed to load/i)
})
```

### Pattern 4: Testing Context Providers

```typescript
import { renderWithProviders } from '@/test/renderWithProviders'

it('accesses context values', () => {
  renderWithProviders(
    <PipelineProvider>
      <ComponentUsingPipeline />
    </PipelineProvider>
  )

  // Component has access to pipeline context
  expect(screen.getByText(/pipeline stage/i)).toBeInTheDocument()
})
```

---

## Next Steps

### Week 1 Goals

1. ✅ Set up all testing infrastructure
2. ✅ Create test utilities and factories
3. ✅ Write first 3 tests per layer:
   - Frontend: `CreditManager`, `useAuth`, `formatters`
   - Backend: `transactions`, `correlation`, `validators`
   - Python: `business_intelligence`, `data_validation`, `webhook`

### Resources

- **Frontend**: [React Testing Library Docs](https://testing-library.com/react)
- **Backend**: [Convex Testing Guide](https://docs.convex.dev/testing)
- **Python**: [Pytest Documentation](https://docs.pytest.org/)
- **General**: [Testing Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)

### Getting Help

- Check existing tests: `GenniApp.test.tsx`, `PipelineProgressPanel.test.tsx`
- Review test factories in `src/test/setup.ts`
- Reference TESTING_PLAN.md for comprehensive strategy

---

**Document Version**: 1.0
**Last Updated**: 2025-01-10
**Status**: Ready to Implement
