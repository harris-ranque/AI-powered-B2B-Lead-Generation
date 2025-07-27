#!/bin/bash

# Lead Eternity Development Startup Script
echo "🚀 Starting Lead Eternity Development Environment..."

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
    echo "❌ pnpm is required but not installed. Please install pnpm first:"
    echo "   npm install -g pnpm"
    exit 1
fi

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is required but not installed."
    exit 1
fi

echo "📦 Installing dependencies..."

# Install root dependencies
pnpm install

# Install Python dependencies for CrewAI worker
echo "🐍 Installing Python dependencies..."
cd apps/crewai-worker
pip install -r requirements.txt
cd ../..

echo "🔧 Setting up environment files..."

# Create .env files if they don't exist
if [ ! -f "apps/web/.env" ]; then
    cp apps/web/.env.example apps/web/.env
    echo "✅ Created apps/web/.env from example"
fi

if [ ! -f "apps/crewai-worker/.env" ]; then
    cp apps/crewai-worker/.env.example apps/crewai-worker/.env
    echo "✅ Created apps/crewai-worker/.env from example"
fi

echo ""
echo "⚙️  IMPORTANT: Configure your environment variables:"
echo "   1. Edit apps/crewai-worker/.env and add your OpenAI API key"
echo "   2. Edit apps/web/.env if needed for API endpoints"
echo ""
echo "🚀 Starting development servers..."
echo "   - Frontend: http://localhost:3000"
echo "   - CrewAI Worker: http://localhost:8080"
echo ""

# Start development servers using Turbo
pnpm dev