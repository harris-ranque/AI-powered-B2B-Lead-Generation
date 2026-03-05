# Genni Platform — System Architecture

> AI-powered lead generation platform that discovers businesses, enriches contacts, and generates personalized email sequences using a multi-agent AI system.

**Last updated**: February 2025

---

## Table of Contents

1. [High-Level Overview](#high-level-overview)
2. [System Diagram](#system-diagram)
3. [Monorepo Structure](#monorepo-structure)
4. [Frontend — React SPA](#frontend--react-spa)
5. [Convex Backend — Real-Time Database & Business Logic](#convex-backend--real-time-database--business-logic)
6. [LangGraph Worker — Multi-Agent AI Service](#langgraph-worker--multi-agent-ai-service)
7. [Lead Generation Pipeline — End to End](#lead-generation-pipeline--end-to-end)
8. [Credit System — Two-Phase Commit](#credit-system--two-phase-commit)
9. [Enrichment Engine — Distributed Concurrency](#enrichment-engine--distributed-concurrency)
10. [Real-Time Broadcasting](#real-time-broadcasting)
11. [Authentication & Authorization](#authentication--authorization)
12. [Billing & Subscriptions](#billing--subscriptions)
13. [Observability & Reliability](#observability--reliability)
14. [Infrastructure & Deployment](#infrastructure--deployment)
15. [External Integrations](#external-integrations)
16. [Database Schema Overview](#database-schema-overview)

---

## High-Level Overview

Genni is a three-tier monorepo application:

| Layer | Technology | Role |
|-------|-----------|------|
| **Frontend** | React 18 + Vite + Tailwind | User interface, pipeline orchestration UI |
| **Backend** | Convex (serverless) | Real-time database, business logic, cron jobs, webhooks |
| **AI Worker** | Python FastAPI + LangGraph | Multi-agent email generation & business intelligence |

**Key characteristics**:
- Real-time reactivity via Convex subscriptions (no polling)
- Event-driven pipeline architecture with webhook-based inter-service communication
- Enterprise-grade credit management with atomic two-phase commit transactions
- Distributed concurrency control for third-party API rate limiting
- Full operation tracing via correlation IDs across the entire pipeline

---

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          USERS / BROWSERS                          │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTPS
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     FRONTEND (React + Vite)                         │
│  Railway · Port 3000 · Nginx                                        │
│                                                                     │
│  ┌──────────┐ ┌──────────────┐ ┌───────────┐ ┌──────────────────┐  │
│  │  Clerk   │ │  Pipeline    │ │ Dashboard │ │  Admin Panel     │  │
│  │  Auth    │ │  Orchestrator│ │ & Export  │ │  & Billing       │  │
│  └──────────┘ └──────────────┘ └───────────┘ └──────────────────┘  │
│         │              │              │               │             │
│         └──────────────┴──────────────┴───────────────┘             │
│                        Convex React SDK                             │
│                   (useQuery / useMutation / useAction)              │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ WebSocket (real-time sync)
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   CONVEX BACKEND (Serverless)                       │
│  Convex Cloud · Real-time Database                                  │
│                                                                     │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────────┐  │
│  │  Search    │ │  Lead      │ │  Credit    │ │  Billing       │  │
│  │  Pipeline  │ │  Enrichment│ │  System    │ │  (Stripe)      │  │
│  │  Orchestr. │ │  (FindyMail│ │  2-Phase   │ │                │  │
│  └─────┬──────┘ └─────┬──────┘ └────────────┘ └────────────────┘  │
│        │              │                                             │
│  ┌─────┴──────┐ ┌─────┴──────┐ ┌────────────┐ ┌────────────────┐  │
│  │  Rate      │ │  Retry &   │ │  Real-Time │ │  Correlation   │  │
│  │  Limiting  │ │  Dead      │ │  Broadcast │ │  Logging       │  │
│  │  Engine    │ │  Letter Q  │ │  System    │ │  System        │  │
│  └────────────┘ └────────────┘ └────────────┘ └────────────────┘  │
│                                                                     │
│  15 Cron Jobs · HTTP Endpoints · Clerk/Stripe/LangGraph Webhooks   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTP + Webhooks
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  LANGGRAPH WORKER (Python FastAPI)                   │
│  Railway · Port 8080 · Gunicorn + Uvicorn                           │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                   LangGraph Workflow                          │   │
│  │                                                              │   │
│  │  ┌──────────────┐   ┌──────────────┐   ┌────────────────┐  │   │
│  │  │  Business    │──▶│  Email       │──▶│  Quality       │  │   │
│  │  │  Intelligence│   │  Generation  │   │  Assurance     │  │   │
│  │  │  Agent       │   │  Agent       │   │  Agent         │  │   │
│  │  │  (8-12s)     │   │  (10-15s)    │   │  (5-8s)        │  │   │
│  │  └──────────────┘   └──────────────┘   └────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Adaptive Rate Limiting · Concurrent Request Handler (500+ req)     │
│  Structured Output Retry · PostHog + Sentry Observability           │
└─────────────────────────────────────────────────────────────────────┘

                        EXTERNAL SERVICES
    ┌──────────┐ ┌──────────┐ ┌────────┐ ┌────────┐ ┌─────────┐
    │ Google   │ │ FindyMail│ │ OpenAI │ │ Tavily │ │Perplexity│
    │ Maps API │ │ API      │ │ API    │ │ API    │ │ API      │
    └──────────┘ └──────────┘ └────────┘ └────────┘ └─────────┘
    ┌──────────┐ ┌──────────┐ ┌────────┐ ┌────────┐
    │ Stripe   │ │ Clerk    │ │PostHog │ │ Sentry │
    │ Payments │ │ Auth     │ │Analytics│ │ Errors │
    └──────────┘ └──────────┘ └────────┘ └────────┘
```

---

## Monorepo Structure

Managed by **Turborepo** with **pnpm workspaces**.

```
genni/
├── apps/
│   ├── web/                        # React frontend (Vite)
│   ├── langgraph-worker/           # Python FastAPI AI service
│   └── convex-backend/             # Convex serverless backend
│       └── convex/                 # All backend functions & schema
├── packages/
│   ├── shared-types/               # Manual shared TypeScript types
│   └── convex-types/               # Auto-generated Convex API types (symlinked)
├── scripts/                        # Build, test, deploy, sync utilities
├── turbo.json                      # Task pipeline configuration
├── pnpm-workspace.yaml             # Workspace definitions
└── package.json                    # Root scripts & workspace config
```

**Turbo pipeline**: `build` depends on `^build + test`. Dev servers are persistent and non-cached. Global cache invalidation on `.env.*local` changes.

**Type sharing**: `@genni/convex-types` is symlinked from `apps/convex-backend/convex/_generated/`, giving the frontend type-safe access to all backend queries, mutations, and actions.

---

## Frontend — React SPA

### Technology Stack

| Concern | Technology |
|---------|-----------|
| Framework | React 18 + TypeScript |
| Build | Vite 5 with SWC plugin |
| Styling | Tailwind CSS 3.4 + shadcn/ui (25+ Radix primitives) |
| Routing | React Router DOM 6 |
| State | Convex reactive queries + React Context + TanStack Query |
| Forms | React Hook Form + Zod validation |
| Auth | Clerk React SDK |
| Analytics | PostHog (autocapture + session replay) |
| Errors | Sentry React SDK |
| Testing | Vitest (unit) + Playwright (E2E) |

### Application Structure

```
src/
├── main.tsx                    # Sentry init → PostHog → Theme → Render
├── App.tsx                     # Route definitions + provider nesting
├── components/
│   ├── ui/                     # 25+ shadcn/ui primitives
│   ├── auth/                   # LoginForm, SignUpForm, ProtectedRoute, AdminRoute
│   ├── pipeline/               # 4-stage lead gen orchestrator
│   │   ├── PipelineOrchestrator.tsx
│   │   ├── LeadDiscoveryStage.tsx      (Google Maps)
│   │   ├── EnrichmentStage.tsx         (FindyMail)
│   │   ├── EmailGenerationStage.tsx    (LangGraph AI)
│   │   └── ReviewExportStage.tsx       (CSV export)
│   ├── billing/                # Credit purchase, subscription management
│   ├── settings/               # User preferences
│   ├── admin/                  # Admin dashboard & controls
│   └── providers/              # ConvexProvider, AuthAnalyticsProvider
├── hooks/                      # 22 custom hooks
│   ├── useAuth.ts              # Clerk + Convex user sync with webhook timeout
│   ├── useSearches.ts          # Search CRUD with real-time updates
│   ├── useLeads.ts             # Lead queries with pagination
│   ├── useCredits.ts           # Balance & transaction tracking
│   ├── useBilling.ts           # Stripe/subscription data
│   ├── useAnalytics.ts         # PostHog wrapper (40+ typed event methods)
│   └── useStatusBroadcasts.ts  # Real-time pipeline progress
├── contexts/
│   ├── UserDataContext.tsx      # Centralized user data (searches, leads, broadcasts)
│   └── pipeline/context.tsx    # Pipeline state machine (useReducer)
├── lib/
│   ├── convex.ts               # ConvexReactClient + Clerk integration
│   └── env-validation.ts       # Runtime env var validation with fallbacks
└── utils/
    ├── logger.ts               # Scoped logging with correlation IDs
    └── errorHandling.tsx        # Error boundary HOC
```

### Provider Nesting Order

```
GlobalErrorBoundary
  → ConvexProvider (Clerk + Convex)
    → AuthAnalyticsProvider (PostHog identification)
      → QueryClientProvider (TanStack)
        → TooltipProvider (shadcn)
          → BrowserRouter → Routes
```

### Data Flow Pattern

The frontend uses Convex's reactive subscription model — no REST calls or polling:

```typescript
// Read: auto-updates when backend data changes
const searches = useQuery(api.search.queries.getUserSearches);

// Write: optimistic updates with server validation
const createSearch = useMutation(api.search.mutations.createSearch);

// Async operations: triggers backend actions
const startPipeline = useAction(api.search.actions.searchGoogleMaps);
```

### Route Structure

| Route | Component | Access |
|-------|-----------|--------|
| `/` | LandingPage | Public |
| `/signin`, `/signup` | Clerk auth forms | Public |
| `/app` | GenniApp (dashboard) | Protected |
| `/app/*` | Pipeline, settings, etc. | Protected |
| `/admin` | AdminDashboard | Admin only |
| `/subscription/success` | Post-purchase confirmation | Protected |

---

## Convex Backend — Real-Time Database & Business Logic

### Architecture

Convex provides a serverless real-time database with colocated business logic. All backend functions (queries, mutations, actions) live in the `convex/` directory and execute on Convex Cloud.

```
convex/
├── schema.ts                   # 30+ tables, ~2000 lines
├── http.ts                     # Webhook endpoints (Clerk, Stripe, LangGraph)
├── crons.ts                    # 15 scheduled jobs
├── auth.ts                     # Clerk JWT verification
│
├── search/                     # Discovery pipeline
│   ├── mutations.ts            # Create, update, cancel, delete searches
│   ├── queries.ts              # List, get search data
│   ├── actions.ts              # Google Maps discovery (tiling algorithm)
│   ├── orchestrator.ts         # Pipeline state machine coordination
│   ├── googlePlaces.ts         # Google Places API integration
│   ├── batchProcessor.ts       # Dynamic batch sizing
│   └── monitoring.ts           # Stuck search detection
│
├── leads/
│   ├── mutations.ts            # Lead CRUD operations
│   ├── queries.ts              # Lead listing with pagination
│   ├── asyncEnrichment.ts      # FindyMail integration (64K, enterprise-grade)
│   └── internal.ts             # Internal helpers (dedup, queue)
│
├── langgraph/
│   ├── actions.ts              # HTTP calls to LangGraph worker
│   └── webhooks.ts             # Process AI analysis results
│
├── credits/
│   └── transactions.ts         # Two-phase commit credit system
│
├── billing/
│   ├── stripe.ts               # Stripe checkout, subscriptions
│   ├── webhooks.ts             # Stripe event processing
│   └── credits.ts              # Credit allocation & expiry
│
├── rateLimit/                  # Multi-tier rate limiting
├── realtime/                   # Priority broadcasting system
├── retries/                    # Exponential backoff retry engine
├── admin/                      # Admin queries, metrics, exports
├── notifications/              # Email notifications
│
└── lib/
    ├── correlation.ts          # Correlation ID system
    ├── logging.ts              # Persistent structured logging
    └── helpers.ts              # Shared utilities
```

### Function Types

| Type | Purpose | Execution |
|------|---------|-----------|
| **Queries** | Read data, reactive subscriptions | Deterministic, cached, re-run on data changes |
| **Mutations** | Write data, transactional | ACID, automatic conflict resolution |
| **Actions** | External API calls, side effects | Non-transactional, can call queries/mutations |
| **Internal** | Backend-only functions | Not callable from frontend |
| **HTTP** | Webhook endpoints | Stateless request/response |
| **Crons** | Scheduled tasks | Time-based execution |

---

## LangGraph Worker — Multi-Agent AI Service

### Technology Stack

| Concern | Technology |
|---------|-----------|
| Framework | FastAPI 0.109 (async) |
| Server | Gunicorn 23 + Uvicorn (4 workers) |
| AI Orchestration | LangGraph 0.2 |
| LLM | OpenAI via LangChain 0.3 |
| Research | Tavily (fast) + Perplexity (deep) |
| Validation | Pydantic 2.8 |
| Monitoring | Sentry + PostHog (with LangChain callback) |

### Three-Agent Pipeline

Each lead goes through three specialized agents in sequence (~25-30 seconds total):

```
┌─────────────────────────────────────────────────────┐
│              LANGGRAPH WORKFLOW                       │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  1. BUSINESS INTELLIGENCE AGENT  (8-12s)      │  │
│  │                                               │  │
│  │  • Tiered research: Tavily → Perplexity       │  │
│  │  • Pain point identification                  │  │
│  │  • Competitive landscape analysis             │  │
│  │  • Lead qualification & relevance scoring     │  │
│  └───────────────────┬───────────────────────────┘  │
│                      ▼                               │
│  ┌───────────────────────────────────────────────┐  │
│  │  2. EMAIL GENERATION AGENT  (10-15s)          │  │
│  │                                               │  │
│  │  • Personalized subject + body                │  │
│  │  • Value proposition matching                 │  │
│  │  • Follow-up sequence planning (3-5 emails)   │  │
│  │  • Industry-specific messaging                │  │
│  └───────────────────┬───────────────────────────┘  │
│                      ▼                               │
│  ┌───────────────────────────────────────────────┐  │
│  │  3. QUALITY ASSURANCE AGENT  (5-8s)           │  │
│  │                                               │  │
│  │  • Multi-dimensional scoring (0-1)            │  │
│  │  • Personalization depth check                │  │
│  │  • Professional tone validation               │  │
│  │  • Improvement recommendations                │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Worker Architecture

```
app/
├── main.py                         # FastAPI app, middleware, health check
├── routers/
│   └── generate.py                 # POST /generate endpoint
├── langgraph/
│   ├── graph.py                    # LangGraph workflow definition
│   ├── state.py                    # EmailGenerationState TypedDict
│   └── nodes/
│       ├── business_intelligence.py  # Research & analysis agent
│       ├── email_generator.py        # Email composition agent
│       ├── quality_assurance.py      # Quality scoring agent
│       └── aggregator.py            # Result compilation
├── models/
│   └── lead_models.py              # Pydantic models for all data shapes
├── services/
│   └── webhook_service.py          # Callback to Convex on completion
└── utils/
    ├── rate_limiting/              # Adaptive rate limiter
    │   ├── manager.py              # Central rate limit manager
    │   ├── token_bucket.py         # Token bucket algorithm
    │   ├── adaptive.py             # ML-style limit adjustments
    │   └── request_queue.py        # Priority request queue
    ├── concurrent_handler.py       # 500+ concurrent request handler
    ├── structured_output_retry.py  # LLM structured output retry
    ├── logger.py                   # Structured logging
    └── analytics.py                # PostHog event capture
```

### Communication Pattern

```
Convex Backend                        LangGraph Worker
     │                                      │
     │  POST /generate                      │
     │  {leadId, businessProfile, lead,     │
     │   providers (BYOK keys)}             │
     │─────────────────────────────────────▶│
     │                                      │
     │           (25-30s processing)        │
     │                                      │
     │  POST /langgraph/webhook             │
     │  {request_id, status, result: {      │
     │    relevance_score, pain_points,     │
     │    primary_email, follow_ups,        │
     │    research_tier, lead_tier}}        │
     │◀─────────────────────────────────────│
     │                                      │
     │  Store results in leads table        │
     │  Broadcast completion to frontend    │
```

### Enterprise Features

- **BYOK (Bring Your Own Key)**: Enterprise users can provide their own API keys for OpenAI, Tavily, Perplexity, FindyMail, etc. Keys are encrypted at rest and decrypted only during processing.
- **Adaptive concurrency**: `ResourceMonitor` class uses `psutil` to dynamically adjust max concurrency (10-200) based on CPU and memory usage.
- **Structured output retry**: Automatic retry with exponential backoff for transient LLM failures (empty responses, YAML instead of JSON).

---

## Lead Generation Pipeline — End to End

### Pipeline Stages

```
USER                  CONVEX BACKEND                    EXTERNAL SERVICES
 │                         │                                  │
 │  Create Search          │                                  │
 │────────────────────────▶│                                  │
 │                         │                                  │
 │                    ┌────┴────┐                              │
 │                    │ RESERVE │ Credit reservation           │
 │                    │ CREDITS │ (two-phase commit)           │
 │                    └────┬────┘                              │
 │                         │                                  │
 │  ◀─ progress: 0%  ┌────┴────┐    Google Maps API          │
 │                    │DISCOVERY│─────────────────────────────▶│
 │  ◀─ progress: 25% │ (tiling)│◀─────────────────────────────│
 │                    └────┬────┘    Places + Details          │
 │                         │                                  │
 │                    ┌────┴────┐    FindyMail API            │
 │  ◀─ progress: 50% │ ENRICH  │─────────────────────────────▶│
 │                    │ (batch) │◀─────────────────────────────│
 │                    └────┬────┘    Emails + Contacts         │
 │                         │                                  │
 │                    ┌────┴────┐    LangGraph Worker          │
 │  ◀─ progress: 75% │ANALYSIS │─────────────────────────────▶│
 │                    │ (AI)    │◀───── webhook ───────────────│
 │                    └────┬────┘    Emails + Scores           │
 │                         │                                  │
 │                    ┌────┴────┐                              │
 │  ◀─ progress: 100%│COMPLETE │ Commit credits               │
 │                    │         │ Final broadcast              │
 │                    └────┬────┘                              │
 │                         │                                  │
 │  Export CSV             │                                  │
 │────────────────────────▶│  Signed URL → Download           │
```

### Discovery — Spatial Tiling Algorithm

Google Maps discovery uses a spatial tiling approach for comprehensive coverage:

1. Calculate search area from center point + radius
2. Generate concentric rings of tile centers
3. Query each tile via Google Places API (with pagination)
4. Deduplicate results across tiles (by placeId, business name, email, address)
5. Auto-expand radius if insufficient results found

### Enrichment — Distributed Concurrency

See [Enrichment Engine](#enrichment-engine--distributed-concurrency) section.

### Analysis — Batch Processing

Leads are sent to the LangGraph worker individually via HTTP. The worker processes each lead through the 3-agent pipeline and sends results back via webhook. The backend tracks progress and handles failures with automatic retry.

### Completion & Export

On completion, credits are committed (or rolled back on failure), a final broadcast is sent, and the user can export results as CSV via signed URL.

---

## Credit System — Two-Phase Commit

Credits are the internal currency for all billable operations. The system uses a **two-phase commit** pattern to prevent inconsistencies.

### Flow

```
PHASE 1: RESERVE                    PHASE 2: COMMIT or ROLLBACK
┌──────────────────────┐            ┌──────────────────────┐
│ Check user balance   │            │ Verify reservation   │
│ balance >= amount?   │            │ status == "pending"? │
│        │             │            │ not expired?         │
│   yes  │  no→error   │            │        │             │
│        ▼             │            │   yes  │  no→error   │
│ Create reservation   │            │        ▼             │
│ {status: "pending",  │            │ COMMIT:              │
│  amount, expiresAt:  │   ─────▶   │   deduct credits     │
│  now + 30min}        │            │   create transaction │
│        │             │            │   status→"committed" │
│        ▼             │            │                      │
│ Return reservationId │            │ ROLLBACK:            │
└──────────────────────┘            │   status→"rolled_back│
                                    │   credits untouched  │
                                    └──────────────────────┘
```

### Credit Costs

| Operation | Cost |
|-----------|------|
| Lead Discovery | 0.5 credits/lead |
| Email Enrichment | 1 credit/lead |
| AI Analysis + Email Gen | 2 credits/lead |

### BYOK Bypass

Enterprise users with validated API keys bypass credit charges entirely. The system checks `userApiKeys` for active, validated keys matching the required providers and logs an audit trail entry.

---

## Enrichment Engine — Distributed Concurrency

The enrichment system is the most complex subsystem, handling concurrent FindyMail API access across many users.

### Three-Layer Concurrency Control

```
Layer 1: WORKPOOL (Global)
├── Max 25 leads in parallel across all users
├── Automatic retry with exponential backoff
└── Completion handlers for phase transitions

Layer 2: DISTRIBUTED SEMAPHORE (Per API Key)
├── 5 concurrent slots per unique API key
├── enrichmentApiKeySlots table (5 rows per key)
├── Individual slot claiming (OCC-safe)
└── Auto-expiry for stuck claims (10 min)

Layer 3: QUEUE (Overflow)
├── enrichmentSlotQueue table
├── When all 5 slots busy → queue the lead
├── Cron processor every 3 seconds
└── FIFO ordering with priority support
```

### Enrichment Flow

```
Lead needs enrichment
        │
        ▼
  Slot available? ──yes──▶ Claim slot → Call FindyMail API
        │                         │
        no                        ▼
        │                   Success? ──yes──▶ Store contacts
        ▼                         │           Dedup check
  Queue in                        no          Release slot
  enrichmentSlotQueue             │
        │                         ▼
        │                   Pipeline-blocking? ──yes──▶ Create checkpoint
  (cron picks up                  │                     Pause enrichment
   every 3 seconds)               no
                                  │
                                  ▼
                            Retry via Workpool
                            (2s, 4s, 8s, 16s, 32s backoff)
```

### Error Classification

| Error Type | Action |
|-----------|--------|
| **Pipeline-blocking** (credits exhausted, auth failure) | Create checkpoint, pause all enrichment |
| **Transient** (timeout, rate limit, service unavailable) | Retry via Workpool with exponential backoff |
| **Permanent** (invalid domain, no contacts) | Mark lead as `no_contacts_found`, skip |

---

## Real-Time Broadcasting

Pipeline progress is communicated to the frontend via Convex's reactive subscriptions through a priority-based broadcasting system.

### Priority Levels

| Priority | Use Case | Delivery |
|----------|----------|----------|
| `low` | Informational updates | Best-effort |
| `normal` | Pipeline stage progress | Standard |
| `high` | Errors, warnings | Immediate |
| `urgent` | Action required | Immediate + highlight |
| `critical` | System failures | Immediate + acknowledgment required |

### Broadcast Flow

```
Backend event occurs
        │
        ▼
broadcastPipelineUpdate()
        │
        ▼
Upsert statusBroadcasts table
(update existing for same stage, or insert new)
        │
        ▼
Convex reactive subscription triggers
        │
        ▼
Frontend useStatusBroadcasts() hook re-renders
        │
        ▼
UI shows live progress bar, stage indicator, messages
```

Messages auto-expire after 1 hour. Error broadcasts require user acknowledgment.

---

## Authentication & Authorization

### Stack

- **Clerk**: User authentication (email, Google, GitHub SSO)
- **Convex Auth**: JWT verification + user session management
- **Svix**: Webhook signature verification

### Flow

```
User signs up/in via Clerk
        │
        ▼
Clerk issues JWT token
        │
  ┌─────┴──────┐
  │  Frontend   │  Clerk JWT in every Convex request
  │  receives   │  (ConvexProviderWithClerk handles this)
  │  token      │
  └─────┬──────┘
        │
        ▼
Clerk webhook → Convex HTTP endpoint
        │
        ▼
Svix signature verification
        │
        ▼
Create/update user in Convex database
        │
        ▼
Frontend detects user via useQuery (max 10s webhook wait)
```

### Authorization Layers

| Layer | Mechanism |
|-------|-----------|
| Route protection | `ProtectedRoute` component (frontend) |
| Admin routes | `AdminRoute` component (frontend) |
| Backend auth | `requireAuth(ctx)` — verifies Clerk JWT |
| Admin backend | `requireAdmin(ctx)` — checks `user.role === "admin"` |
| Internal functions | Only callable from other backend functions |
| API keys | SHA256 hashed, validated per-request for BYOK |

---

## Billing & Subscriptions

### Dual Payment Model

```
┌────────────────────────────────────┐
│     MONTHLY SUBSCRIPTION           │
│                                    │
│  Custom per-customer pricing       │
│  ├── ACH checkout (no fee)         │
│  └── Card checkout (+3% fee)       │
│                                    │
│  Monthly credit allocation         │
│  (use-it-or-lose-it per period)    │
└────────────────────────────────────┘
            +
┌────────────────────────────────────┐
│     EXTRA CREDIT PACKS             │
│                                    │
│  Self-service purchase             │
│  Added to current period pool      │
│  Expire at period end              │
└────────────────────────────────────┘
```

### Stripe Integration

- **Custom subscriptions**: Admin creates per-customer subscription with dual checkout URLs (ACH + Card)
- **Webhook processing**: `checkout.session.completed`, `subscription.*`, `invoice.*` events
- **Idempotency**: `processedWebhooks` table prevents duplicate processing

### Credit Allocation Ledger

```
subscriptionCreditAllocations: {
  userId, subscriptionId,
  periodStart, periodEnd,
  creditsAllocated,     // Monthly allocation
  creditsUsed,          // Consumed this period
  creditsExpired,       // Unused at period end
  status                // "active" | "expired"
}
```

---

## Observability & Reliability

### Correlation ID System

Every operation gets a unique correlation ID that follows it across the entire pipeline:

```
corr_a1b2c3d4e5f6 [search_create]
  ├── corr_f6e5d4c3b2a1 [google_maps_discovery]
  │   └── Duration: 1,250ms · Status: Success · Leads: 15
  ├── corr_b2c3d4e5f6a1 [lead_enrichment]
  │   ├── Batch 1/3 · Duration: 800ms · Success
  │   └── Email match rate: 87%
  └── corr_c3d4e5f6a1b2 [ai_analysis]
      └── Duration: 2,100ms · Relevance: 0.85
```

### Cron Jobs (15 total)

| Frequency | Job | Purpose |
|-----------|-----|---------|
| Every 3s | `process-enrichment-queue` | Process queued leads (max 25/tick) |
| Every 5min | `monitor-lead-health` | Detect stuck enrichments |
| Every 5min | `monitor-search-health` | Detect stuck searches |
| Every 5min | `cleanup-expired-semaphore-slots` | Release expired slot claims |
| Every 2min | `process-dead-letter-queue` | Retry failed operations |
| Every 30min | `findymail-health-check` | API health + credit check |
| Daily | `aggregate-daily-admin-metrics` | Pre-compute dashboard stats |
| Daily | `cleanup-resolved-dlq-operations` | Remove old DLQ records |

### Dead Letter Queue

Failed operations land in `failedOperations` table with:
- Operation type and original payload
- Retry count with exponential backoff
- Status progression: `pending → retrying → resolved | exhausted`

### Error Tracking

| Layer | Tool | Scope |
|-------|------|-------|
| Frontend | Sentry React SDK | Component errors, unhandled exceptions |
| Frontend | PostHog | User behavior, feature usage |
| Backend | Convex logs + correlationLogs | All operations with context |
| Worker | Sentry FastAPI + PostHog | LLM errors, processing failures |

### Search Completion Reliability

Two-layer approach for stuck search recovery:
1. **Manual**: Force Complete button (appears after 5min inactivity)
2. **Automated**: 30-minute timeout with progressive warnings (10min → 20min → 30min)

---

## Infrastructure & Deployment

### Service Deployment

| Service | Platform | Runtime | Health Check |
|---------|----------|---------|-------------|
| Frontend | Railway | Nginx (Alpine) | `GET /` → HTTP 200 |
| LangGraph Worker | Railway | Gunicorn + Uvicorn (4 workers) | `GET /health` → HTTP 200 |
| Convex Backend | Convex Cloud | Serverless | Managed by Convex |

### Docker Builds

**Frontend** (`apps/web/Dockerfile`):
- Multi-stage Node 18 Alpine build
- Copies full monorepo → installs deps → runs tests → Vite build
- Serves static files via Nginx with SPA routing + compression + security headers

**LangGraph Worker** (`apps/langgraph-worker/Dockerfile`):
- Python 3.11 slim base
- Build-time secrets for API keys (pre-deployment tests)
- Non-root user (`langgraph`) for security
- 120s graceful shutdown (critical for in-flight AI processing)

### Environment Variables

| Service | Key Variables |
|---------|-------------|
| Frontend | `VITE_CONVEX_URL`, `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY`, `VITE_POSTHOG_KEY` |
| Backend | `CLERK_SECRET_KEY`, `GOOGLE_MAPS_API_KEY`, `FINDYMAIL_API_KEY`, `STRIPE_SECRET_KEY`, `LANGGRAPH_URL` |
| Worker | `OPENAI_API_KEY`, `CONVEX_URL`, `WEBHOOK_URL`, `TAVILY_API_KEY`, `PERPLEXITY_API_KEY` |

---

## External Integrations

| Service | Purpose | Integration Point |
|---------|---------|------------------|
| **Google Maps/Places API** | Business discovery, location data | Convex action → HTTP |
| **FindyMail API** | Contact email enrichment | Convex action → HTTP (with distributed semaphore) |
| **OpenAI API** | LLM for email generation | LangGraph worker → LangChain |
| **Tavily API** | Fast business research (Tier 1) | LangGraph worker → LangChain tool |
| **Perplexity API** | Deep business research (Tier 2) | LangGraph worker → HTTP |
| **Stripe** | Payments, subscriptions, billing | Convex HTTP webhooks + API |
| **Clerk** | Authentication, user management | Frontend SDK + Convex webhooks |
| **PostHog** | Product analytics, session replay | Frontend SDK + Worker SDK |
| **Sentry** | Error tracking, performance monitoring | Frontend SDK + Worker SDK |
| **Instantly.ai** | Email campaign auto-push (optional) | Convex action → HTTP |

---

## Database Schema Overview

31 primary tables organized by domain:

| Domain | Tables | Purpose |
|--------|--------|---------|
| **Users & Auth** | `users`, `businessProfiles`, `userApiKeys`, `apiKeyAuditLog` | Identity, profiles, BYOK keys |
| **Search Pipeline** | `searches`, `leads`, `emailSequences`, `csvImports` | Core lead generation data |
| **Credits** | `creditReservations`, `creditTransactions` | Two-phase commit credit ledger |
| **Billing** | `billing`, `stripeCustomers`, `customSubscriptions`, `subscriptionCreditAllocations`, `extraCreditPurchases`, `planConfigurations` | Subscription & payment management |
| **Rate Limiting** | `rateLimitRecords`, `rateLimitViolations`, `adaptiveRateLimits` | Multi-tier rate control |
| **Enrichment Control** | `enrichmentApiKeySlots`, `enrichmentSlotQueue`, `enrichmentBatches`, `enrichmentCache`, `cronLocks` | Distributed concurrency |
| **Real-Time** | `statusBroadcasts` | Priority-based live updates |
| **Observability** | `correlationLogs`, `adminMetrics`, `failedOperations`, `retryRecords`, `apiErrorLogs`, `langgraphRequests` | Monitoring & debugging |
| **Deduplication** | `place_suppressions`, `place_leads`, `duplicateMetrics` | Cross-search dedup |
| **System** | `systemConfiguration`, `systemControlState`, `adminSettings`, `usageTracking`, `subscriptionEvents`, `systemLogs`, `auditLogs`, `processedWebhooks` | Config, audit, control |
| **Integrations** | `instantlySettings`, `instantlyCampaigns` | Third-party push integrations |

### Key Indexes

- `users.by_clerk_id` — Auth lookups
- `searches.by_user_status_created` — Dashboard queries
- `leads.by_search` — Pipeline processing
- `leads.by_user_primary_email` — Cross-search dedup
- `statusBroadcasts.by_entity` — Real-time subscriptions
- `correlationLogs.by_correlation_id` — Debug tracing
- `enrichmentApiKeySlots.by_key_hash` — Slot management

---

## Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| **Convex over traditional DB** | Real-time subscriptions eliminate polling; colocated logic reduces latency |
| **LangGraph over single LLM call** | Multi-agent specialization produces higher quality emails with structured QA |
| **Two-phase commit credits** | Prevents double-spending during long-running async pipelines |
| **Distributed semaphore (slots table)** | Avoids OCC hotspots that a single counter would create under load |
| **Webhook-based worker communication** | Decouples long-running AI processing from request/response cycle |
| **Spatial tiling for discovery** | Ensures comprehensive geographic coverage beyond API's default limits |
| **Correlation IDs** | Enables instant debugging of any operation across all three services |
| **BYOK with credit bypass** | Enterprise customers reduce costs while platform maintains flexibility |

---

*This document describes the architecture as of February 2025. For implementation details, refer to the inline code documentation and the project's CLAUDE.md file.*
