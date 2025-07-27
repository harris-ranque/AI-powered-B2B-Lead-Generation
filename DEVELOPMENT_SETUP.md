# Development Setup Guide

## Prerequisites

- Node.js 18+ and npm
- Python 3.11+
- pnpm (for development)
- Convex CLI: `npm install -g convex`

## Quick Start

### 1. Clone and Install Dependencies
```bash
git clone https://github.com/scavengerisland/genni.git
cd genni
npm install  # Will install all workspace dependencies
```

### 2. Set Up Environment Variables

#### Frontend (`apps/web/.env.local`)
```bash
cp apps/web/.env.local.example apps/web/.env.local
```

Edit `apps/web/.env.local`:
```env
# Get this from: npx convex dev (in genni-convex repo)
NEXT_PUBLIC_CONVEX_URL=https://your-dev-deployment.convex.cloud

# Stripe test keys
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_your_stripe_key

# Optional analytics
NEXT_PUBLIC_POSTHOG_KEY=phc_your_posthog_key
NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com
```

#### CrewAI Worker (`apps/crewai-worker/.env`)
```bash
cp apps/crewai-worker/.env.example apps/crewai-worker/.env
```

Edit `apps/crewai-worker/.env`:
```env
# Generate a secure API key
API_KEY=your_secure_random_api_key

# OpenAI API key
OPENAI_API_KEY=sk-your_openai_api_key

# Webhook URL (update after setting up Convex)
WEBHOOK_URL=https://your-dev-deployment.convex.cloud/api/webhook/crewai

PORT=8080
ENVIRONMENT=development
PYTHONUNBUFFERED=1
```

### 3. Set Up Convex Backend (Separate Repository)

The backend is in a separate repository. Follow these steps:

```bash
# Clone the backend repository
git clone https://github.com/your-org/genni-convex.git
cd genni-convex

# Install dependencies
npm install

# Set up environment variables
cp .env.local.example .env.local
# Edit .env.local with your API keys

# Start Convex development server
npx convex dev
```

This will give you a development URL like: `https://your-dev-deployment.convex.cloud`

### 4. Update Environment Variables with Convex URL

After starting Convex dev, update your environment files:

#### Frontend
Update `apps/web/.env.local`:
```env
NEXT_PUBLIC_CONVEX_URL=https://your-dev-deployment.convex.cloud
```

#### Worker
Update `apps/crewai-worker/.env`:
```env
WEBHOOK_URL=https://your-dev-deployment.convex.cloud/api/webhook/crewai
```

#### Convex Backend
Update `genni-convex/.env.local`:
```env
CREWAI_URL=http://localhost:8080
CREWAI_API_KEY=your_secure_random_api_key  # Same as worker API_KEY
```

### 5. Install Python Dependencies

```bash
cd apps/crewai-worker
pip install -r requirements.txt
```

### 6. Start Development Servers

#### Terminal 1: Convex Backend
```bash
cd genni-convex
npx convex dev
```

#### Terminal 2: Frontend + Worker
```bash
cd genni-app
npm run dev
```

This starts:
- Frontend: http://localhost:3000
- CrewAI Worker: http://localhost:8080

## Development Workflow

### Making Changes

1. **Frontend changes**: Edit files in `apps/web/src/`
2. **Worker changes**: Edit files in `apps/crewai-worker/app/`
3. **Backend changes**: Edit files in `genni-convex/convex/`

### Testing the Complete Flow

1. Open http://localhost:3000
2. Create a business profile
3. Start a lead search
4. Verify the flow:
   - Frontend → Convex → Worker → OpenAI → Webhook → Convex → Frontend

### Common Development Commands

```bash
# Install new frontend dependency
cd apps/web
npm install package-name

# Install new worker dependency
cd apps/crewai-worker
pip install package-name
echo "package-name" >> requirements.txt

# Build for production
npm run build

# Run linting
npm run lint

# Run type checking
npm run type-check
```

## Troubleshooting

### "Convex functions not found"
- Ensure Convex dev server is running
- Check that NEXT_PUBLIC_CONVEX_URL is correct
- Verify convex.json points to the right functions directory

### "Worker API not responding"
- Check that CrewAI worker is running on port 8080
- Verify .env file has correct OPENAI_API_KEY
- Check webhook URL in worker .env matches Convex deployment

### "Authentication issues"
- Ensure Auth0 or Convex Auth is properly configured
- Check environment variables match between frontend and backend

### "Network errors during pnpm install"
- Use npm instead: `npm install`
- Check internet connection and registry access

## Environment URLs

### Development
- Frontend: http://localhost:3000
- Worker: http://localhost:8080
- Convex: https://your-dev-deployment.convex.cloud

### Production
- Frontend: https://your-frontend.railway.app
- Worker: https://your-worker.railway.app
- Convex: https://your-prod-deployment.convex.cloud

## Next Steps

1. Follow this setup guide
2. Test the complete development flow
3. Make your changes
4. Deploy using Railway (see RAILWAY_DEPLOYMENT.md)