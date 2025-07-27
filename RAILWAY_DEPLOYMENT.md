# Railway Multi-Service Deployment Guide

## Overview

This monorepo contains two services that need to be deployed separately on Railway:
1. **Frontend Service** (`apps/web/`) - React application
2. **CrewAI Worker Service** (`apps/crewai-worker/`) - Python FastAPI service

## Deployment Steps

### Method 1: Deploy Both Services from One Repository (Recommended)

#### Step 1: Create Frontend Service
1. Go to Railway dashboard
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your repository
4. In the service configuration:
   - **Service Name**: `genni-frontend`
   - **Root Directory**: `apps/web`
   - **Build Command**: `pnpm install && pnpm build`
   - **Start Command**: `pnpm start`

#### Step 2: Create Worker Service
1. In the same Railway project, click "Add Service"
2. Select "GitHub Repo" → Choose the same repository
3. In the service configuration:
   - **Service Name**: `genni-crewai-worker`
   - **Root Directory**: `apps/crewai-worker`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT`

### Method 2: Using Railway CLI (Alternative)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Create new project
railway project new

# Deploy frontend
cd apps/web
railway up

# Deploy worker (in new service)
cd ../crewai-worker
railway service new
railway up
```

### Method 3: Manual Configuration

If automatic detection fails:

#### Frontend Service Configuration
```toml
# apps/web/railway.toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "pnpm start"
healthcheckPath = "/"

[service]
internalPort = 3000
```

#### Worker Service Configuration
```toml
# apps/crewai-worker/railway.toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT"
healthcheckPath = "/health"

[service]
internalPort = 8080
```

## Environment Variables

### Frontend Service
Set these in Railway dashboard:
```
NODE_ENV=production
NEXT_PUBLIC_CONVEX_URL=your_convex_url
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_...
PORT=3000
```

### Worker Service
Set these in Railway dashboard:
```
PYTHONUNBUFFERED=1
ENVIRONMENT=production
API_KEY=your_secure_api_key
OPENAI_API_KEY=sk-...
WEBHOOK_URL=your_convex_webhook_url
PORT=8080
```

## Service Communication

After deployment:
1. Frontend will be available at: `https://your-frontend-service.railway.app`
2. Worker will be available at: `https://your-worker-service.railway.app`
3. Update your Convex backend with the worker URL:
   ```env
   CREWAI_URL=https://your-worker-service.railway.app
   ```

## Troubleshooting

### Common Issues

1. **"No start command found"**
   - Ensure `railway.toml` files exist in each app directory
   - Verify the `startCommand` is correctly specified

2. **Build failures**
   - Check that `requirements.txt` exists for Python service
   - Verify `package.json` has correct scripts

3. **Port binding issues**
   - Ensure services use `$PORT` environment variable
   - Frontend: `--port $PORT`
   - Worker: `--port $PORT`

4. **Service not responding**
   - Check health check endpoints
   - Verify internal ports match service configuration

### Verification Commands

```bash
# Test frontend health
curl https://your-frontend-service.railway.app/

# Test worker health
curl https://your-worker-service.railway.app/health

# Test worker API
curl -X POST https://your-worker-service.railway.app/analyze \
  -H "Authorization: Bearer your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
```

## Next Steps

1. Deploy both services to Railway
2. Update Convex environment variables with new service URLs
3. Test the complete flow from frontend → Convex → worker
4. Monitor logs in Railway dashboard for any issues