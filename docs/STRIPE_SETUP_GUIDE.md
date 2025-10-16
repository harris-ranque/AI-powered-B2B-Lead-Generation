# Stripe Integration Setup Guide

Complete guide for configuring Stripe subscriptions and credit refills in the Genni lead generation platform.

## Overview

The Genni platform includes a fully implemented Stripe integration for subscription management and on-demand credit refills. You only need to configure your Stripe account, add the API keys, and map your products/prices—the backend already handles subscriptions, one-time purchases, webhooks, and ledgers.

## What's Already Implemented

✅ **Complete Subscription & Credits System**:

- Checkout session creation and management
- Subscription lifecycle handling (create, update, cancel)
- Automatic plan upgrades/downgrades
- Usage tracking and plan limit enforcement
- Customer portal for billing management
- Comprehensive webhook processing
- Payment success/failure handling
- User plan synchronization
- One-time credit refills through Stripe Checkout
- Admin-managed credit packs with optional bonuses
- Idempotent credit ledger updates tied to Stripe metadata

## Required Environment Variables

### Backend Configuration (`apps/convex-backend/.env.local`)

```env
# Stripe API Keys
STRIPE_SECRET_KEY=sk_test_51...  # Test key (starts with sk_test_) or Live key (sk_live_)
STRIPE_WEBHOOK_SECRET=whsec_...  # Webhook endpoint secret from Stripe Dashboard

# Other required variables (if not already set)
APP_URL=http://localhost:3000  # Your app URL for checkout redirects
```

### Frontend Configuration (`apps/web/.env.local`)

```env
# Stripe Publishable Key
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_51...  # Test key (pk_test_) or Live key (pk_live_)

# Display pricing (integer USD amounts used in marketing pages)
VITE_PRICING_STARTER_MONTHLY=0
VITE_PRICING_STARTER_YEARLY=0
VITE_PRICING_PROFESSIONAL_MONTHLY=149
VITE_PRICING_PROFESSIONAL_YEARLY=119
VITE_PRICING_BUSINESS_MONTHLY=449
VITE_PRICING_BUSINESS_YEARLY=359
VITE_PRICING_ENTERPRISE_MONTHLY=0
VITE_PRICING_ENTERPRISE_YEARLY=0

# Stripe Price IDs for paid plans (from Stripe Dashboard)
VITE_STRIPE_PROFESSIONAL_PRICE_ID_MONTHLY=price_...
VITE_STRIPE_PROFESSIONAL_PRICE_ID_YEARLY=price_...
VITE_STRIPE_BUSINESS_PRICE_ID_MONTHLY=price_...
VITE_STRIPE_BUSINESS_PRICE_ID_YEARLY=price_...
VITE_STRIPE_ENTERPRISE_PRICE_ID_MONTHLY=price_...
VITE_STRIPE_ENTERPRISE_PRICE_ID_YEARLY=price_...
```

> Starter is free and does not require a Stripe price. The environment variables are still required so the pricing validation in `pricing-config.ts` passes during build and runtime.

## Configure Plans & Credit Packs in Genni

1. Sign in as an admin and open `/admin`.
2. In **Billing → Plan Catalog**, create or update entries for each plan you sell:
   - The `planId` should match the internal identifier (e.g., `professional`, `business`, `enterprise`).
   - Paste the recurring Stripe Price IDs (monthly and yearly) created in Stripe.
   - Set the USD prices and feature list to match what you advertise.
3. In **Billing → Credit Packs**, define the one-time credit refills:
   - `credits`: the total credits delivered (include any promotional bonus credits).
   - `priceCents`: price shown in the UI; when `stripePriceId` is empty, this amount is sent to Stripe.
   - `bonus` (optional): extra credits surfaced in marketing copy.
   - `stripePriceId` (optional but recommended): one-time Price ID from Stripe for accurate accounting.
   - `active`: toggle visibility without deleting archived packs.
4. Click **Save** in both sections. The configuration is stored in Convex `systemConfiguration` and exposed to the frontend via `/api/public/config`, so you can update offerings without redeploying.

## Stripe Dashboard Setup

### Step 1: Create Products

Go to **Products** in your Stripe Dashboard and create these two products:

#### Professional Plan Product

- **Name**: "Genni Professional"
- **Description**: "For growing businesses and sales teams"

#### Business Plan Product

- **Name**: "Genni Business"
- **Description**: "For established teams scaling their outreach"

### Step 2: Create Recurring Pricing Plans

For each product, create both monthly and yearly pricing:

#### Professional Plan Pricing

- **Monthly**: $149.00 USD per month, recurring
- **Yearly**: $119.00 USD per month, billed annually ($1,428/year)

#### Business Plan Pricing

- **Monthly**: $449.00 USD per month, recurring
- **Yearly**: $359.00 USD per month, billed annually ($4,308/year)

Repeat for any additional plans (for example Enterprise) that will use Stripe Checkout.

### Step 3: Create One-Time Credit Pack Products

1. For each credit refill you plan to sell (e.g., 500 credits, 1,000 credits), create a **Product** in your Stripe Dashboard named clearly such as "Genni Credits – 500".
2. Add a **One time** price whose amount matches the `priceCents` you configured in the admin dashboard.
3. Copy each Price ID (starts with `price_`) so you can paste it into the corresponding credit pack (`stripePriceId`). If you skip this, Stripe Checkout will still work using the configured amount, but reporting will show a generic "Genni Credits Pack" product.

### Step 4: Link Price IDs in the App

1. Update the environment variables in `apps/web/.env.local` with the recurring plan Price IDs.
2. Paste the credit pack Price IDs into the admin dashboard configuration and save.
3. Restart local dev servers (or redeploy) so changes are picked up.

### Step 5: Configure Webhooks

1. Go to **Developers** → **Webhooks** in Stripe Dashboard
2. Click **Add endpoint**
3. Set **Endpoint URL** to: `https://your-convex-deployment.convex.site/api/stripe/webhook`
   - Replace with your actual Convex deployment URL
4. Select these events to listen for:
   - `checkout.session.completed` (subscriptions and one-time credit purchases)
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Copy the **Signing secret** (starts with `whsec_`) to your backend environment

## Plan Features & Limits

### Professional Plan ($149/month, $119/month yearly)

- 50 searches per month
- Up to 500 leads per search
- 25,000 lead enrichments per month
- 100 exports per month
- Managed API keys included
- Advanced AI analysis
- Email generation
- API access
- Priority support

### Business Plan ($449/month, $359/month yearly)

- 200 searches per month
- Up to 2,000 leads per search
- 100,000 lead enrichments per month
- 500 exports per month
- Managed API keys included
- Advanced AI analysis
- Email generation & sequences
- Full API access
- Team collaboration
- Custom reporting
- CRM integrations

## Testing the Integration

### Development Testing (Test Mode)

1. Use Stripe test API keys (starting with `sk_test_` and `pk_test_`)
2. Create test products and prices in Stripe Dashboard test mode
3. Use Stripe's test card numbers for checkout:
   - Success: `4242 4242 4242 4242`
   - Declined: `4000 0000 0000 0002`

### Test Scenarios

1. **Successful Subscription**:
   - Go to `/subscribe/professional` or `/subscribe/business`
   - Complete checkout with test card
   - Verify user plan is updated in database
   - Check webhook logs in Stripe Dashboard

2. **Plan Changes**:
   - Test upgrading from Professional to Business
   - Test downgrading plans
   - Test cancellation at period end

3. **Payment Failures**:
   - Use declined test card to test payment failure handling
   - Verify retry logic and user notifications

4. **Credit Refill Purchase**:
   - Ensure at least one credit pack is active in the admin dashboard.
   - Purchase the pack from the dashboard (Stripe Checkout will open in `payment` mode).
   - Confirm the user’s credit balance increases and a `creditTransactions` document with `type: "purchase"` is created.
   - Replay the webhook via the Stripe Dashboard to verify idempotency (no duplicate credits when the same session is processed twice).

## Production Deployment

### Before Going Live

1. **Switch to Live Keys**:
   - Replace all `sk_test_` and `pk_test_` keys with `sk_live_` and `pk_live_`
   - Update recurring plan and credit pack Price IDs with their live counterparts
   - Update webhook endpoint to production URL

2. **Security Checklist**:
   - ✅ Webhook signature verification is implemented
   - ✅ API key validation is in place
   - ✅ HTTPS is used for all endpoints
   - ✅ Environment variables are secure

3. **Test Production Setup**:
   - Verify webhook endpoint responds correctly
   - Test with small real payment first
   - Monitor Stripe Dashboard for successful events

## Troubleshooting

### Common Issues

**Webhook Not Receiving Events**:

- Verify webhook URL is correct and accessible
- Check webhook signature matches your `STRIPE_WEBHOOK_SECRET`
- Review webhook logs in Stripe Dashboard

**Price ID Not Found**:

- Ensure Price IDs in environment variables match Stripe Dashboard
- Verify you're using the correct test/live mode keys

**Checkout Session Creation Fails**:

- Check that `STRIPE_SECRET_KEY` is correctly set
- Verify Price IDs exist and are active
- Review Convex function logs for detailed errors

**User Plan Not Updating**:

- Check webhook events are being received
- Review subscription event logs in database
- Verify user has `stripeCustomerId` field populated

**Credit Refill Not Applying**:

- Ensure the credit pack is marked `active` and the Stripe checkout session contains metadata `type=credits_purchase`
- Confirm `checkout.session.completed` events are enabled on your webhook endpoint
- Check Convex `creditTransactions` for an existing row with the same `stripePaymentId` (idempotency will block duplicates)

### Useful Stripe CLI Commands

```bash
# Listen to webhooks locally for testing
stripe listen --forward-to localhost:3000/api/stripe/webhook

# Test specific webhook events
stripe trigger checkout.session.completed
stripe trigger customer.subscription.created
```

## Monitoring & Analytics

### Key Metrics to Track

- **Subscription Conversion Rate**: Checkout sessions created vs completed
- **Plan Distribution**: Professional vs Business plan adoption
- **Churn Rate**: Subscription cancellations over time
- **Payment Success Rate**: Successful vs failed payments
- **Usage Patterns**: How users utilize their plan limits
- **Credit Refill Volume**: One-time purchases, bonus utilization, and refill cadence

### Stripe Dashboard Analytics

Monitor these sections in your Stripe Dashboard:

- **Overview**: Revenue, successful payments, failed payments
- **Subscriptions**: Active subscriptions, churn analysis
- **Customers**: Customer lifetime value, payment methods
- **Payments**: One-time credit purchases and refund activity
- **Events**: Webhook delivery success rates

## Support & Maintenance

### Regular Tasks

- **Monthly**: Review failed payments and follow up with customers
- **Quarterly**: Analyze plan usage and consider limit adjustments
- **Annually**: Review pricing strategy and plan features

### Customer Support Integration

The system includes:

- Automatic email notifications for payment events
- Customer portal for self-service billing management
- Admin dashboard for support team to view billing status
- Detailed subscription event logging for troubleshooting

## Security Considerations

- All webhook payloads are verified using Stripe signatures
- API keys are validated for all webhook endpoints
- User authentication is required for all billing operations
- Sensitive payment data never touches your servers (handled by Stripe)
- All billing operations are logged for audit trails

---

## Quick Start Checklist

1. ☐ Create Stripe account and get API keys
2. ☐ Add environment variables to both backend and frontend
3. ☐ Create Professional and Business products in Stripe
4. ☐ Create monthly and yearly prices for each subscription product
5. ☐ Create one-time products/prices for each credit pack
6. ☐ Update frontend env vars with recurring plan Price IDs
7. ☐ Configure plan catalog and credit packs in the admin dashboard
8. ☐ Paste one-time credit pack Price IDs into the admin dashboard
9. ☐ Set up webhook endpoint in Stripe Dashboard and store the signing secret
10. ☐ Test subscriptions and credit refills with Stripe test cards
11. ☐ Deploy to production with live API keys and monitor webhooks/credit transactions

Your Stripe integration will be fully functional once these steps are complete!
