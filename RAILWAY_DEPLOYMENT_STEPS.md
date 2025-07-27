# Railway Deployment Steps - Option 1 Implementation

## Configuration Changes Completed ✅

1. **Removed conflicting files**:
   - ✅ Deleted `apps/web/railway.yaml`
   - ✅ Deleted `railway.json`

2. **Updated railway.toml files**:
   - ✅ Frontend: Added `watchPatterns`, removed hardcoded variables
   - ✅ Worker: Added `watchPatterns`, removed hardcoded variables

3. **Fixed nixpacks.toml files**:
   - ✅ Frontend: Updated to use `cd apps/web` for monorepo navigation
   - ✅ Worker: Updated to use `cd apps/crewai-worker` for monorepo navigation

## Manual Steps Required

### 1. Install Railway CLI (if not installed)
```bash
npm install -g @railway/cli
```

### 2. Link Railway Project
```bash
cd /Users/mountain/Documents/Digital\ Projects/LeadGen
railway login
railway link
```

### 3. Deploy Services

#### Option A: Deploy from Root (Recommended)
```bash
# From project root
railway up
```

This will deploy both services if Railway is configured for multi-service deployment.

#### Option B: Deploy Each Service Separately
```bash
# Deploy frontend
cd apps/web
railway service create genni-frontend
railway up

# Deploy worker
cd ../crewai-worker
railway service create genni-worker
railway up
```

### 4. Set Environment Variables in Railway Dashboard

#### Frontend Service (genni-frontend):
```
NODE_ENV=production
PORT=3000
NEXT_PUBLIC_CONVEX_URL=your_convex_url
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
NEXT_PUBLIC_POSTHOG_KEY=phc_...
NEXT_PUBLIC_POSTHOG_HOST=
```

#### Worker Service (genni-worker):
```
PYTHONUNBUFFERED=1
ENVIRONMENT=production
PORT=8080
API_KEY=your_secure_api_key
OPENAI_API_KEY=sk-...
WEBHOOK_URL=your_convex_webhook_url
```

### 5. Verify Deployments

After deployment, check:

1. **Build Logs**: Should show nixpacks using the correct commands
2. **Service URLs**: Note the URLs for both services
3. **Health Checks**:
   ```bash
   # Frontend health check
   curl https://your-frontend-service.railway.app/
   
   # Worker health check
   curl https://your-worker-service.railway.app/health
   ```

### 6. Update Convex Backend

Update your Convex backend environment with the worker URL:
```
CREWAI_URL=https://your-worker-service.railway.app
```

## Troubleshooting

### If Railway still tries to use wrong configuration:

1. **Clear Railway cache**:
   - Go to Railway dashboard → Service Settings → Clear Build Cache

2. **Force rebuild**:
   ```bash
   railway up --no-cache
   ```

3. **Check build logs** for:
   - "Using Nixpacks" (correct)
   - Commands starting with `cd apps/web` or `cd apps/crewai-worker`
   - NOT seeing pnpm commands (we're using npm)

### If services fail to start:

1. **Check PORT usage**:
   - Frontend should use `$PORT` environment variable
   - Worker should use `$PORT` environment variable

2. **Verify health endpoints**:
   - Frontend: `/` should return 200
   - Worker: `/health` should return 200

3. **Check logs** for specific errors and address them

## Summary of Changes

The configuration has been cleaned up and optimized for Railway's nixpacks builder:

1. Removed conflicting YAML and JSON configs
2. Simplified railway.toml files with watchPatterns
3. Updated nixpacks.toml to properly handle monorepo structure
4. All commands now navigate to correct directories before execution

The deployment should now work correctly with Railway's auto-detection.