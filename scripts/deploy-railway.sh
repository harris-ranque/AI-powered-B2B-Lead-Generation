#!/bin/bash

# Deploy both services to Railway
# Usage: ./scripts/deploy-railway.sh

set -e

echo "🚀 Deploying Genni services to Railway..."

# Check if railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found. Install it first:"
    echo "npm install -g @railway/cli"
    exit 1
fi

# Login check
if ! railway whoami &> /dev/null; then
    echo "🔐 Please login to Railway first:"
    railway login
fi

echo ""
echo "📦 Deploying CrewAI Worker..."
echo "================================="
cd apps/crewai-worker

# Check if project is linked, if not prompt user
if ! railway status &> /dev/null; then
    echo "🔗 No Railway project linked. Please link to your CrewAI worker project:"
    echo "1. Go to railway.app and create a new project"
    echo "2. Run 'railway link' and select your project"
    echo "3. Re-run this script"
    exit 1
fi

# Deploy CrewAI worker
echo "Deploying CrewAI worker..."
railway up --detach

echo "✅ CrewAI worker deployed!"

cd ../..

echo ""
echo "🌐 Deploying Frontend..."
echo "======================="
cd apps/web

# Check if project is linked, if not prompt user  
if ! railway status &> /dev/null; then
    echo "🔗 No Railway project linked. Please link to your frontend project:"
    echo "1. Go to railway.app and create a new project"  
    echo "2. Run 'railway link' and select your project"
    echo "3. Re-run this script"
    exit 1
fi

# Build frontend first
echo "Building frontend..."
pnpm build

# Deploy frontend
echo "Deploying frontend..."
railway up --detach

echo "✅ Frontend deployed!"

cd ../..

echo ""
echo "🎉 Both services deployed successfully!"
echo ""
echo "Next steps:"
echo "1. Check deployment status in Railway dashboard"
echo "2. Set environment variables for both services"
echo "3. Test the deployed endpoints"
echo ""
echo "CrewAI Worker endpoints:"
echo "- / (health check)"
echo "- /health (detailed health)"
echo "- /docs (API documentation)"
echo ""
echo "Frontend:"
echo "- / (React application)"