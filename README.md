# Genni - AI-Powered Lead Generation Platform

> Sophisticated AI-powered lead generation platform built as a monorepo combining React frontend with Python LangGraph worker service to generate personalized email sequences for business leads.

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
              │   - Exa Search     │
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
cd LeadGen
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
LeadGen/
├── apps/
│   ├── web/                          # React frontend application
│   │   ├── src/
│   │   │   ├── components/           # React components
│   │   │   │   ├── ui/              # shadcn/ui component library
│   │   │   │   ├── auth/            # Authentication components
│   │   │   │   ├── royalty/         # Royalty system components
│   │   │   │   └── ...              # Business logic components
│   │   │   ├── hooks/               # Custom React hooks
│   │   │   ├── lib/                 # Utilities and API clients
│   │   │   └── pages/               # Page components
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   ├── langgraph-worker/            # Python FastAPI service
│   │   ├── app/
│   │   │   ├── langgraph/           # LangGraph workflow system
│   │   │   │   ├── nodes/           # Individual agent nodes
│   │   │   │   ├── state.py         # Workflow state management
│   │   │   │   ├── supervisor.py    # Agent supervisor
│   │   │   │   └── workflow.py      # Workflow orchestration
│   │   │   ├── models/              # Pydantic models
│   │   │   ├── utils/               # Utilities
│   │   │   └── main.py              # FastAPI app
│   │   ├── requirements.txt
│   │   └── package.json
│   │
│   └── convex-backend/              # Convex backend (integrated)
│       ├── convex/                  # Convex functions
│       │   ├── auth/                # Authentication
│       │   ├── leads/               # Lead management
│       │   ├── crewai/              # LangGraph integration
│       │   ├── billing/             # Payment processing
│       │   └── schema.ts            # Database schema
│       ├── package.json
│       └── convex.json
├── docs/                            # Documentation
├── scripts/                         # Deployment scripts
├── package.json                     # Root package.json
├── turbo.json                       # Turbo configuration
└── pnpm-workspace.yaml             # pnpm workspace config
```

## 🤖 LangGraph Multi-Agent System

The Python worker implements a 7-agent LangGraph system for email personalization:

```
┌─────────────────────────────────────────────────────────┐
│           LANGGRAPH EMAIL GENERATION WORKFLOW            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Input: Lead Data + Business Profile + Requirements    │
│                           │                             │
│                           ▼                             │
│  ┌─────────────────────────────────────────────────────┐│
│  │              SUPERVISOR AGENT                       ││
│  │         Routes workflow through agents              ││
│  │         based on conditional logic                  ││
│  └─────────────────────┬───────────────────────────────┘│
│                        ▼                                │
│  ┌─────────────────────────────────┐                  │
│  │   1. RELEVANCE ANALYZER         │                  │
│  │   - Determines lead relevance   │                  │
│  │   - Qualification scoring       │                  │
│  │   - Fit assessment              │                  │
│  └────────────────┬────────────────┘                  │
│                   ▼                                     │
│  ┌─────────────────────────────────┐                  │
│  │   2. PAIN POINT RESEARCHER      │                  │
│  │   - Identifies challenges       │                  │
│  │   - Industry-specific pain      │                  │
│  │   - Growth obstacles            │                  │
│  └────────────────┬────────────────┘                  │
│                   ▼                                     │
│  ┌─────────────────────────────────┐                  │
│  │   3. VALUE MATCHER              │                  │
│  │   - Aligns solutions to pain    │                  │
│  │   - Value proposition mapping   │                  │
│  │   - Benefit quantification      │                  │
│  └────────────────┬────────────────┘                  │
│                   ▼                                     │
│  ┌─────────────────────────────────┐                  │
│  │   4. EMAIL WRITER               │                  │
│  │   - Personalized content        │                  │
│  │   - Compelling subject lines    │                  │
│  │   - Clear CTAs                  │                  │
│  └────────────────┬────────────────┘                  │
│                   ▼                                     │
│  ┌─────────────────────────────────┐                  │
│  │   5. FOLLOW-UP STRATEGIST       │                  │
│  │   - Multi-email sequences       │                  │
│  │   - Strategic timing            │                  │
│  │   - Varied approaches           │                  │
│  └────────────────┬────────────────┘                  │
│                   ▼                                     │
│  ┌─────────────────────────────────┐                  │
│  │   6. RESULT AGGREGATOR          │                  │
│  │   - Compiles final results      │                  │
│  │   - Quality validation          │                  │
│  │   - Confidence scoring          │                  │
│  └────────────────┬────────────────┘                  │
│                   ▼                                     │
│     Output: Complete Email Campaign + Analytics        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

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
│  │ TIER 2: EXA SEMANTIC SEARCH                                            ││
│  │ ────────────────────────────                                           ││
│  │ • Response Time: 3-4 seconds                                           ││
│  │ • Cost: $0.005 per search                                              ││
│  │ • Coverage: Competitor analysis, industry insights, semantic search    ││
│  │ • Confidence Threshold: ≥0.4 to avoid escalation                      ││
│  │ • Data Sources: Competitor databases, industry reports, market data    ││
│  └─────────────────────────┬───────────────────────────────────────────────┘│
│                            ▼ (if confidence <0.4 OR user tier Enterprise)  │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ TIER 3: PERPLEXITY COMPREHENSIVE                                       ││
│  │ ─────────────────────────────────                                      ││
│  │ • Response Time: 10-15 seconds                                         ││
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
- Confidence score < 0.6
- User subscription: Pro or Enterprise
- Lead estimated value > $5,000
- Insufficient company information found

**Tier 2 → Tier 3 Escalation Triggers:**
- Confidence score < 0.4
- User subscription: Enterprise
- Lead estimated value > $10,000
- Complex industry requiring deep analysis

### Research Capabilities by Tier

| Feature | Tier 1 (Tavily) | Tier 2 (Exa) | Tier 3 (Perplexity) |
|---------|-----------------|---------------|---------------------|
| **Response Time** | 2-3 seconds | 3-4 seconds | 10-15 seconds |
| **Cost per Search** | $0.001 | $0.005 | $0.01 |
| **Company Overview** | ✅ Basic | ✅ Enhanced | ✅ Comprehensive |
| **Industry Analysis** | ❌ | ✅ | ✅ Premium |
| **Competitor Discovery** | ❌ | ✅ Top 5 | ✅ Complete Market |
| **Business Model Analysis** | ✅ Basic | ✅ Detailed | ✅ Strategic |
| **Technology Stack** | ✅ Basic | ✅ Detailed | ✅ Architecture |
| **Recent News & Events** | ✅ | ✅ | ✅ Analysis |
| **Growth Stage Assessment** | ✅ | ✅ | ✅ Detailed |
| **Pain Points Identification** | ❌ | ✅ | ✅ Deep Analysis |
| **Market Positioning** | ❌ | ✅ | ✅ Strategic |
| **Financial Insights** | ❌ | ❌ | ✅ |
| **Trend Analysis** | ❌ | ❌ | ✅ |
| **Comprehensive Reports** | ❌ | ❌ | ✅ |

### Real-time Progress Broadcasting

**Live Research Updates with SSE Integration:**

```typescript
// Real-time progress stages broadcast to frontend
type ResearchProgressStage = 
  | 'research_started'      // Initial research begins
  | 'tier1_tavily'         // Tavily search in progress  
  | 'tier1_complete'       // Tavily results ready
  | 'escalating_tier2'     // Escalating to Exa search
  | 'tier2_exa'           // Exa search in progress
  | 'tier2_complete'       // Exa results ready  
  | 'escalating_tier3'     // Escalating to Perplexity
  | 'tier3_perplexity'    // Perplexity analysis in progress
  | 'research_completed'   // All research complete
  | 'research_failed'      // Research encountered errors

// Progress data includes:
interface ResearchProgress {
  searchId: string;
  stage: ResearchProgressStage;
  tier: 'tavily' | 'exa' | 'perplexity';
  confidence: number;        // 0.0 - 1.0
  dataPoints: number;        // Data points collected
  sourcesAnalyzed: number;   // Sources processed
  escalationReason?: string; // Why escalation occurred
  message: string;           // Human readable status
}
```

### Cost Optimization Strategy

**Average Cost per Lead by Research Tier:**
- **Free Plan**: Tier 1 only → $0.001 per lead
- **Pro Plan**: Tier 1-2 escalation → $0.003 average per lead  
- **Enterprise Plan**: All tiers → $0.011 average per lead

**ROI Optimization:**
- **High-value leads** ($10K+) → Automatic Tier 3 for maximum insight
- **Medium-value leads** ($5K+) → Pro tier escalation logic
- **Low-value leads** (<$5K) → Tier 1 optimization for cost efficiency

### API Integration Architecture

**Research Client Infrastructure:**
```python
# Multi-tier research orchestration
class ResearchOrchestrator:
    def __init__(self):
        self.tavily = TavilyClient()      # Tier 1: Fast web search
        self.exa = ExaClient()            # Tier 2: Semantic search  
        self.perplexity = PerplexityClient()  # Tier 3: Comprehensive

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
Dashboard → Create Search → Google Maps Discovery → FindyMail Enrichment → LangGraph Analysis → CSV Export
     ↓            ↓                ↓                    ↓                ↓              ↓
Real-time    Credit Reserve    Lead Discovery     Email Enrichment   AI Analysis   Completion
Updates      Transaction       Broadcasting       Progress Tracking   Correlation   Notification
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
1. **Search Creation**: User creates search in React frontend with real-time validation
2. **Credit Reservation**: Atomic credit reservation with transaction-based management  
3. **Pipeline Orchestration**: State machine coordination with intelligent queue processing
4. **Google Maps Discovery**: Parallel lead discovery with real-time progress broadcasting
5. **Lead Enrichment**: FindyMail API enrichment with batch processing and rate limiting
6. **LangGraph Analysis**: Multi-agent AI analysis with correlation tracking and error recovery
7. **Real-time Updates**: Continuous status broadcasting throughout entire pipeline
8. **Completion & Export**: Results stored in Convex with CSV export and user notifications

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
                         ┌───────▼────────┐
                         │ LangGraph Flow │
                         ├────────────────┤
                         │ 1. Supervisor  │
                         │ 2. Analyzer    │
                         │ 3. Researcher  │
                         │ 4. Value Match │
                         │ 5. Writer      │
                         │ 6. Follow-ups  │
                         │ 7. Aggregator  │
                         └───────┬────────┘
                                 │
                     Generate Email Campaign
                                 │
                         Webhook Results
                                 │
                         Store in Convex
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
NEXT_PUBLIC_CONVEX_URL=your_convex_url
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
NEXT_PUBLIC_POSTHOG_KEY=phc_...
NEXT_PUBLIC_POSTHOG_HOST=
```

### LangGraph Worker Environment Variables
Create `apps/langgraph-worker/.env`:
```env
# Required Core APIs
OPENAI_API_KEY=sk-your-openai-api-key-here
API_KEY=your-secure-api-key-here
CONVEX_URL=https://your-convex-deployment.convex.site

# Tiered Research System APIs
TAVILY_API_KEY=tvly-your-tavily-api-key-here
EXA_API_KEY=your-exa-api-key-here  
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

# Tiered Research System APIs (for monitoring and webhooks)
TAVILY_API_KEY=tvly-...
EXA_API_KEY=...
PERPLEXITY_API_KEY=pplx-...

# Payment Processing
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CONNECT_CLIENT_ID=ca_...

# LangGraph Worker (environment variable names kept for compatibility)
CREWAI_URL=http://localhost:8080
CREWAI_API_KEY=your_secure_api_key

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
npx convex deploy
```

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
- **Search History**: Historical search management and analytics
- **Mobile Optimization**: Responsive design for all devices

## 🔑 Key Integrations

- **Convex Backend**: Real-time database and API layer
- **LangGraph**: Multi-agent AI system for email generation
- **Google Maps API**: Business discovery and location data
- **FindyMail API**: Contact information enrichment
- **Tavily Search API**: Tier 1 fast business context research (2-3s)
- **Exa Search API**: Tier 2 semantic search and competitor analysis (3-4s)
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