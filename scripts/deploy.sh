#!/bin/bash

# Lead Eternity App Deployment Script
echo "🚀 Deploying Lead Eternity App..."

# Build the project
echo "🏗️  Building project..."
pnpm build

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI is not installed. Please install it first:"
    echo "npm install -g @railway/cli"
    exit 1
fi

# Deploy to Railway
echo "🚂 Deploying to Railway..."
railway up

echo "✅ Deployment started! Check Railway dashboard for status."