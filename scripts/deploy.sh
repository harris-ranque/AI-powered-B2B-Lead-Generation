#!/bin/bash

# Genni App Deployment Script
echo "🚀 Deploying Genni App..."

# Build the project
echo "🏗️  Building project..."
pnpm install
pnpm build

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI is not installed. Please install it first:"
    echo "npm install -g @railway/cli"
    exit 1
fi

# Deploy Frontend (from its directory)
echo "🚂 Deploying Frontend to Railway..."
cd apps/web
railway up
cd ../..

# Deploy CrewAI Worker (from its directory)
echo "🤖 Deploying CrewAI Worker to Railway..."
cd apps/crewai-worker
railway up
cd ../..

echo "✅ Deployment started! Check Railway dashboard for status."
echo "Frontend URL: https://genni-frontend-production.up.railway.app"
echo "CrewAI Worker URL: https://genni-crewai-worker-production.up.railway.app"