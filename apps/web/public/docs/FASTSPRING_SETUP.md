# FastSpring Integration Setup Guide

Complete guide for setting up FastSpring payment processing for Genni.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [FastSpring Account Setup](#fastspring-account-setup)
3. [Create Products](#create-products)
4. [Generate API Credentials](#generate-api-credentials)
5. [Generate RSA Keypair](#generate-rsa-keypair)
6. [Configure Webhooks](#configure-webhooks)
7. [Set Environment Variables](#set-environment-variables)
8. [Testing](#testing)
9. [Go Live Checklist](#go-live-checklist)

---

## Prerequisites

- FastSpring account (sandbox for testing, production for live)
- Access to Railway dashboard (or your deployment platform)
- OpenSSL for generating RSA keypair
- Convex dashboard access

---

## FastSpring Account Setup

### Step 1: Create Account

1. Go to [FastSpring](https://fastspring.com/) and sign up for an account
2. Complete the onboarding process
3. Note your **Store ID** (found in Account Settings > Store Details)
   - Format: `yourstore.onfastspring.com` or just `yourstore`

### Step 2: Access Dashboard

1. Log in to [FastSpring Dashboard](https://app.fastspring.com/)
2. Navigate to **Storefronts** > **Popup Storefronts**
3. Enable the Popup Storefront for your store

---

## Create Products

### Credit Packs

Create a product for each credit pack you want to sell:

#### Product 1: 100 Credits
```
Product Path: credits-100
Display Name: 100 Credits
Price: $15.00 USD
Type: One-time purchase
```

#### Product 2: 500 Credits
```
Product Path: credits-500
Display Name: 500 Credits
Price: $65.00 USD
Type: One-time purchase
```

#### Product 3: 1000 Credits
```
Product Path: credits-1000
Display Name: 1,000 Credits
Price: $120.00 USD
Type: One-time purchase
```

#### Product 4: 2500 Credits
```
Product Path: credits-2500
Display Name: 2,500 Credits
Price: $280.00 USD
Type: One-time purchase
```

### Subscription Plans

Create subscription products for each plan:

#### Professional Plan (Monthly)
```
Product Path: professional-monthly
Display Name: Professional Plan (Monthly)
Price: $149.00 USD/month
Type: Subscription
Billing Cycle: Monthly
```

#### Professional Plan (Yearly)
```
Product Path: professional-yearly
Display Name: Professional Plan (Yearly)
Price: $1,428.00 USD/year ($119/month)
Type: Subscription
Billing Cycle: Yearly
```

#### Business Plan (Monthly)
```
Product Path: business-monthly
Display Name: Business Plan (Monthly)
Price: $449.00 USD/month
Type: Subscription
Billing Cycle: Monthly
```

#### Business Plan (Yearly)
```
Product Path: business-yearly
Display Name: Business Plan (Yearly)
Price: $4,308.00 USD/year ($359/month)
Type: Subscription
Billing Cycle: Yearly
```

### How to Create Products in FastSpring:

1. Go to **Products** in the sidebar
2. Click **Create Product**
3. Fill in:
   - **Product Path**: e.g., `credits-100` (this is used in code)
   - **Display Name**: e.g., "100 Credits"
   - **Pricing**: Set price in USD
   - **Fulfillment**: Select "Webhook" (we handle fulfillment via webhook)
4. Click **Save**

---

## Generate API Credentials

### Step 1: Create API User

1. Go to **Integrations** > **API Credentials**
2. Click **Create API User**
3. Enter a username (e.g., `genni-api`)
4. Generate or set a password
5. **Save these credentials securely!**

```
FASTSPRING_API_USERNAME=your_username
FASTSPRING_API_PASSWORD=your_password
```

### Step 2: Get Store ID and Access Key

1. Go to **Account** > **Store Settings**
2. Find your **Store ID** (e.g., `yourstore`)
3. Go to **Integrations** > **Store Builder Library**
4. Find your **Access Key** (for secure payloads)

```
FASTSPRING_STORE_ID=yourstore
FASTSPRING_ACCESS_KEY=your_access_key
```

---

## Generate RSA Keypair

FastSpring uses RSA encryption to secure checkout payloads (prevents price tampering).

### Generate Keys (macOS/Linux):

```bash
# Generate private key (2048-bit RSA)
openssl genrsa -out fastspring-private.pem 2048

# Extract public key
openssl rsa -in fastspring-private.pem -pubout -out fastspring-public.pem

# View private key (you'll need this for env var)
cat fastspring-private.pem
```

### Upload Public Key to FastSpring:

1. Go to **Integrations** > **Store Builder Library**
2. Find **Secure Payload** section
3. Click **Upload Public Key**
4. Upload `fastspring-public.pem`

### Format Private Key for Environment Variable:

The private key needs to be a single line with `\n` for newlines:

```bash
# Convert to single line
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' fastspring-private.pem
```

Or manually replace newlines with `\n`:

```
FASTSPRING_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhki...\n-----END PRIVATE KEY-----"
```

---

## Configure Webhooks

### Step 1: Create Webhook Endpoint

1. Go to **Integrations** > **Webhooks**
2. Click **Create Webhook**
3. Configure:
   - **URL**: `https://your-convex-url.convex.site/webhooks/fastspring`
   - **Events**: Select all of these:
     - `order.completed`
     - `subscription.activated`
     - `subscription.charge.completed`
     - `subscription.updated`
     - `subscription.canceled`
     - `subscription.deactivated`
     - `subscription.charge.failed`
   - **Format**: JSON
   - **HMAC Secret**: Generate a secure secret (32+ characters)

4. **Save the HMAC Secret!**

```
FASTSPRING_WEBHOOK_SECRET=your_webhook_secret_here
```

### Step 2: Find Your Convex HTTP URL

Your webhook URL follows this pattern:
```
https://[your-convex-deployment].convex.site/webhooks/fastspring
```

For example:
```
https://dashing-coyote-96.convex.site/webhooks/fastspring
```

---

## Set Environment Variables

### Frontend (.env.local in apps/web/)

```env
# FastSpring Store ID for popup checkout
VITE_FASTSPRING_STORE_ID=yourstore
```

### Backend (Convex Dashboard or .env.local in apps/convex-backend/)

Go to your Convex dashboard > Settings > Environment Variables and add:

```env
# FastSpring API Credentials
FASTSPRING_API_USERNAME=your_api_username
FASTSPRING_API_PASSWORD=your_api_password

# FastSpring Store Configuration
FASTSPRING_STORE_ID=yourstore
FASTSPRING_ACCESS_KEY=your_access_key

# Webhook Security
FASTSPRING_WEBHOOK_SECRET=your_webhook_hmac_secret

# RSA Private Key (for secure payloads)
FASTSPRING_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...\n-----END PRIVATE KEY-----"
```

### Railway Deployment

If deploying to Railway, add all environment variables in Railway dashboard:

1. Go to your Railway project
2. Click on the Convex service
3. Go to **Variables** tab
4. Add each variable

---

## Testing

### Test Mode vs Production

FastSpring provides a sandbox environment for testing:

1. Use test credit card: `4242 4242 4242 4242`
2. Any future expiry date
3. Any CVC

### Test Checkout Flow

1. Start your development servers:
   ```bash
   pnpm dev
   ```

2. Log in to the app
3. Go to Credits/Billing section
4. Try to purchase a credit pack
5. Complete checkout with test card
6. Verify:
   - Credits are added to your account
   - Transaction appears in credit history
   - Webhook was received (check Convex logs)

### Test Webhooks Locally

For local development, use ngrok or similar to expose your local Convex:

```bash
# Not typically needed - Convex dev handles this
# But for debugging, you can check Convex logs
npx convex logs
```

### Verify Webhook Delivery

1. Go to FastSpring dashboard > **Integrations** > **Webhooks**
2. Check **Delivery Logs** for your webhook
3. Verify events are being sent and received

---

## Go Live Checklist

Before going live, ensure:

- [ ] **FastSpring Account**
  - [ ] Account is activated (not sandbox)
  - [ ] Payment methods configured
  - [ ] Tax settings configured (if applicable)

- [ ] **Products**
  - [ ] All credit packs created with correct prices
  - [ ] All subscription plans created with correct prices
  - [ ] Product paths match code expectations

- [ ] **API & Security**
  - [ ] API credentials are production credentials
  - [ ] RSA keypair generated and public key uploaded
  - [ ] Webhook HMAC secret is strong (32+ chars)

- [ ] **Environment Variables**
  - [ ] All 7 variables set in production
  - [ ] No test/sandbox values in production

- [ ] **Webhooks**
  - [ ] Webhook URL points to production Convex
  - [ ] All required events selected
  - [ ] Test webhook delivery works

- [ ] **Testing**
  - [ ] Tested purchase flow end-to-end
  - [ ] Tested subscription signup
  - [ ] Tested subscription cancellation
  - [ ] Verified credits are added correctly

---

## Troubleshooting

### "VITE_FASTSPRING_STORE_ID environment variable is not set"

The frontend can't find the store ID. Check:
1. `apps/web/.env.local` has `VITE_FASTSPRING_STORE_ID=yourstore`
2. Restart dev server after adding env var

### Webhook Not Receiving Events

1. Check FastSpring webhook logs for delivery status
2. Verify webhook URL is correct
3. Check Convex logs for incoming requests:
   ```bash
   npx convex logs
   ```
4. Verify HMAC secret matches in FastSpring and Convex

### "Invalid signature" Webhook Error

The HMAC secret doesn't match:
1. Copy exact secret from FastSpring webhook config
2. Update `FASTSPRING_WEBHOOK_SECRET` in Convex
3. Redeploy Convex

### Credits Not Added After Purchase

1. Check Convex logs for webhook handling
2. Verify order contains correct product path
3. Check user lookup is finding the correct user
4. Look for idempotency check (duplicate order ID)

### RSA Encryption Errors

1. Verify private key format (single line with \n)
2. Ensure public key is uploaded to FastSpring
3. Check key pair matches (generated together)

---

## Environment Variable Summary

| Variable | Location | Description |
|----------|----------|-------------|
| `VITE_FASTSPRING_STORE_ID` | Frontend | Store ID for loading SBL script |
| `FASTSPRING_API_USERNAME` | Convex | API authentication username |
| `FASTSPRING_API_PASSWORD` | Convex | API authentication password |
| `FASTSPRING_STORE_ID` | Convex | Store ID for API calls |
| `FASTSPRING_ACCESS_KEY` | Convex | Access key for secure payloads |
| `FASTSPRING_WEBHOOK_SECRET` | Convex | HMAC secret for webhook verification |
| `FASTSPRING_PRIVATE_KEY` | Convex | RSA private key for encryption |

---

## Support

- FastSpring Documentation: https://docs.fastspring.com/
- FastSpring Support: https://fastspring.com/support/
- Genni Issues: Check the codebase or contact the development team
