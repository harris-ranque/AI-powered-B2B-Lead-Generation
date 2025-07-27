# Lead Generation Platform Deployment & Configuration Guide

## 🏗️ Architecture Overview

**Multi-Repository System:**
- **Frontend + CrewAI Worker** (this repository): React app + Python FastAPI service
- **Convex Backend** (separate `genni-convex` repository): Real-time database + business logic

## 🚀 Deployment Platforms

### Frontend & CrewAI Worker → Railway
- **Frontend**: React/Vite app (port 3000)
- **CrewAI Worker**: Python FastAPI service (port 8080)
- **Deployment**: Single Railway project with two services

### Backend → Convex Cloud
- **Convex Backend**: Deployed separately via `convex deploy`
- **Real-time sync** with frontend through Convex client

## 📋 Prerequisites

### Required Accounts & Tools
```bash
# 1. Railway CLI
npm install -g @railway/cli
railway login

# 2. Convex CLI (for backend)
npm install -g convex
convex login

# 3. Package Manager
npm install -g pnpm@8.0.0
```

### Required API Keys
- **OpenAI API Key** (for CrewAI agents)
- **Google Maps API Key** (for business discovery)
- **FindyMail API Key** (for contact enrichment)
- **Stripe Keys** (for payments)
- **Convex URL** (from Convex dashboard)

## 🔧 Environment Configuration

### 1. Frontend Environment (`apps/web/.env.local`)
```env
NEXT_PUBLIC_CONVEX_URL=https://your-convex-deployment.convex.cloud
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
NEXT_PUBLIC_POSTHOG_KEY=phc_...
NEXT_PUBLIC_POSTHOG_HOST=
```

### 2. CrewAI Worker Environment (`apps/crewai-worker/.env`)
```env
API_KEY=your_secure_api_key_for_webhook_auth
OPENAI_API_KEY=sk-...
WEBHOOK_URL=https://your-convex-deployment.convex.cloud/webhook
PORT=8080
ENVIRONMENT=production
```

### 3. Convex Backend Environment (`genni-convex/.env.local`)
```env
# API Keys
OPENAI_API_KEY=sk-...
GOOGLE_MAPS_API_KEY=...
FINDYMAIL_API_KEY=...
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CONNECT_CLIENT_ID=ca_...

# CrewAI Worker
CREWAI_URL=https://your-crewai-worker.railway.app
CREWAI_API_KEY=your_secure_api_key_for_webhook_auth

# Admin
ADMIN_EMAILS=admin@example.com
DEVELOPER_EMAIL=dev@example.com

# URLs
APP_URL=https://your-frontend.railway.app
```

## 🚂 Railway Deployment

### Automated Deployment
```bash
# From project root
pnpm install
./scripts/deploy.sh
```

### Manual Deployment
```bash
# 1. Build project
pnpm build

# 2. Deploy to Railway
railway up

# 3. Set environment variables in Railway dashboard
railway variables set OPENAI_API_KEY=sk-...
```

### Railway Configuration

**Frontend Service (`apps/web/railway.toml`):**
```toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "npm start"
healthcheckPath = "/"
restartPolicyType = "always"

[service]
internalPort = 3000

[variables]
NODE_ENV = "production"
```

**CrewAI Worker Service (`apps/crewai-worker/railway.toml`):**
```toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "uvicorn app.main:app --host 0.0.0.0 --port $PORT"
healthcheckPath = "/health"
restartPolicyType = "always"

[service]
internalPort = 8080

[variables]
PYTHONUNBUFFERED = "1"
ENVIRONMENT = "production"
```

## ☁️ Convex Backend Deployment

### Separate Repository Setup
```bash
# Clone backend repository
git clone https://github.com/your-org/genni-convex.git
cd genni-convex

# Install dependencies
npm install

# Configure environment
cp .env.local.example .env.local
# Edit .env.local with your API keys

# Deploy to Convex
npx convex deploy
```

### Database Schema Migration
```bash
# Initialize Convex project (first time)
npx convex init

# Generate TypeScript types
npx convex codegen

# Deploy schema and functions
npx convex deploy
```

## 🔄 Development Workflow

### Local Development
```bash
# Terminal 1: Frontend + CrewAI Worker (this repository)
cd genni-app
pnpm install
pnpm dev  # Runs both React (3000) and FastAPI (8080)

# Terminal 2: Convex Backend (separate repository)
cd genni-convex
npm install
npx convex dev  # Runs Convex in development mode
```

### Environment Setup for Development
```bash
# Frontend development environment
cp apps/web/.env.example apps/web/.env.local

# CrewAI worker development environment
cp apps/crewai-worker/.env.example apps/crewai-worker/.env

# Convex development environment (separate repo)
cp .env.local.example .env.local
```

## 🔗 Service Integration

### URL Configuration Matrix
```yaml
Development:
  Frontend: http://localhost:3000
  CrewAI Worker: http://localhost:8080
  Convex: https://your-dev-convex.convex.cloud

Production:
  Frontend: https://your-frontend.railway.app
  CrewAI Worker: https://your-crewai-worker.railway.app
  Convex: https://your-prod-convex.convex.cloud
```

### Webhook Configuration
1. **Convex → CrewAI Worker**: Triggers AI processing
2. **CrewAI Worker → Convex**: Returns processed results
3. **Stripe → Convex**: Payment webhooks

## 📊 Monitoring & Health Checks

### Health Endpoints
- **Frontend**: `GET /` (200 response)
- **CrewAI Worker**: `GET /health` (JSON response)
- **Convex**: Built-in monitoring dashboard

### Deployment Verification
```bash
# Test frontend
curl https://your-frontend.railway.app

# Test CrewAI worker
curl https://your-crewai-worker.railway.app/health

# Test Convex
curl https://your-convex-deployment.convex.cloud/_system/ping
```

## 🛠️ Troubleshooting

### Common Issues

**1. Environment Variables Missing**
```bash
# Check Railway variables
railway variables

# Set missing variables
railway variables set KEY=value
```

**2. Python Dependencies**
```bash
# If CrewAI worker fails to start
railway run pip install -r requirements.txt
```

**3. Convex Connection Issues**
```bash
# Regenerate Convex URL
npx convex dashboard
# Copy deployment URL to frontend .env
```

**4. Build Failures**
```bash
# Clear build cache
railway run --detach pnpm clean
railway run --detach pnpm build
```

### Logs Access
```bash
# Railway logs
railway logs

# Convex logs
npx convex dashboard  # View in browser
```

## 🔄 Updates & Maintenance

### Deployment Pipeline
1. **Code Changes** → Push to repository
2. **Railway Auto-Deploy** → Triggered by git push
3. **Convex Deploy** → Manual deployment via CLI
4. **Environment Sync** → Update variables as needed

### Version Management
```bash
# Update dependencies
pnpm update

# Deploy with specific Convex environment
npx convex deploy --prod
```

This deployment setup provides a robust, scalable infrastructure for the Lead Generation platform with clear separation of concerns and automated deployment workflows.