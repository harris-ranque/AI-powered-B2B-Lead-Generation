# Fix Clerk Authentication Issue - Railway Deployment

## Problem
The frontend deployment on Railway is missing the correct Clerk authentication environment variables, causing JWT validation errors when trying to authenticate with Convex backend.

Error message:
```
NoAuthProvider: No auth provider found matching the given token.
Check that your JWT's issuer and audience match one of your configured providers:
[OIDC(domain=https://fitting-guppy-40.clerk.accounts.dev, app_id=convex)]
```

## Root Cause Analysis ✅

**Primary Issue**: The Railway frontend deployment (`genni-web` service) is missing the `VITE_CLERK_PUBLISHABLE_KEY` environment variable or has an incorrect value.

**Why This Happens**:
1. **Build-time Variable Injection**: Vite requires `VITE_` prefixed variables to be available during the Docker build process
2. **Railway Environment Variables**: Variables set in Railway UI must be properly passed to the Docker build as ARG and ENV
3. **Required vs Optional**: The app now treats `VITE_CLERK_PUBLISHABLE_KEY` as a required variable (not optional)

**Enhanced Diagnostics Added**:
- ✅ Enhanced error messages with step-by-step Railway fix instructions
- ✅ Build-time environment variable validation
- ✅ Production debugging logs with Clerk-specific error context
- ✅ Visual error screens with environment variable troubleshooting guides

## Solution

### 1. Set Frontend Environment Variables in Railway

Go to your Railway project and set the following environment variables for the **genni-web** service:

```bash
# REQUIRED - Clerk Authentication
VITE_CLERK_PUBLISHABLE_KEY=pk_test_Zml0dGluZy1ndXBweS00MC5jbGVyay5hY2NvdW50cy5kZXYk

# REQUIRED - Convex Backend
VITE_CONVEX_URL=https://dashing-coyote-96.convex.cloud

# REQUIRED - LangGraph Worker
VITE_CREWAI_URL=https://genni-crewai-worker-development.up.railway.app
VITE_CREWAI_API_KEY=RwB9UniidLvJ2yuoZjmxAFfzU4wBQGwbGHk9mjMJRf7XNjZDBUsoNe27fBvUR6EB

# REQUIRED - Google Maps
VITE_GOOGLE_MAPS_API_KEY=AIzaSyAICooqXbA4Y-uynijBknqbX1diR2Z4Z-8

# REQUIRED - Sentry
VITE_SENTRY_DSN=https://36e9685e6c01547edb367529d66a9f37@o4510006869360640.ingest.us.sentry.io/4510013890887680

# Optional - Stripe (if using payments)
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_your_stripe_publishable_key_here

# Production Mode
VITE_NODE_ENV=production
```

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