# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Genni is an AI-powered lead generation platform built as a monorepo using Turborepo. It combines a React frontend, a Python LangGraph worker for AI-generated email sequences, and a Convex real-time backend.

## Architecture

```
genni/
├── apps/
│   ├── web/                    # React + TypeScript frontend (Vite, port 3000)
│   ├── langgraph-worker/       # Python FastAPI AI service (port 8080)
│   └── convex-backend/         # Convex backend with all business logic
│       └── convex/
│           ├── schema.ts       # Database schema
│           ├── auth/           # Clerk auth integration
│           ├── search/         # Lead search pipeline & orchestration
│           ├── leads/          # Lead mutations, queries, FindyMail enrichment
│           ├── langgraph/      # LangGraph worker actions & webhooks
│           ├── credits/        # Atomic credit transactions
│           ├── billing/        # Stripe integration
│           ├── rateLimit/      # Multi-tier rate limiting
│           ├── realtime/       # Real-time status broadcasting
│           ├── royalty/        # Developer royalty system
│           ├── admin/          # Admin queries and actions
│           └── lib/            # Correlation IDs, logging, helpers
├── packages/
│   ├── shared-types/           # Manual shared TypeScript types
│   └── convex-types/           # Auto-generated Convex API types (symlinked)
```

**Search pipeline flow**: User creates search → credit reservation → Google Maps discovery → FindyMail enrichment → LangGraph AI analysis → CSV export, with real-time status broadcasts throughout.

## Development Commands

### Root (Turbo-managed)

```bash
pnpm install          # Install all workspace dependencies
pnpm dev              # Start all services
pnpm dev:web          # Frontend only
pnpm dev:worker       # LangGraph worker only
pnpm build            # Build all apps
pnpm lint             # Lint all apps
pnpm type-check       # TypeScript check all apps
pnpm test             # Run all tests
pnpm format           # Format all apps
pnpm clean            # Clean build artifacts
```

### Frontend (`apps/web/`)

```bash
pnpm dev              # Dev server (port 3000)
pnpm build            # Production build
pnpm build:dev        # Development build
pnpm lint
pnpm preview
```

### LangGraph Worker (`apps/langgraph-worker/`)

```bash
pip install -r requirements.txt
pnpm dev              # uvicorn --reload (port 8080)
pnpm start            # Gunicorn production server
pnpm type-check
```

### Convex Backend (`apps/convex-backend/`)

```bash
npx convex dev        # Start dev server (watch mode)
npx convex deploy     # Deploy to production (use --yes for non-interactive)
npx convex env set VARIABLE_NAME value
pnpm type-check
```

Deployments: dev = `dashing-coyote-96`, prod = `prestigious-mosquito-761`

## Technology Stack

**Frontend**: React 18, TypeScript, Vite, shadcn/ui, Tailwind CSS, React Router DOM, TanStack Query, React Hook Form + Zod

**LangGraph Worker**: Python 3.11+, FastAPI, LangGraph, LangChain, OpenAI, Pydantic

**Infrastructure**: pnpm workspaces, Turborepo, Convex (backend/database), Railway (frontend + worker deployment), Stripe (billing), Clerk (auth), PostHog (analytics)

## Key Components

### Frontend Entry Point

`src/main.tsx` → `src/App.tsx` → `src/pages/Index.tsx` → `src/components/GenniApp.tsx`

Key components: `GenniApp`, `LeadGenApp`, `ChatInterface`, `Dashboard`, `EmailStudio`, `AdminDashboard`, `RoyaltyDashboard`

Custom hooks in `src/hooks/`. Shared types in `src/lib/types.ts`.

### LangGraph Multi-Agent System

3-agent pipeline (~25-30s total):
1. **Business Intelligence Agent** (8-12s): Tiered research via Tavily then Perplexity, lead qualification, pain point identification
2. **Email Generation Agent** (10-15s): Context-rich personalized email creation, follow-up sequence planning
3. **Quality Assurance Agent** (5-8s): Quality scoring, standards validation, approval gates

### Convex Backend Patterns

- `internal.ts` files: functions callable only by other backend functions
- `admin.ts` files: admin-only functions
- HTTP endpoints use `convex.site` (not `convex.cloud`)
- Correlation IDs (`lib/correlation.ts`) trace operations across the full pipeline

## Environment Configuration

### Frontend — `apps/web/.env.local`

```env
VITE_CONVEX_URL=your_convex_url
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
VITE_POSTHOG_KEY=phc_...
VITE_POSTHOG_HOST=https://us.i.posthog.com
```

### LangGraph Worker — `apps/langgraph-worker/.env`

```env
API_KEY=your_secure_api_key
OPENAI_API_KEY=sk-...
CONVEX_URL=https://your-convex-deployment.convex.cloud
PORT=8080
```

### Convex Backend — `apps/convex-backend/.env.local`

```env
OPENAI_API_KEY=sk-...
GOOGLE_MAPS_API_KEY=...
FINDYMAIL_API_KEY=...
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CONNECT_CLIENT_ID=ca_...
CLERK_SECRET_KEY=sk_...
CLERK_WEBHOOK_SECRET=whsec_...
CLERK_JWT_ISSUER_DOMAIN=https://clerk.your-domain.com
LANGGRAPH_URL=http://localhost:8080
LANGGRAPH_API_KEY=your_secure_api_key
ADMIN_EMAILS=admin@example.com
DEVELOPER_EMAIL=dev@example.com
APP_URL=http://localhost:3000
```

## Code Style & Conventions

- TypeScript strict mode throughout
- React functional components with hooks
- Tailwind CSS with shadcn/ui component patterns
- Python: FastAPI patterns with Pydantic models
- ESLint + Prettier for formatting
- Tests live alongside components (see `src/components/royalty/__tests__/`)

## Deployment

Railway deploys each app from its own directory (`apps/web/` and `apps/langgraph-worker/`), each with its own `Dockerfile` and `railway.toml`. Convex deploys independently via `npx convex deploy`.
