#!/bin/sh
# Prebuild script for Railway to ensure Convex types are available
# Since Railway builds from apps/web directory, we need to handle Convex types locally

set -e

echo "Running prebuild for @genni/web..."

# Check if we're in Railway environment or local with Convex backend
if [ -d "../convex-backend" ]; then
  echo "Found convex-backend, running codegen..."
  cd ../convex-backend
  npx convex codegen
  echo "Copying generated files to web app..."
  cp -r convex/_generated ../web/convex/
  cd ../web
else
  echo "No convex-backend found (Railway build), using existing convex/_generated files"
  # On Railway, the files should already be in convex/_generated from the Dockerfile COPY
fi

echo "Prebuild complete!"