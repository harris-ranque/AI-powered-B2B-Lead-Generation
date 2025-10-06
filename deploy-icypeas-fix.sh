#!/bin/bash

# ICypeas Fix Deployment Script
# This script deploys the ICypeas API integration fixes to Convex

set -e  # Exit on error

echo "🚀 ICypeas Fix Deployment Script"
echo "=================================="
echo ""

# Check if we're in the right directory
if [ ! -d "apps/convex-backend" ]; then
    echo "❌ Error: Must run from repository root"
    echo "   Current directory: $(pwd)"
    exit 1
fi

cd apps/convex-backend

echo "📋 Pre-deployment checklist:"
echo ""
echo "1. ✅ Code changes implemented:"
echo "   - apps/convex-backend/convex/leads/enrichment/icypeas.ts"
echo "   - apps/convex-backend/convex/leads/enrichment/types.ts"
echo ""
echo "2. ✅ Local testing completed:"
echo "   - test-icypeas-complete.js passed all tests"
echo ""
echo "3. ⚠️  Schema validation issue:"
echo "   - Some old searches missing 'updatedAt' field"
echo "   - Need to fix before deployment"
echo ""

# Ask user if they want to continue
read -p "Have you fixed the schema validation issue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "❌ Deployment cancelled"
    echo ""
    echo "To fix schema validation issue:"
    echo "1. Delete old test searches from Convex dashboard, OR"
    echo "2. Run migration to add updatedAt field"
    echo ""
    exit 1
fi

echo ""
echo "🔄 Deploying to Convex..."
echo ""

# Deploy to dev first
echo "📦 Deploying to development environment..."
npx convex dev --once --until-success

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Deployment successful!"
    echo ""
    echo "🧪 Testing deployment..."
    echo ""
    echo "Please verify in Convex logs:"
    echo "  1. Go to: https://dashboard.convex.dev"
    echo "  2. Check logs for: [ICypeas] Search initiated successfully"
    echo "  3. Verify no more 'success=false' errors"
    echo ""
    echo "🎯 Next steps:"
    echo "  1. Test with real search in the app"
    echo "  2. Monitor logs for successful enrichment"
    echo "  3. If successful, deploy to production"
    echo ""
else
    echo ""
    echo "❌ Deployment failed"
    echo ""
    echo "Check the error messages above for details."
    echo ""
    exit 1
fi
