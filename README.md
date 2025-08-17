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

## 🔄 Data Flow

### Lead Generation Pipeline
1. User creates search in React frontend
2. Search parameters sent to Convex backend
3. Backend triggers Google Maps API for lead discovery
4. Each lead processed through:
   - FindyMail API for contact enrichment
   - LangGraph worker for AI analysis and email generation
5. Results stored in Convex and displayed in real-time frontend

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
# Required
OPENAI_API_KEY=sk-your-openai-api-key-here
API_KEY=your-secure-api-key-here
CONVEX_URL=https://your-convex-deployment.convex.site

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