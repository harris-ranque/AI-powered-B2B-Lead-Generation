# Genni - AI-Powered Lead Generation Platform

> AI-powered lead generation monorepo: React frontend, Convex real-time backend, and Python LangGraph worker for personalized outreach emails.

## 🏗️ Architecture Overview

This is a multi-repository system with the following structure:

### Frontend & AI Worker (This Repository)

- **Frontend** (`apps/web/`): React + TypeScript + Vite application using shadcn/ui components
- **LangGraph Worker** (`apps/langgraph-worker/`): Python FastAPI service with LangGraph multi-agent system

### Backend Repository (`apps/convex-backend/`)

- **Convex Backend**: Real-time database with complete business logic
- **Deployment**: Integrated in monorepo structure

```
┌─────────────────────────────────────────────────────────────┐
│                        Railway                               │
├─────────────────────────┬───────────────────────────────────┤
│   React Frontend App    │        LangGraph Worker           │
│   - TypeScript/React    │        - Python/FastAPI          │
│   - Stripe Elements     │        - LangGraph Agents        │
│   - PostHog Analytics   │        - Async Processing        │
│   - Admin Dashboard     │        - Port 8080               │
│   - Port 3000          │                                   │
└────────────┬───────────┴─────────────┬─────────────────────┘
             │                         │
             │ HTTPS                   │ Internal Network
             │                         │
      ┌──────▼─────────────────────────▼──────┐
      │           Convex Backend              │
      │   - Realtime Database                 │
      │   - Authentication (Built-in)         │
      │   - Actions (API Orchestration)       │
      │   - Scheduled Jobs                    │
      │   - File Storage                      │
      │   - Admin Functions                   │
      └─────────────────┬─────────────────────┘
                        │
              ┌─────────┴──────────┐
              │   External APIs    │
              │   - Google Maps    │
              │   - FindyMail      │
              │   - OpenAI         │
              │   - Tavily Search  │
             │   - Perplexity AI  │
              │   - Stripe         │
              └───────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and pnpm
- Python 3.11+ for LangGraph worker
- Convex CLI and Railway CLI for deployment

### Development Setup

```bash
# 1. Clone and install dependencies
git clone <this-repository>
cd genni
pnpm install

# 2. Set up environment files
cp apps/web/.env.example apps/web/.env.local
cp apps/langgraph-worker/.env.example apps/langgraph-worker/.env

# 3. Install Python dependencies
cd apps/langgraph-worker
pip install -r requirements.txt
cd ../..

# 4. Start all development servers
pnpm dev
```

This will start:

- React frontend on `http://localhost:3000`
- LangGraph worker on `http://localhost:8080`

### Backend Setup (Integrated)

```bash
# In the same repository - separate terminal
cd apps/convex-backend
pnpm install
npx convex dev
```

## 🛠️ Technology Stack

### Frontend

- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **UI Components**: shadcn/ui (Radix UI primitives)
- **Styling**: Tailwind CSS
- **Routing**: React Router DOM
- **State Management**: TanStack Query
- **Form Handling**: React Hook Form with Zod validation

### LangGraph Worker

- **Framework**: FastAPI
- **AI System**: LangGraph with OpenAI integration
- **Dependencies**: LangChain, LangGraph, Pydantic
- **Python Version**: 3.11+

### Infrastructure

- **Package Manager**: pnpm with workspaces
- **Monorepo**: Turborepo
- **Deployment**: Railway (both frontend and worker)
- **Backend/Database**: Convex (integrated monorepo)

## 📦 Project Structure

```
genni/
├── apps/
│   ├── web/                    # React + Vite frontend (port 3000)
│   ├── langgraph-worker/       # Python FastAPI + LangGraph (port 8080)
│   └── convex-backend/         # Convex functions, schema, crons
│       └── convex/
│           ├── search/         # Orchestration, completion, monitoring
│           ├── leads/          # Discovery, enrichment, contacts, export
│           ├── langgraph/      # Worker actions & batch webhooks
│           ├── credits/        # Atomic credit transactions
│           └── schema.ts
├── packages/
│   ├── shared-types/
│   └── convex-types/           # Generated Convex API types
├── docs/
├── turbo.json
└── pnpm-workspace.yaml
```

## 🔄 Lead Search Pipeline

```
Create Search → Google Maps Discovery → People Discovery → FindyMail Enrichment
      → Write Emails (LangGraph) → Search Complete → CSV Export
```

| Phase | What happens | Primary storage |
|-------|----------------|-----------------|
| Discovery | Businesses via Google Maps spatial tiling | `leads` |
| People discovery | Role-matched prospects from websites / APIs | `leadProspects` |
| Enrichment | Verified work emails (employment-gated) | `leadContacts` |
| Write Emails | LangGraph writes subject + body per contact | `emailContent` on contact |
| Export | CSV of contacts with completed emails | `/api/exports/leads.csv` |

**Contact count vs exportable count:** Search History shows accepted contacts (emails found). Export requires Write Emails to finish (`analysisStatus: completed` + `emailContent`). If a search shows contacts but export fails, click **Retry Write Emails** in Search History or call `search.mutations.resumeWriteEmails`.

**Reliability:** Cron monitors in `search/monitoring.ts` recover stuck searches, re-trigger missed Write Emails, and prevent premature completion while analysis is in flight. See [`docs/SEARCH_COMPLETION_RELIABILITY.md`](./docs/SEARCH_COMPLETION_RELIABILITY.md).

## 🤖 LangGraph Optimized 3-Agent System

The Python worker implements an **optimized 3-agent LangGraph system** for email personalization with integrated business intelligence:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│              OPTIMIZED 3-AGENT LANGGRAPH WORKFLOW v3.0                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Input: Lead Data + Business Profile + Requirements                        │
│                                │                                             │
│                                ▼                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                   1. BUSINESS INTELLIGENCE AGENT                       ││
│  │                                                                         ││
│  │  🔍 INTEGRATED RESEARCH & ANALYSIS                                     ││
│  │  ├─ 2-Tier Research System (Tavily → Perplexity)                      ││
│  │  ├─ Lead Qualification & Relevance Analysis                            ││
│  │  ├─ Pain Point Identification & Urgency Assessment                     ││
│  │  ├─ Value Proposition Alignment & Benefit Quantification               ││
│  │  ├─ Competitor Analysis & Industry Insights                            ││
│  │  └─ Real-time Progress Broadcasting                                     ││
│  │                                                                         ││
│  │  Output: Comprehensive Business Intelligence Profile                    ││
│  │  Processing Time: 8-12 seconds                                         ││
│  └─────────────────────────────┬───────────────────────────────────────────┘│
│                                ▼                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    2. EMAIL GENERATION AGENT                           ││
│  │                                                                         ││
│  │  ✉️ CONTEXT-RICH EMAIL CREATION                                        ││
│  │  ├─ Deep Personalization Using Business Intelligence                   ││
│  │  ├─ Industry-Specific Messaging & Competitive Differentiation          ││
│  │  ├─ Multi-Touch Email Sequence Generation                              ││
│  │  ├─ Proof Point Integration & Credibility Building                     ││
│  │  └─ Engagement Optimization & Conversion Focus                         ││
│  │                                                                         ││
│  │  Output: Primary Email + Follow-up Sequence with Effectiveness Scoring ││
│  │  Processing Time: 10-15 seconds                                        ││
│  └─────────────────────────────┬───────────────────────────────────────────┘│
│                                ▼                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                   3. QUALITY ASSURANCE AGENT                           ││
│  │                                                                         ││
│  │  🔍 EMAIL VALIDATION & STANDARDS ENFORCEMENT                           ││
│  │  ├─ Comprehensive Quality Scoring (5 Dimensions)                       ││
│  │  ├─ Personalization Depth Validation & Accuracy Assessment             ││
│  │  ├─ Professional Communication Standards Enforcement                   ││
│  │  ├─ Business Context Integration Verification                          ││
│  │  └─ Improvement Recommendations & Quality Gates                        ││
│  │                                                                         ││
│  │  Output: Quality Assessment + Approval Status + Improvement Suggestions ││
│  │  Processing Time: 5-8 seconds                                          ││
│  └─────────────────────────────┬───────────────────────────────────────────┘│
│                                ▼                                             │
│       Output: Quality-Assured Email Campaign + Business Intelligence        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 🚀 **Architecture Optimization Benefits**

| Metric                | Previous (7 Agents)           | Optimized (3 Agents)      | Improvement                |
| --------------------- | ----------------------------- | ------------------------- | -------------------------- |
| **LLM Calls**         | 7 calls                       | 3 calls                   | **57% reduction**          |
| **Execution Time**    | 45-60 seconds                 | 25-30 seconds             | **50% faster**             |
| **Business Context**  | Disconnected research         | Fully integrated          | **Complete integration**   |
| **Quality Assurance** | No QA validation              | Dedicated QA agent        | **New capability**         |
| **Personalization**   | Fragmented context            | Rich consolidated context | **Better quality**         |
| **Maintenance**       | Complex 7-component system    | Simple 3-agent flow       | **Much simpler**           |
| **Debugging**         | 7 agents + supervisor routing | 3 clear stage boundaries  | **Easier troubleshooting** |

## 🔬 Tiered Business Context Research System

**Advanced Three-Tier Research Architecture with Real-time Progress Updates**

Genni implements a sophisticated three-tier research system that intelligently escalates from fast basic research to comprehensive premium reports based on confidence thresholds, user subscription tiers, and lead value.

### Research Tier Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    TIERED RESEARCH ORCHESTRATION                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Input: Company Name + Domain + User Tier + Lead Value                    │
│                              │                                               │
│                              ▼                                               │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                      RESEARCH ORCHESTRATOR                            │  │
│  │            Intelligent escalation based on confidence                 │  │
│  └───────────────────────────┬───────────────────────────────────────────┘  │
│                              ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ TIER 1: TAVILY SEARCH API                                              ││
│  │ ─────────────────────────                                              ││
│  │ • Response Time: 2-3 seconds                                           ││
│  │ • Cost: $0.001 per search                                              ││
│  │ • Coverage: Basic company information, website content                  ││
│  │ • Confidence Threshold: ≥0.6 to avoid escalation                      ││
│  │ • Data Sources: Web search, company websites, basic business info      ││
│  └─────────────────────────┬───────────────────────────────────────────────┘│
│                            ▼ (if confidence <0.6 OR user tier Pro+)        │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ TIER 2: PERPLEXITY COMPREHENSIVE                                       ││
│  │ ─────────────────────────────────                                      ││
│  │ • Response Time: 8-12 seconds                                          ││
│  │ • Cost: $0.01 per search                                               ││
│  │ • Coverage: Comprehensive reports, deep analysis, expert insights      ││
│  │ • Advanced Features: Multi-source synthesis, trend analysis            ││
│  │ • Data Sources: Premium databases, news, financial reports, analysis   ││
│  └─────────────────────────┬───────────────────────────────────────────────┘│
│                            ▼                                                │
│           Enhanced Business Context + Confidence Score + Metadata           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Intelligent Escalation Logic

**Tier 1 → Tier 2 Escalation Triggers:**

- Confidence score < 0.6 after validation
- User subscription: Pro or Enterprise
- Lead estimated value > $5,000
- Missing critical business context

### Research Capabilities by Tier

| Feature                        | Tier 1 (Tavily) | Tier 2 (Perplexity) |
|--------------------------------|-----------------|---------------------|
| **Response Time**              | 2-3 seconds     | 8-12 seconds        |
| **Cost per Search**            | $0.001          | $0.01               |
| **Company Overview**           | ✅ Rapid summary | ✅ Comprehensive analysis |
| **Industry Analysis**          | ✅ Basic signals | ✅ Premium insights  |
| **Competitor Discovery**       | ❌               | ✅ Market landscape  |
| **Business Model Analysis**    | ✅ High-level    | ✅ Strategic detail  |
| **Technology Stack**           | ✅ Basic         | ✅ Architecture view |
| **Recent News & Events**       | ✅ Headlines     | ✅ Curated narrative |
| **Growth Stage Assessment**    | ✅ Quick inference | ✅ Detailed context |
| **Pain Points Identification** | ❌               | ✅ Deep analysis     |
| **Market Positioning**         | ❌               | ✅ Strategic view    |
| **Financial Insights**         | ❌               | ✅ When public       |
| **Trend Analysis**             | ❌               | ✅                   |
| **Comprehensive Reports**      | ❌               | ✅                   |

### Real-time Progress Broadcasting

**Live Research Updates with SSE Integration:**

```typescript
// Real-time progress stages broadcast to frontend
type ResearchProgressStage =
  | "research_started" // Initial research begins
  | "tier1_tavily" // Tavily search in progress
  | "tier1_complete" // Tavily results ready
  | "escalating_tier2" // Escalating to Perplexity
  | "tier2_perplexity" // Perplexity analysis in progress
  | "tier2_complete" // Deep research results ready
  | "research_completed" // All research complete
  | "research_failed"; // Research encountered errors

// Progress data includes:
interface ResearchProgress {
  searchId: string;
  stage: ResearchProgressStage;
  tier: "tavily" | "perplexity";
  confidence: number; // 0.0 - 1.0
  dataPoints: number; // Data points collected
  sourcesAnalyzed: number; // Sources processed
  escalationReason?: string; // Why escalation occurred
  message: string; // Human readable status
}
```

### Cost Optimization Strategy

**Average Cost per Lead by Research Tier:**

- **Free Plan**: Tier 1 only → $0.001 per lead
- **Pro Plan**: Tier 1 with selective Tier 2 escalation → ~$0.003 per lead
- **Enterprise Plan**: Aggressive Tier 2 usage with BYOK → ~$0.009 per lead

**ROI Optimization:**

- **High-value leads** ($10K+) → Automatic Tier 2 for maximum insight
- **Medium-value leads** ($5K+) → Conditional Tier 2 escalation
- **Low-value leads** (<$5K) → Tier 1 optimization for cost efficiency

### API Integration Architecture

**Research Client Infrastructure:**

```python
# Multi-tier research orchestration
class ResearchOrchestrator:
    def __init__(self):
        self.tavily = TavilyClient()           # Tier 1: Fast web search
        self.perplexity = PerplexityClient()   # Tier 2: Comprehensive analysis

    async def research_company(
        self,
        company_name: str,
        domain: str,
        user_tier: str = "free",
        lead_value: float = 0.0
    ) -> ResearchResult:
        # Intelligent tier selection and escalation logic
```

**Enhanced Business Context Model:**

```python
class BusinessContext(BaseModel):
    # Core research fields
    company_overview: str
    industry_focus: str
    business_model: str
    key_services: List[str]
    target_customers: str

    # Enhanced tier 2/3 fields
    competitors: List[Dict[str, Any]]
    industry_insights: str
    comprehensive_report: Optional[str]

    # Research metadata
    research_tier: str
    confidence_score: float
    escalation_reason: Optional[str]
    research_time: float
    sources_analyzed: int
```

## 🔄 Search Flow Excellence

### Enterprise-Grade Lead Generation Pipeline

**Real-time Orchestration with Advanced Reliability Engineering**

```
Dashboard → Create Search → Google Maps → People Discovery → FindyMail → Write Emails → CSV Export
     ↓            ↓              ↓              ↓               ↓            ↓              ↓
Real-time    Credit Reserve   Discovery    Prospects      Contacts    LangGraph      Export
Updates      Transaction      + Dedup      + Roles        + Emails    3-Agent        (completed
                                                                                    email required)
```

### Advanced Pipeline Features

- **🔄 Real-time Status Broadcasting**: Live pipeline progress with priority messaging system
- **⚡ Performance Monitoring**: <100ms correlation tracking with comprehensive performance metrics
- **🛡️ Reliability Engineering**: 99.9% uptime with comprehensive error recovery and retry mechanisms
- **📊 Advanced Observability**: Complete operation tracing with parent/child correlation trees
- **🎯 Intelligent Processing**: Adaptive rate limiting, dynamic batch sizing, and credit transaction management
- **💳 Atomic Credit System**: Two-phase commit credit operations with reservation/commit/rollback
- **🔍 Enterprise Debugging**: Full correlation traces across entire search pipeline
- **📈 Real-time Analytics**: Operation metrics, performance trends, and automated alerting

### Data Flow & Pipeline Orchestration

1. **Search creation** — User defines location, roles, keywords; credits reserved atomically
2. **Google Maps discovery** — Spatial tiling with per-search and user-level deduplication
3. **People discovery** — Website / API scan for role-matched prospects per business
4. **FindyMail enrichment** — Email lookup for employment-verified prospects; multiple contacts per company allowed
5. **Write Emails** — Convex batches contacts to LangGraph; webhooks update `leadContacts` asynchronously
6. **Search completion** — Finalized only when enrichment and Write Emails are terminal (or legitimately empty)
7. **Export** — CSV via authenticated HTTP route; requires completed email content per contact

### Technical Excellence

- **Correlation ID System**: Complete operation genealogy for instant debugging
- **Multi-tier Rate Limiting**: Plan-based limits with burst allowances and adaptive adjustments
- **Batch Intelligence**: Dynamic sizing based on system load and user subscription tier
- **Event-driven Architecture**: Immediate pipeline advancement with intelligent triggers
- **Comprehensive Error Recovery**: Exponential backoff retry with intelligent failure handling

### AI Processing Flow

```
Lead Data ──▶ HTTP POST ──▶ Railway Worker
     │            │               │
 [Convex]    [Auth+JSON]    [Python App]
                                 │
                     ┌───────────▼────────────┐
                     │ Optimized LangGraph    │
                     │   3-Agent System       │
                     ├────────────────────────┤
                     │ 1. Business Intel      │ ◄─┐
                     │    (Research+Analysis) │   │ Tavily ➜ Perplexity
                     │ 2. Email Generation    │   │
                     │    (Writing+Follow-up) │   │
                     │ 3. Quality Assurance   │ ◄─┘
                     │    (Validation+QA)     │
                     └───────────┬────────────┘
                                 │
              Quality-Assured Email Campaign
              (25-30s vs 45-60s previously)
                                 │
                         Webhook Results
                                 │
                   Store in Convex + Quality Score
```

## ⚙️ Development Commands

### Root Level Commands (Turbo-managed)

```bash
# Start all development servers
pnpm dev

# Build all apps for production
pnpm build

# Run linting across all apps
pnpm lint

# Run TypeScript type checking
pnpm type-check

# Clean all build artifacts
pnpm clean

# Format code across all apps
pnpm format
```

### Frontend Development (`apps/web/`)

```bash
cd apps/web

# Start React development server (port 3000)
pnpm dev

# Build for production
pnpm build

# Build for development environment
pnpm build:dev

# Run ESLint
pnpm lint

# Preview production build
pnpm preview
```

### LangGraph Worker Development (`apps/langgraph-worker/`)

```bash
cd apps/langgraph-worker

# Install Python dependencies
pip install -r requirements.txt

# Start FastAPI development server (port 8080)
pnpm dev
# Or directly: python -m uvicorn app.main:app --reload --port 8080

# Start production server
pnpm start

# Test the integration
python test_convex_integration.py
```

## 🧪 Testing & Debugging

### Visual Debugging with LangGraph Studio

```bash
cd apps/langgraph-worker

# Launch LangGraph Studio (visual workflow debugger)
python launch_langgraph_studio.py
# Open http://localhost:3001
```

### Testing Suite

```bash
cd apps/langgraph-worker

# 1. Test without OpenAI credits (integration tests)
python test_integration_comprehensive.py

# 2. Full OpenAI verification (uses API credits)
python test_with_openai_credits.py

# 3. Demo workflow (no API calls)
python test_workflow_demo.py
```

### What Each Test Does

- **Visual Debugging**: Interactive workflow graph with real-time execution monitoring
- **Integration Tests**: Comprehensive testing of all endpoints and workflows without using OpenAI credits
- **OpenAI Verification**: Full end-to-end testing with real AI responses (requires valid OpenAI API key with credits)
- **Demo Workflow**: Validates workflow structure and creates sample data for Studio testing

## 🔧 Environment Configuration

### Frontend Environment Variables

Create `apps/web/.env.local`:

```env
VITE_CONVEX_URL=your_convex_url
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
VITE_POSTHOG_KEY=phc_...
VITE_POSTHOG_HOST=https://us.i.posthog.com
```

### LangGraph Worker Environment Variables

Create `apps/langgraph-worker/.env`:

```env
# Required Core APIs
OPENAI_API_KEY=sk-your-openai-api-key-here
API_KEY=your-secure-api-key-here
CONVEX_URL=https://your-convex-deployment.convex.site

# Research System APIs
TAVILY_API_KEY=tvly-your-tavily-api-key-here
PERPLEXITY_API_KEY=pplx-your-perplexity-api-key-here

# Optional - webhook URL is auto-constructed from CONVEX_URL
WEBHOOK_URL=https://your-convex-deployment.convex.site/webhooks/crewai/email-completed

# Optional server configuration
PORT=8080
ENVIRONMENT=development
DEBUG=false
DEFAULT_MODEL=gpt-4o-mini
TEMPERATURE=0.7
MAX_TOKENS=2000
```

### Convex Backend Environment Variables

Create `apps/convex-backend/.env.local`:

```env
# API Keys
OPENAI_API_KEY=sk-...
GOOGLE_MAPS_API_KEY=...
FINDYMAIL_API_KEY=...

# Research System APIs (for monitoring and webhooks)
TAVILY_API_KEY=tvly-...
PERPLEXITY_API_KEY=pplx-...

# Payment Processing
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CONNECT_CLIENT_ID=ca_...

# LangGraph Worker (Convex uses LANGGRAPH_*; legacy CREWAI_* may still appear in older docs)
LANGGRAPH_URL=http://localhost:8080
LANGGRAPH_API_KEY=your_secure_api_key

# Clerk Authentication
CLERK_SECRET_KEY=sk_...
CLERK_WEBHOOK_SECRET=whsec_...
CLERK_JWT_ISSUER_DOMAIN=https://clerk.your-domain.com

# Admin
ADMIN_EMAILS=admin@example.com
DEVELOPER_EMAIL=dev@example.com

# URLs
APP_URL=http://localhost:3000
```

## 🚀 Deployment

### Integrated Monorepo Development

```bash
# Single Repository - All services
cd genni-app
pnpm install
pnpm dev          # Runs React frontend and LangGraph worker

# Convex Backend - Separate terminal
cd apps/convex-backend
pnpm install
npx convex dev    # Runs Convex in development mode
```

### Deployment to Production

```bash
# Deploy Frontend to Railway
cd apps/web
railway up --service genni-web

# Deploy LangGraph Worker to Railway
cd apps/langgraph-worker
railway up --service genni-langgraph-worker

# Deploy Convex Backend
cd apps/convex-backend
npx convex deploy --yes
```

**Convex deployments:** dev `dashing-coyote-96` · prod `prestigious-mosquito-761` (see `CLAUDE.md`).

### Service Access

1. **Frontend**: Accessible at `http://localhost:3000`
2. **API Worker**: Accessible at `http://localhost:8080`
3. **Backend**: Convex backend deployed separately with real-time sync

## 📊 Key Features

### Core Functionality

- **Smart Lead Discovery**: Google Maps API integration for business discovery
- **Contact Enrichment**: FindyMail API for email and contact information
- **AI-Powered Analysis**: LangGraph multi-agent system for lead intelligence
- **Personalized Email Generation**: 5-email sequences tailored to each lead
- **Real-time Updates**: Live progress tracking and results display
- **User Management**: Authentication, profiles, and business configuration

### Advanced Features

- **Admin Dashboard**: Comprehensive metrics and user management
- **Billing Integration**: Stripe-powered subscription and credit system
- **Royalty System**: Developer revenue sharing and payment processing
- **Email Studio**: Template management and customization
- **Search History**: Historical searches, export, and Write Emails retry

## 🩺 Troubleshooting

### Export failed but search shows contacts

Write Emails did not produce exportable rows. Common causes:

| Symptom | Likely cause | Fix |
|---------|----------------|-----|
| “awaiting email writing” | Analysis never ran or still pending | Wait, or click **Retry Write Emails** |
| “failed analysis” + quota message | OpenAI `insufficient_quota` / 429 | Fix billing or API key in Convex env, then retry |
| Search “Completed”, `analyzedCount: 0` | All contacts failed analysis or race completed early | Retry Write Emails; check Convex logs for `analyzeLeads` |

Export error messages distinguish **awaiting email writing** vs **failed analysis** (`convex/lib/exportEligibility.ts`).

### Convex schema validation after git rollback

Reverting code does not revert cloud data. If deploy fails with `extra field ... not in the validator`, documents were written by a newer schema. Options:

1. **Clear affected tables** (dev): `npx convex import --table leadContacts --replace empty.json -y` (and `leadProspects` if needed)
2. **Re-add optional fields** to `schema.ts` temporarily so old documents validate

### LangGraph / Railway log rate limits

Production worker sets `ACCESS_LOG_ENABLED=false`, `GUNICORN_LOG_LEVEL=warning`, and gates verbose per-email debug logs. See `apps/langgraph-worker/railway.toml`.

## 🔑 Key Integrations

- **Convex Backend**: Real-time database and API layer
- **LangGraph**: Multi-agent AI system for email generation
- **Google Maps API**: Business discovery and location data
- **FindyMail API**: Contact information enrichment
- **Tavily Search API**: Tier 1 fast business context research (2-3s)
- **Perplexity API**: Tier 3 comprehensive research reports (10-15s)
- **OpenAI API**: GPT models for AI analysis and content generation
- **Stripe**: Payment processing and subscription management
- **Railway**: Deployment platform for frontend and worker

## 🔗 LangGraph-Convex Integration

The LangGraph worker integrates seamlessly with the Convex backend through REST API calls and webhooks:

### Integration Architecture

```
┌─────────────────┐    HTTP/JSON     ┌──────────────────┐    Webhooks    ┌─────────────────┐
│   Frontend      │ ───────────────> │ Convex Backend   │ ─────────────> │ LangGraph       │
│   (React App)   │                  │ (Functions)      │                │ Worker          │
└─────────────────┘                  └──────────────────┘ <───────────── └─────────────────┘
                                              │                                      │
                                              │                                      │
                                              ▼                                      ▼
                                     ┌──────────────────┐                ┌─────────────────┐
                                     │ Convex Database  │                │ OpenAI GPT      │
                                     │ (Real-time)      │                │ (AI Models)     │
                                     └──────────────────┘                └─────────────────┘
```

### Key Integration Points

1. **Convex → LangGraph** (HTTP Requests):
   - `POST /generate-email` - Generate personalized emails
   - `POST /analyze-lead` - Analyze lead relevance and fit
   - `GET /health` - Health check
   - `GET /agents/info` - Agent information

2. **LangGraph → Convex** (Webhooks):
   - `POST /webhooks/crewai/email-completed` - Email generation results
   - `POST /webhooks/crewai/analysis-completed` - Lead analysis results

### Authentication & Security

- **Bearer Token Authentication**: All API calls use `CREWAI_API_KEY` for authentication
- **Automatic Webhook URL Construction**: Worker auto-constructs webhook URLs from `CONVEX_URL`
- **Retry Logic**: Exponential backoff for webhook delivery failures
- **Error Handling**: Comprehensive error handling with user notifications

### Configuration

The LangGraph worker automatically constructs webhook URLs:

```bash
# Set in LangGraph worker
CONVEX_URL=https://your-convex.convex.site

# Auto-constructed webhook URLs:
# Email: https://your-convex.convex.site/webhooks/crewai/email-completed
# Analysis: https://your-convex.convex.site/webhooks/crewai/analysis-completed
```

### Testing Integration

Test the integration with the provided test script:

```bash
cd apps/langgraph-worker
python test_convex_integration.py
```

This verifies:

- ✅ Health endpoint accessibility
- ✅ Webhook configuration
- ✅ API authentication
- ✅ Convex connectivity

## 📚 Documentation

- [`BUILD.md`](./BUILD.md) - Comprehensive component build plan and timeline
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) - Deployment configuration and setup guide
- [`CLAUDE.md`](./CLAUDE.md) - Project context for Claude Code development
- [`docs/genni-architecture.md`](./docs/genni-architecture.md) - Detailed system architecture
- [`docs/FRONTEND-INTEGRATION.md`](./docs/FRONTEND-INTEGRATION.md) - Frontend integration guide
- [`LANGGRAPH_CONVEX_INTEGRATION.md`](./LANGGRAPH_CONVEX_INTEGRATION.md) - Complete LangGraph-Convex integration guide

## 🧪 Testing & Quality

- **Linting**: ESLint for TypeScript/React code
- **Type Checking**: TypeScript compiler with strict configuration
- **Build Validation**: Production builds tested before deployment
- **Code Formatting**: Prettier for consistent formatting

## 🤝 Contributing

1. Follow the existing code style and patterns
2. Use TypeScript with strict mode
3. Follow React functional component patterns
4. Use shadcn/ui components for consistency
5. Write meaningful commit messages
6. Test builds before submitting changes

## 📄 License

This project is proprietary and confidential.

---

**Built with** ❤️ **using React, TypeScript, LangGraph, and Convex**
