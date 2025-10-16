# 🚀 Genni Deployment Guide

## 📋 Architecture Overview

**Genni** is a sophisticated AI-powered lead generation platform with a multi-service architecture:

### System Components

1. **Frontend App** (`apps/web/`) - React + TypeScript + Vite application
2. **CrewAI Worker** (`apps/crewai-worker/`) - Python FastAPI service with multi-agent AI system
3. **Convex Backend** (`genni-convex/` repository) - Real-time database and business logic

## 🏗️ Development Setup

### Prerequisites

```bash
# Required versions
Node.js >= 18.0.0
Python >= 3.11
pnpm >= 8.0.0
```

### Quick Start

```bash
# Install dependencies
pnpm install

# Start all development servers
pnpm dev

# Individual services
pnpm dev:web      # Frontend only (port 3000)
pnpm dev:worker   # CrewAI worker only (port 8080)
```

### Convex Backend Setup

```bash
# In separate genni-convex repository
npm install
npx convex dev    # Starts Convex backend
```

## 🚀 Production Deployment

### Railway Deployment (Recommended)

#### Service 1: Frontend (`apps/web/`)

```bash
# Railway setup for web app
railway login
railway link <your-web-project-id>
railway up --service genni-web

# Required environment variables
VITE_CONVEX_URL=<your-convex-url>
VITE_CREWAI_URL=<your-worker-url>
```

#### Service 2: CrewAI Worker (`apps/crewai-worker/`)

```bash
# Railway setup for worker
railway link <your-worker-project-id>
railway up --service genni-crewai-worker

# Required environment variables
API_KEY=<secure-api-key>
OPENAI_API_KEY=<your-openai-key>
WEBHOOK_URL=<convex-webhook-url>
PORT=8080
```

#### Service 3: Convex Backend

```bash
# In genni-convex repository
npx convex deploy --prod
```

### Environment Variables

#### Frontend (.env.local)

```env
VITE_CONVEX_URL=https://your-convex-deployment.convex.cloud
VITE_CREWAI_URL=https://your-worker.railway.app
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...
```

#### CrewAI Worker (.env)

```env
API_KEY=your-secure-api-key-here
OPENAI_API_KEY=sk-...
WEBHOOK_URL=https://your-convex-deployment.convex.cloud/api/webhook
PORT=8080
```

#### Convex Backend (.env.local)

```env
OPENAI_API_KEY=sk-...
GOOGLE_MAPS_API_KEY=...
FINDYMAIL_API_KEY=...
STRIPE_SECRET_KEY=sk_...
CREWAI_URL=https://your-worker.railway.app
CREWAI_API_KEY=your-secure-api-key-here
```

## 🔧 Build Configuration

### Turbo Pipeline

The project uses Turborepo for build orchestration:

```json
{
  "dev": "turbo dev",           # All services in development
  "build": "turbo build",       # Production builds
  "start": "turbo start",       # Start production services
  "type-check": "turbo type-check", # TypeScript validation
  "lint": "turbo lint"          # Code quality checks
}
```

### Build Commands

```bash
# Build everything
pnpm build

# Build specific services
pnpm build --filter=@genni/web
pnpm build --filter=@genni/crewai-worker

# Type checking
pnpm type-check

# Linting
pnpm lint
```

## 📊 Service URLs & Ports

| Service        | Development           | Production                           |
| -------------- | --------------------- | ------------------------------------ |
| Frontend       | http://localhost:3000 | https://your-web-app.railway.app     |
| CrewAI Worker  | http://localhost:8080 | https://your-worker.railway.app      |
| Convex Backend | Convex Dev URL        | https://your-deployment.convex.cloud |

## 🚨 Troubleshooting

### Common Issues

#### Build Failures

- **Convex Import Errors**: Ensure `@/convex/_generated/api` paths are correct
- **Type Errors**: Run `pnpm type-check` to identify issues
- **Missing Dependencies**: Run `pnpm install` in project root

#### Deployment Issues

- **Railway Memory Limits**: Use minimal Dockerfile for Python worker
- **Environment Variables**: Verify all required env vars are set
- **Service Communication**: Check URL configuration between services

#### Development Issues

- **Port Conflicts**: Ensure ports 3000 and 8080 are available
- **Python Environment**: Use Python 3.11+ for CrewAI compatibility
- **Node Version**: Use Node.js 18+ for optimal compatibility

### Debug Commands

```bash
# Check service status
railway status

# View deployment logs
railway logs --tail 100

# Test local builds
pnpm build
pnpm type-check

# Validate Python worker
cd apps/crewai-worker && python -m py_compile app/main.py
```

## 📝 Deployment Checklist

### Pre-deployment

- [ ] All environment variables configured
- [ ] `pnpm build` passes without errors
- [ ] `pnpm type-check` passes
- [ ] `pnpm lint` passes
- [ ] Convex schema deployed
- [ ] API keys and secrets updated

### Post-deployment

- [ ] Frontend loads correctly
- [ ] CrewAI worker health check responds
- [ ] Service communication working
- [ ] Database connections established
- [ ] Authentication flow functional

## 🔗 Related Documentation

- **CLAUDE.md** - Development guidance and architecture details
- **README.md** - Project overview and quick start
- **apps/web/README.md** - Frontend-specific documentation
- **apps/crewai-worker/DOCKER_TROUBLESHOOTING.md** - Python deployment issues
