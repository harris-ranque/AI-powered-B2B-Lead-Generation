# Genni - AI-Powered Lead Generation Platform

> Sophisticated AI-powered lead generation platform built as a monorepo combining React frontend with Python CrewAI worker service to generate personalized email sequences for business leads.

## 🏗️ Architecture Overview

This is a multi-repository system with the following structure:

### Frontend & AI Worker (This Repository)
- **Frontend** (`apps/web/`): React + TypeScript + Vite application using shadcn/ui components
- **CrewAI Worker** (`apps/crewai-worker/`): Python FastAPI service with CrewAI multi-agent system

### Backend Repository (`genni-convex`)
- **Convex Backend**: Real-time database with complete business logic
- **Deployment**: Separate repository managed independently

```
┌─────────────────────────────────────────────────────────────┐
│                        Railway                               │
├─────────────────────────┬───────────────────────────────────┤
│   React Frontend App    │        CrewAI Worker              │
│   - TypeScript/React    │        - Python/FastAPI          │
│   - Stripe Elements     │        - CrewAI Agents           │
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
- Python 3.11+ for CrewAI worker
- Convex CLI and Railway CLI for deployment

### Development Setup

```bash
# 1. Clone and install dependencies
git clone <this-repository>
cd LeadGen
pnpm install

# 2. Set up environment files
cp apps/web/.env.example apps/web/.env.local
cp apps/crewai-worker/.env.example apps/crewai-worker/.env

# 3. Install Python dependencies
cd apps/crewai-worker
pip install -r requirements.txt
cd ../..

# 4. Start all development servers
pnpm dev
```

This will start:
- React frontend on `http://localhost:3000`
- CrewAI worker on `http://localhost:8080`

### Backend Setup (Separate Repository)
```bash
# In a separate terminal/directory
git clone <genni-convex-repository>
cd genni-convex
npm install
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

### CrewAI Worker
- **Framework**: FastAPI
- **AI System**: CrewAI with OpenAI integration
- **Dependencies**: LangChain, Pydantic
- **Python Version**: 3.11+

### Infrastructure
- **Package Manager**: pnpm with workspaces
- **Monorepo**: Turborepo
- **Deployment**: Railway (both frontend and worker)
- **Backend/Database**: Convex (separate repository)

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
│   └── crewai-worker/               # Python FastAPI service
│       ├── app/
│       │   ├── agents/              # CrewAI agents
│       │   ├── crews/               # Agent crews
│       │   ├── models/              # Pydantic models
│       │   ├── utils/               # Utilities
│       │   └── main.py              # FastAPI app
│       ├── requirements.txt
│       └── package.json
│
├── convex/                          # Convex backend (legacy structure)
├── docs/                            # Documentation
├── scripts/                         # Deployment scripts
├── package.json                     # Root package.json
├── turbo.json                       # Turbo configuration
└── pnpm-workspace.yaml             # pnpm workspace config
```

## 🤖 CrewAI Multi-Agent System

The Python worker implements a 5-agent system for email personalization:

```
┌─────────────────────────────────────────────────────────┐
│              EMAIL PERSONALIZATION CREW                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Input: Lead Data + User Profile                       │
│                   │                                     │
│                   ▼                                     │
│  ┌─────────────────────────────────┐                  │
│  │   1. RELEVANCE ANALYZER         │                  │
│  │   - Match offerings to needs    │                  │
│  │   - Score fit (1-10)           │                  │
│  │   - Find connection points      │                  │
│  └────────────────┬────────────────┘                  │
│                   ▼                                     │
│  ┌─────────────────────────────────┐                  │
│  │   2. PAIN POINT RESEARCHER      │                  │
│  │   - Industry challenges         │                  │
│  │   - Company-specific issues     │                  │
│  │   - Growth blockers             │                  │
│  └────────────────┬────────────────┘                  │
│                   ▼                                     │
│  ┌─────────────────────────────────┐                  │
│  │   3. VALUE PROP MATCHER         │                  │
│  │   - Align solutions to pains    │                  │
│  │   - Create benefit statements   │                  │
│  │   - Prioritize propositions     │                  │
│  └────────────────┬────────────────┘                  │
│                   ▼                                     │
│  ┌─────────────────────────────────┐                  │
│  │   4. EMAIL COPYWRITER           │                  │
│  │   - 140-word main email         │                  │
│  │   - Compelling subject line     │                  │
│  │   - Clear CTA                   │                  │
│  └────────────────┬────────────────┘                  │
│                   ▼                                     │
│  ┌─────────────────────────────────┐                  │
│  │   5. FOLLOW-UP STRATEGIST       │                  │
│  │   - 4 follow-up emails          │                  │
│  │   - Different angles            │                  │
│  │   - Escalating urgency          │                  │
│  └────────────────┬────────────────┘                  │
│                   ▼                                     │
│         Output: 5 Personalized Emails                  │
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
   - CrewAI worker for AI analysis and email generation
5. Results stored in Convex and displayed in real-time frontend

### AI Processing Flow
```
Lead Data ──▶ HTTP POST ──▶ Railway Worker
     │            │               │
 [Convex]    [Auth+JSON]    [Python App]
                                 │
                         ┌───────▼────────┐
                         │  Agent Crew    │
                         ├────────────────┤
                         │ 1. Analyzer    │
                         │ 2. Researcher  │
                         │ 3. Writer      │
                         │ 4. Follow-ups  │
                         └───────┬────────┘
                                 │
                         Generate 5 Emails
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

### CrewAI Worker Development (`apps/crewai-worker/`)
```bash
cd apps/crewai-worker

# Install Python dependencies
pip install -r requirements.txt

# Start FastAPI development server (port 8080)
pnpm dev
# Or directly: python -m uvicorn app.main:app --reload --port 8080

# Start production server
pnpm start
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

### CrewAI Worker Environment Variables
Create `apps/crewai-worker/.env`:
```env
API_KEY=your_secure_api_key
OPENAI_API_KEY=sk-...
WEBHOOK_URL=your_convex_webhook_url
PORT=8080
```

### Convex Backend Environment Variables
Create `genni-convex/.env.local`:
```env
# API Keys
OPENAI_API_KEY=sk-...
GOOGLE_MAPS_API_KEY=...
FINDYMAIL_API_KEY=...
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CONNECT_CLIENT_ID=ca_...

# CrewAI Worker
CREWAI_URL=http://localhost:8080
CREWAI_API_KEY=your_secure_api_key

# Admin
ADMIN_EMAILS=admin@example.com
DEVELOPER_EMAIL=dev@example.com

# URLs
APP_URL=http://localhost:3000
```

## 🚀 Deployment

### Multi-Repository Development
```bash
# Repository 1 (Frontend + CrewAI) - This Repository
cd genni-app
pnpm install
pnpm dev          # Runs both React and CrewAI worker

# Repository 2 (Convex Backend) - Separate Repository
cd genni-convex
npm install
npx convex dev    # Runs Convex in development mode
```

### Deployment to Production
```bash
# Deploy Frontend/CrewAI to Railway
cd genni-app
railway up

# Deploy Convex Backend
cd genni-convex
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
- **AI-Powered Analysis**: CrewAI multi-agent system for lead intelligence
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
- **CrewAI**: Multi-agent AI system for email generation
- **Google Maps API**: Business discovery and location data
- **FindyMail API**: Contact information enrichment
- **Stripe**: Payment processing and subscription management
- **Railway**: Deployment platform for frontend and worker

## 📚 Documentation

- [`BUILD.md`](./BUILD.md) - Comprehensive component build plan and timeline
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) - Deployment configuration and setup guide
- [`CLAUDE.md`](./CLAUDE.md) - Project context for Claude Code development
- [`docs/genni-architecture.md`](./docs/genni-architecture.md) - Detailed system architecture
- [`docs/FRONTEND-INTEGRATION.md`](./docs/FRONTEND-INTEGRATION.md) - Frontend integration guide

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

**Built with** ❤️ **using React, TypeScript, CrewAI, and Convex**