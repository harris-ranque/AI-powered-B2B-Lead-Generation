#!/bin/bash

# Test Docker Build with Railway Environment Variables
# This script simulates Railway's build process locally

echo "🐳 Testing Docker Build with Railway Environment Variables"
echo "========================================================"

# Set test environment variables (these would come from Railway)
export VITE_CONVEX_URL="https://dashing-coyote-96.convex.cloud"
export VITE_CLERK_PUBLISHABLE_KEY="pk_test_Zml0dGluZy1ndXBweS00MC5jbGVyay5hY2NvdW50cy5kZXYk"
export VITE_GOOGLE_MAPS_API_KEY="AIzaSyAICooqXbA4Y-uynijBknqbX1diR2Z4Z-8"
export VITE_SENTRY_DSN="https://36e9685e6c01547edb367529d66a9f37@o4510006869360640.ingest.us.sentry.io/4510013890887680"
export RAILWAY_ENVIRONMENT="production"

echo "📋 Environment Variables for Build:"
echo "→ VITE_CONVEX_URL: $VITE_CONVEX_URL"
echo "→ VITE_CLERK_PUBLISHABLE_KEY: ${VITE_CLERK_PUBLISHABLE_KEY:0:30}..."
echo "→ VITE_GOOGLE_MAPS_API_KEY: ${VITE_GOOGLE_MAPS_API_KEY:0:20}..."
echo "→ VITE_SENTRY_DSN: ${VITE_SENTRY_DSN:0:30}..."
echo "→ RAILWAY_ENVIRONMENT: $RAILWAY_ENVIRONMENT"
echo ""

# Build Docker image with build args (simulating Railway build)
echo "🔨 Building Docker image with build arguments..."
docker build \
  --build-arg VITE_CONVEX_URL="$VITE_CONVEX_URL" \
  --build-arg VITE_CLERK_PUBLISHABLE_KEY="$VITE_CLERK_PUBLISHABLE_KEY" \
  --build-arg VITE_GOOGLE_MAPS_API_KEY="$VITE_GOOGLE_MAPS_API_KEY" \
  --build-arg VITE_SENTRY_DSN="$VITE_SENTRY_DSN" \
  --build-arg RAILWAY_ENVIRONMENT="$RAILWAY_ENVIRONMENT" \
  --build-arg ENVIRONMENT="production" \
  --build-arg NODE_ENV="production" \
  -f Dockerfile \
  -t genni-web-test \
  ../..

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Docker build successful!"
  echo ""
  echo "🧪 Testing built image..."

  # Run container briefly to test
  docker run --rm -d -p 8080:80 --name genni-web-test-container genni-web-test

  # Wait a moment for container to start
  sleep 3

  # Test if the container is responding
  if curl -f http://localhost:8080 >/dev/null 2>&1; then
    echo "✅ Container is responding on port 8080"
    echo "🎉 Build and deployment test successful!"
  else
    echo "❌ Container not responding"
    echo "🔍 Container logs:"
    docker logs genni-web-test-container
  fi

  # Clean up
  docker stop genni-web-test-container 2>/dev/null || true
  docker rmi genni-web-test 2>/dev/null || true

else
  echo ""
  echo "❌ Docker build failed!"
  echo "🔍 This indicates an issue with the build configuration."
  exit 1
fi