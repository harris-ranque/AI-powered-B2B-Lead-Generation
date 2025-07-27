#!/bin/bash

# Genni App Setup Script
echo "🚀 Setting up Genni App..."

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
    echo "❌ pnpm is not installed. Please install pnpm first:"
    echo "npm install -g pnpm"
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install

# Create environment files from templates
echo "🔧 Creating environment files..."

# Web app environment
if [ ! -f "apps/web/.env.local" ]; then
    cp "apps/web/.env.example" "apps/web/.env.local" 2>/dev/null || echo "# Add your environment variables here" > "apps/web/.env.local"
    echo "✅ Created apps/web/.env.local"
fi

# CrewAI worker environment
if [ ! -f "apps/crewai-worker/.env" ]; then
    cp "apps/crewai-worker/.env.example" "apps/crewai-worker/.env" 2>/dev/null || echo "# Add your environment variables here" > "apps/crewai-worker/.env"
    echo "✅ Created apps/crewai-worker/.env"
fi

echo "✨ Setup complete! Next steps:"
echo "1. Configure your environment variables in .env files"
echo "2. Run 'pnpm dev' to start development servers"
echo "3. Set up your Convex backend separately"