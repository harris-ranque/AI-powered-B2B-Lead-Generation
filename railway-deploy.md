# Railway Deployment Guide

## Fixed Issues

### CrewAI Worker Fixes ✅
1. **Added gunicorn** to requirements.txt (was missing, causing "command not found" errors)
2. **Updated Procfile** to use gunicorn + uvicorn worker instead of direct uvicorn
3. **Added Dockerfile** with proper security (non-root user) and health checks
4. **Added railway.json** for deployment configuration

### Frontend Fixes ✅  
1. **Created Dockerfile** with nginx for proper static file serving
2. **Added nginx.conf** with gzip, caching, and security headers
3. **Updated package.json** to use `serve` instead of vite preview
4. **Added railway.json** for deployment configuration

## Deployment Commands

### Deploy CrewAI Worker
```bash
cd apps/crewai-worker
railway login
railway init
railway up

# Set environment variables in Railway dashboard:
# API_KEY=your_secure_api_key
# OPENAI_API_KEY=sk-...
# WEBHOOK_URL=your_convex_webhook_url
```

### Deploy Frontend
```bash  
cd apps/web
railway login
railway init
railway up

# Set environment variables in Railway dashboard:
# NEXT_PUBLIC_CONVEX_URL=your_convex_url
# NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

### Alternative: Deploy Both from Root
```bash
# Deploy CrewAI Worker
railway login
railway init --name genni-crewai-worker
railway up --service crewai-worker --detach
cd apps/crewai-worker && railway up

# Deploy Frontend  
cd ../..
railway init --name genni-frontend
railway up --service web --detach
cd apps/web && railway up
```

## What Was Fixed

### 1. Missing gunicorn (Critical Issue) ✅
- **Problem**: Railway deployments failed with "gunicorn: command not found"  
- **Solution**: Added `gunicorn==21.2.0` to requirements.txt

### 2. Wrong Port Binding ✅
- **Problem**: Hardcoded ports instead of Railway's $PORT
- **Solution**: Updated all configurations to use `$PORT` environment variable

### 3. Production-Ready Serving ✅
- **Frontend**: Nginx with proper static file serving, gzip, caching
- **Backend**: Gunicorn with Uvicorn workers for better performance

### 4. Docker Configuration ✅
- **Multi-stage builds** for smaller images
- **Security**: Non-root users
- **Health checks**: Proper health endpoints

## Troubleshooting

### If builds still fail:

1. **Check Railway logs** in dashboard
2. **Verify environment variables** are set
3. **Test locally** with Docker:

```bash
# Test CrewAI Worker
cd apps/crewai-worker
docker build -t crewai-worker .
docker run -p 8080:8080 -e PORT=8080 crewai-worker

# Test Frontend  
cd apps/web
docker build -t frontend .  
docker run -p 3000:80 -e PORT=80 frontend
```

### Common Railway Issues:
- **Build timeouts**: Use Docker builds for consistency
- **Memory limits**: Monitor usage in Railway dashboard  
- **Environment variables**: Set in Railway dashboard, not in code

## Verification

After deployment, test these endpoints:

### CrewAI Worker
- `https://your-crewai-app.railway.app/` - Should return service info
- `https://your-crewai-app.railway.app/health` - Should return health status
- `https://your-crewai-app.railway.app/docs` - FastAPI documentation

### Frontend  
- `https://your-frontend-app.railway.app/` - Should load React app
- Check browser network tab for proper static file serving
- Test routing (should work with nginx fallback to index.html)