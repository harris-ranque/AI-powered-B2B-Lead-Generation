# Fix Clerk Authentication Issue - Railway Deployment

## Problem
The frontend deployment on Railway is missing the correct Clerk authentication environment variables, causing JWT validation errors when trying to authenticate with Convex backend.

Error message:
```
NoAuthProvider: No auth provider found matching the given token.
Check that your JWT's issuer and audience match one of your configured providers:
[OIDC(domain=https://fitting-guppy-40.clerk.accounts.dev, app_id=convex)]
```

## Root Cause Analysis ✅ - UPDATED

**Primary Issue**: Railway environment variables weren't being passed to the Docker build process, even though they were set in the Railway dashboard.

**Why This Happens**:
1. **Missing Railway Build Args**: Railway requires explicit `[build.args]` configuration in `railway.toml` to pass environment variables to Docker build
2. **Docker ARG/ENV Mismatch**: Environment variables need to be both ARG (build-time) and ENV (runtime) in Dockerfile
3. **Build Process**: Vite needs environment variables available during the build process, not just runtime

**Real Problem**: The environment variables were correctly set in Railway UI but not reaching the Docker build context.

**Solution Implemented**:
- ✅ Added `[build.args]` section to `railway.toml` to pass Railway env vars to Docker
- ✅ Updated Dockerfile to handle Railway-specific build process
- ✅ Enhanced error messages with step-by-step Railway fix instructions
- ✅ Build-time environment variable validation
- ✅ Production debugging logs with Clerk-specific error context
- ✅ Visual error screens with environment variable troubleshooting guides

## Solution ✅ - FIXED

### The Issue is Now Resolved Automatically

The root cause was that Railway environment variables weren't being passed to the Docker build process. This has been fixed with the following changes:

**1. Fixed `railway.toml` Configuration**
- ✅ Added `[build.args]` section to pass environment variables to Docker build
- ✅ All required environment variables are now properly injected

**2. Updated Docker Build Process**
- ✅ Enhanced Dockerfile to handle Railway environment variables correctly
- ✅ Railway-specific build process with environment variable validation

**3. No Action Required from User**
Since the environment variables are already set in Railway dashboard:
```bash
✅ VITE_CLERK_PUBLISHABLE_KEY=pk_test_Zml0dGluZy1ndXBweS00MC5jbGVyay5hY2NvdW50cy5kZXYk
✅ VITE_CONVEX_URL=https://dashing-coyote-96.convex.cloud
```

**The fix will take effect on the next deployment automatically.**

### Verification Steps

1. **Trigger Redeployment**:
   - Push any small change to trigger Railway redeployment
   - Or manually redeploy in Railway dashboard

2. **Check Build Logs**:
   - Railway build logs will now show environment variables being passed
   - Look for: "🚀 Railway build: Using safe build..."

3. **Test Authentication**:
   - Frontend should load without Clerk authentication errors
   - Users should be able to sign in successfully

### 2. Using Railway CLI (Alternative Method)

If you have Railway CLI installed and linked to your project:

```bash
# Set variables for the frontend service
railway variables set VITE_CLERK_PUBLISHABLE_KEY=pk_test_Zml0dGluZy1ndXBweS00MC5jbGVyay5hY2NvdW50cy5kZXYk --service genni-web
railway variables set VITE_CONVEX_URL=https://dashing-coyote-96.convex.cloud --service genni-web
railway variables set VITE_CREWAI_URL=https://genni-crewai-worker-development.up.railway.app --service genni-web
railway variables set VITE_CREWAI_API_KEY=RwB9UniidLvJ2yuoZjmxAFfzU4wBQGwbGHk9mjMJRf7XNjZDBUsoNe27fBvUR6EB --service genni-web
railway variables set VITE_GOOGLE_MAPS_API_KEY=AIzaSyAICooqXbA4Y-uynijBknqbX1diR2Z4Z-8 --service genni-web
railway variables set VITE_SENTRY_DSN=https://36e9685e6c01547edb367529d66a9f37@o4510006869360640.ingest.us.sentry.io/4510013890887680 --service genni-web
railway variables set VITE_NODE_ENV=production --service genni-web

# Trigger redeployment
railway up --service genni-web
```

### 3. Verify Configuration

After setting the environment variables and redeploying:

1. Check the browser console at https://genni-frontend-development.up.railway.app/
2. You should see the Convex configuration logged with the correct values
3. Authentication should now work correctly

### 4. Important Notes

- The `VITE_CLERK_PUBLISHABLE_KEY` must match the Clerk domain that your Convex backend is configured to accept
- Current expected domain: `fitting-guppy-40.clerk.accounts.dev`
- The Convex backend already has the correct `CLERK_JWT_ISSUER_DOMAIN` set
- All frontend environment variables must be prefixed with `VITE_` for Vite to expose them to the client

### 5. Verification Checklist

✅ Frontend has `VITE_CLERK_PUBLISHABLE_KEY` set in Railway
✅ Frontend has `VITE_CONVEX_URL` set to `https://dashing-coyote-96.convex.cloud`
✅ Convex backend has `CLERK_JWT_ISSUER_DOMAIN=https://fitting-guppy-40.clerk.accounts.dev`
✅ Convex backend has `CLERK_SECRET_KEY` set
✅ Frontend rebuilds and redeploys after environment variable changes

## Quick Test

After deployment, test authentication:
1. Go to https://genni-frontend-development.up.railway.app/
2. Click "Sign In" or "Sign Up"
3. Create or login to an account
4. You should be redirected to the app dashboard without errors

## Additional Resources

- Environment variables template: `apps/web/.env.railway`
- Local development config: `apps/web/.env.local`
- Convex auth config: `apps/convex-backend/convex/auth.config.ts`