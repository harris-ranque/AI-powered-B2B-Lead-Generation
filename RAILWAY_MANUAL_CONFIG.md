# Railway Manual Configuration Guide

## Important: Railway Dashboard Settings

Railway may ignore the `railway.toml` configuration due to monorepo detection. You need to manually configure in the Railway dashboard:

### Frontend Service Configuration

1. **Go to Railway Dashboard** → Your Project → Frontend Service
2. **Settings Tab** → **Build & Deploy**
3. **Set these values manually:**

```
Builder: Dockerfile
Dockerfile Path: Dockerfile
Root Directory: apps/web
```

4. **Environment Variables Tab:**
```
NODE_ENV=production
PORT=3000
NEXT_PUBLIC_CONVEX_URL=your_convex_url
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_your_key
```

5. **Networking Tab:**
```
Internal Port: 3000
Health Check Path: /
```

### Worker Service Configuration

1. **Go to Railway Dashboard** → Your Project → Worker Service  
2. **Settings Tab** → **Build & Deploy**
3. **Set these values manually:**

```
Builder: Dockerfile
Dockerfile Path: Dockerfile
Root Directory: apps/crewai-worker
```

4. **Environment Variables Tab:**
```
PYTHONUNBUFFERED=1
ENVIRONMENT=production
PORT=8080
API_KEY=your_secure_api_key
OPENAI_API_KEY=sk-your_openai_key
WEBHOOK_URL=your_convex_webhook_url
```

5. **Networking Tab:**
```
Internal Port: 8080
Health Check Path: /health
```

## Why Manual Configuration is Needed

Railway's auto-detection sees:
- `pnpm-workspace.yaml` → Forces pnpm/nixpacks
- Root `package.json` with workspaces → Monorepo detection
- This overrides `railway.toml` settings

## Alternative: Single-Service Deployment

If manual configuration doesn't work, deploy each service from separate repositories:

1. **Create separate repositories:**
   - `genni-frontend` (copy `apps/web/` contents)
   - `genni-worker` (copy `apps/crewai-worker/` contents)

2. **Deploy each repository separately** with automatic Docker detection

## Verification

After configuration, check the build logs should show:
```
Building with Dockerfile...
Step 1/10 : FROM node:18-alpine AS builder
```

NOT:
```
Using Nixpacks...
Installing pnpm...
```

## Troubleshooting

If Railway still uses nixpacks:
1. Delete the service and recreate it
2. Use manual repository selection (not GitHub integration)
3. Ensure Root Directory is set correctly
4. Clear Railway build cache