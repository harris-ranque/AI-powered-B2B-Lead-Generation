#!/usr/bin/env node

/**
 * Railway Environment Variables Troubleshooting Script
 *
 * This script helps diagnose environment variable issues during Railway deployments.
 * It checks for required variables and validates their format.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.join(__dirname, '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=');
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  });
}

console.log('🔧 Railway Environment Variables Troubleshooting Script');
console.log('===================================================\n');

// Required environment variables for the frontend
const REQUIRED_VARS = {
  'VITE_CONVEX_URL': {
    required: true,
    format: /^https:\/\/.+\.convex\.cloud$/,
    description: 'Convex backend URL'
  },
  'VITE_CLERK_PUBLISHABLE_KEY': {
    required: true,
    format: /^pk_(test|live)_.+$/,
    description: 'Clerk authentication publishable key'
  }
};

const OPTIONAL_VARS = {
  'VITE_GOOGLE_MAPS_API_KEY': {
    required: false,
    format: /^AIza.+$/,
    description: 'Google Maps API key for Places Autocomplete'
  },
  'VITE_SENTRY_DSN': {
    required: false,
    format: /^https:\/\/.+@.+\.ingest\.us\.sentry\.io\/.+$/,
    description: 'Sentry error tracking DSN'
  },
  'VITE_STRIPE_PUBLISHABLE_KEY': {
    required: false,
    format: /^pk_(test|live)_.+$/,
    description: 'Stripe payment processing key'
  }
};

let hasErrors = false;
let hasWarnings = false;

console.log('🔍 Checking Required Environment Variables:');
console.log('-------------------------------------------');

// Check required variables
for (const [varName, config] of Object.entries(REQUIRED_VARS)) {
  const value = process.env[varName];

  if (!value) {
    console.log(`❌ ${varName}: MISSING`);
    console.log(`   → ${config.description}`);
    console.log(`   → This will cause authentication/connection failures`);
    hasErrors = true;
  } else if (!config.format.test(value)) {
    console.log(`❌ ${varName}: INVALID FORMAT`);
    console.log(`   → Expected format: ${config.format}`);
    console.log(`   → Current value: ${value.substring(0, 20)}...`);
    hasErrors = true;
  } else {
    console.log(`✅ ${varName}: OK`);
    console.log(`   → ${value.substring(0, 30)}...`);
  }
  console.log('');
}

console.log('🔍 Checking Optional Environment Variables:');
console.log('------------------------------------------');

// Check optional variables
for (const [varName, config] of Object.entries(OPTIONAL_VARS)) {
  const value = process.env[varName];

  if (!value) {
    console.log(`⚠️  ${varName}: MISSING (Optional)`);
    console.log(`   → ${config.description}`);
    console.log(`   → Feature will be disabled`);
    hasWarnings = true;
  } else if (!config.format.test(value)) {
    console.log(`⚠️  ${varName}: INVALID FORMAT`);
    console.log(`   → Expected format: ${config.format}`);
    console.log(`   → Current value: ${value.substring(0, 20)}...`);
    hasWarnings = true;
  } else {
    console.log(`✅ ${varName}: OK`);
    console.log(`   → ${value.substring(0, 30)}...`);
  }
  console.log('');
}

console.log('📊 Environment Summary:');
console.log('----------------------');
console.log(`Environment: ${process.env.NODE_ENV || 'undefined'}`);
console.log(`Railway Environment: ${process.env.RAILWAY_ENVIRONMENT || 'undefined'}`);
console.log(`Build Context: ${process.env.RAILWAY_BUILD || 'local'}`);
console.log('');

if (hasErrors) {
  console.log('🚨 ERRORS FOUND: Deployment will fail');
  console.log('');
  console.log('📋 Quick Fix for Railway:');
  console.log('1. Go to Railway dashboard → genni-web service → Variables');
  console.log('2. Add missing environment variables:');
  if (!process.env.VITE_CLERK_PUBLISHABLE_KEY) {
    console.log('   → VITE_CLERK_PUBLISHABLE_KEY=pk_test_Zml0dGluZy1ndXBweS00MC5jbGVyay5hY2NvdW50cy5kZXYk');
  }
  if (!process.env.VITE_CONVEX_URL) {
    console.log('   → VITE_CONVEX_URL=https://dashing-coyote-96.convex.cloud');
  }
  console.log('3. Redeploy the service');
  console.log('');
  process.exit(1);
} else if (hasWarnings) {
  console.log('⚠️  WARNINGS: Some optional features disabled');
  console.log('✅ Core functionality will work');
  process.exit(0);
} else {
  console.log('✅ ALL ENVIRONMENT VARIABLES CONFIGURED CORRECTLY');
  console.log('🚀 Ready for deployment!');
  process.exit(0);
}