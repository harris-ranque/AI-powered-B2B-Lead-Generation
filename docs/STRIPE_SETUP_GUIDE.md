# Stripe Integration Setup Guide

Complete guide for configuring Stripe subscriptions in the Genni lead generation platform.

## Overview

The Genni platform includes a fully implemented Stripe integration for subscription management. You only need to configure your Stripe account and add the API keys - all subscription logic, webhooks, and user management are already built.

## What's Already Implemented

✅ **Complete Subscription System**:

- Checkout session creation and management
- Subscription lifecycle handling (create, update, cancel)
- Automatic plan upgrades/downgrades
- Usage tracking and plan limit enforcement
- Customer portal for billing management
- Comprehensive webhook processing
- Payment success/failure handling
- User plan synchronization

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

# Subscription Price IDs (from Stripe Dashboard)
VITE_STRIPE_PRO_PRICE_ID=price_...              # Professional monthly plan
VITE_STRIPE_PRO_PRICE_ID_YEARLY=price_...       # Professional yearly plan
VITE_STRIPE_BUSINESS_PRICE_ID=price_...          # Business monthly plan
VITE_STRIPE_BUSINESS_PRICE_ID_YEARLY=price_...   # Business yearly plan
```

## Stripe Dashboard Setup

### Step 1: Create Products

Go to **Products** in your Stripe Dashboard and create these two products:

#### Professional Plan Product

- **Name**: "Genni Professional"
- **Description**: "For growing businesses and sales teams"

#### Business Plan Product

- **Name**: "Genni Business"
- **Description**: "For established teams scaling their outreach"

### Step 2: Create Pricing Plans

For each product, create both monthly and yearly pricing:

#### Professional Plan Pricing

- **Monthly**: $149.00 USD per month, recurring
- **Yearly**: $119.00 USD per month, billed annually ($1,428/year)

#### Business Plan Pricing

- **Monthly**: $449.00 USD per month, recurring
- **Yearly**: $359.00 USD per month, billed annually ($4,308/year)

### Step 3: Get Price IDs

After creating the prices, copy the Price IDs (they start with `price_`) and add them to your frontend environment variables.

### Step 4: Configure Webhooks

1. Go to **Developers** → **Webhooks** in Stripe Dashboard
2. Click **Add endpoint**
3. Set **Endpoint URL** to: `https://your-convex-deployment.convex.site/api/stripe/webhook`
   - Replace with your actual Convex deployment URL
4. Select these events to listen for:
   - `checkout.session.completed`
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

## Production Deployment

### Before Going Live

1. **Switch to Live Keys**:
   - Replace all `sk_test_` and `pk_test_` keys with `sk_live_` and `pk_live_`
   - Update Price IDs with live product prices
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

### Stripe Dashboard Analytics

Monitor these sections in your Stripe Dashboard:

- **Overview**: Revenue, successful payments, failed payments
- **Subscriptions**: Active subscriptions, churn analysis
- **Customers**: Customer lifetime value, payment methods
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
4. ☐ Create monthly and yearly prices for each product
5. ☐ Copy Price IDs to frontend environment variables
6. ☐ Set up webhook endpoint in Stripe Dashboard
7. ☐ Copy webhook secret to backend environment
8. ☐ Test subscription flow with test cards
9. ☐ Deploy to production with live API keys
10. ☐ Monitor webhook delivery and subscription events

Your Stripe integration will be fully functional once these steps are complete!
