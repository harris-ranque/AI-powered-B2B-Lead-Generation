# Pricing Change Management Guide

Complete mapping of all locations where pricing information exists and how to make consistent changes across the entire system.

## 🚨 CRITICAL: All Locations Must Be Updated Together

When changing prices, **ALL** of these locations must be updated simultaneously to maintain consistency:

## 1. Frontend UI Pricing Display

### Primary Locations

#### `/apps/web/src/pages/PricingPage.tsx` - Main pricing page

**Lines 64-65, 89-90, 116-117**

```typescript
// Professional Plan
monthlyPrice: 149,
annualPrice: 119,

// Business Plan
monthlyPrice: 449,
annualPrice: 359,

// Enterprise Plan
monthlyPrice: 999,
annualPrice: 799,
```

#### `/apps/web/src/pages/Subscribe.tsx` - Subscription checkout

**Lines 35-36, 61-62**

```typescript
// Professional Plan
monthlyPrice: 149,
yearlyPrice: 119,

// Business Plan
monthlyPrice: 449,
yearlyPrice: 359,
```

#### `/apps/web/src/pages/LandingPage.tsx` - Landing page pricing

**Lines 122, 136** (Hardcoded in JSX)

```typescript
price: "$0",    // Free plan
price: "$49",   // Pro plan (old pricing)
```

### Test Files

#### `/apps/web/src/utils/subscriptionFlowTest.ts`

**Lines 66-68, 79**

```typescript
"Professional plan shows $149/month",
"Business plan shows $449/month",
"Enterprise plan shows $999/month",
"Price shows $149/month",
```

## 2. Backend Mechanical Logic

### Plan Detection & Limits

#### `/apps/convex-backend/convex/billing/webhooks.ts`

**Lines 6-11** - Price ID to Plan mapping

```typescript
function getPlanFromPriceId(
  priceId: string,
): "starter" | "professional" | "business" | "enterprise" {
  if (priceId?.includes("professional") || priceId?.includes("pro"))
    return "professional";
  if (priceId?.includes("business")) return "business";
  if (priceId?.includes("enterprise")) return "enterprise";
  return "starter";
}
```

#### `/apps/convex-backend/convex/middleware/subscriptionMiddleware.ts`

**Lines 18-59** - Plan limits (no pricing info, just features)

### Environment Variables (Frontend)

#### `/apps/web/.env.local`

```env
VITE_STRIPE_PRO_PRICE_ID=price_...
VITE_STRIPE_PRO_PRICE_ID_YEARLY=price_...
VITE_STRIPE_BUSINESS_PRICE_ID=price_...
VITE_STRIPE_BUSINESS_PRICE_ID_YEARLY=price_...
```

## 3. Stripe Configuration

### Products & Prices (Stripe Dashboard)

- **Professional Monthly**: $149.00 USD per month
- **Professional Yearly**: $119.00 USD per month (billed annually)
- **Business Monthly**: $449.00 USD per month
- **Business Yearly**: $359.00 USD per month (billed annually)
- **Enterprise Monthly**: $999.00 USD per month
- **Enterprise Yearly**: $799.00 USD per month (billed annually)

### Price IDs

After creating new prices in Stripe, copy the new `price_xxxxx` IDs to environment variables.

## 4. Documentation Files

#### `/STRIPE_SETUP_GUIDE.md`

**Lines 66-67, 70-71, 94, 105**

```markdown
- **Monthly**: $149.00 USD per month, recurring
- **Yearly**: $119.00 USD per month, billed annually ($1,428/year)
- **Monthly**: $449.00 USD per month, recurring
- **Yearly**: $359.00 USD per month, billed annually ($4,308/year)

### Professional Plan ($149/month, $119/month yearly)

### Business Plan ($449/month, $359/month yearly)
```

#### `/SUBSCRIPTION_SYSTEM_VALIDATION.md`

**Line 24**

```markdown
- [x] **4-tier system**: Starter ($0) → Professional ($149) → Business ($449) → Enterprise ($999)
```

## 🔧 Step-by-Step Pricing Change Process

### Phase 1: Frontend UI Updates

1. **Update `/apps/web/src/pages/PricingPage.tsx`**
   - Change `monthlyPrice` and `annualPrice` for each plan
   - Ensure annual savings calculations are correct

2. **Update `/apps/web/src/pages/Subscribe.tsx`**
   - Change `monthlyPrice` and `yearlyPrice` to match PricingPage
   - Verify checkout calculations are consistent

3. **Update `/apps/web/src/pages/LandingPage.tsx`**
   - Change hardcoded `price` strings in JSX
   - Consider if landing page should match main pricing

4. **Update test files**
   - `/apps/web/src/utils/subscriptionFlowTest.ts` - Update expected price strings

### Phase 2: Stripe Configuration

1. **Create new products/prices in Stripe Dashboard**
   - Professional: New monthly and yearly prices
   - Business: New monthly and yearly prices
   - Enterprise: New monthly and yearly prices

2. **Copy new Price IDs to environment variables**
   - Update `VITE_STRIPE_*_PRICE_ID` variables in `/apps/web/.env.local`
   - Deploy environment variable changes

### Phase 3: Backend Verification

1. **Verify price ID detection logic in `/apps/convex-backend/convex/billing/webhooks.ts`**
   - Ensure `getPlanFromPriceId()` correctly maps new price IDs to plans
   - Update string matching logic if needed

2. **Test webhook processing**
   - Verify subscription creation/updates work with new price IDs

### Phase 4: Documentation Updates

1. **Update `/STRIPE_SETUP_GUIDE.md`**
   - Change all price references
   - Update calculated yearly totals

2. **Update `/SUBSCRIPTION_SYSTEM_VALIDATION.md`**
   - Update 4-tier pricing summary

## 🧪 Testing Checklist

### Frontend Testing

- [ ] PricingPage displays new prices correctly
- [ ] Subscribe page matches PricingPage prices
- [ ] Annual/monthly toggle calculations correct
- [ ] Checkout flow shows correct amounts

### Backend Testing

- [ ] Webhook correctly processes new price IDs
- [ ] Plan assignment works with new prices
- [ ] Subscription updates handle price changes

### Stripe Testing

- [ ] Checkout sessions created with correct amounts
- [ ] Webhooks fire correctly for new prices
- [ ] Customer portal shows correct pricing

## 🚨 Common Pitfalls

### Price ID Mismatches

- **Problem**: Frontend shows new prices but uses old Stripe Price IDs
- **Solution**: Ensure environment variables are updated AND deployed

### Inconsistent Calculations

- **Problem**: Annual savings percentages don't match new pricing
- **Solution**: Recalculate all percentage-based discounts

### Webhook Failures

- **Problem**: New price IDs not recognized by `getPlanFromPriceId()`
- **Solution**: Update string matching logic in webhooks

### Test Data Stale

- **Problem**: Test files expect old pricing, causing CI failures
- **Solution**: Update all test assertions and mock data

## 📊 Pricing Consistency Formula

When changing prices, ensure these relationships remain consistent:

```
Annual Price = Monthly Price × 12 × (1 - Annual Discount %)
Current Annual Discount = 20% (0.8 multiplier)

Example:
If Monthly = $200
Then Annual = $200 × 12 × 0.8 = $1,920/year = $160/month
```

## 🔄 Deployment Order

1. **Update Stripe first** - Create new prices, get Price IDs
2. **Update environment variables** - Deploy new Price IDs
3. **Deploy frontend changes** - New UI pricing
4. **Update documentation** - Keep docs in sync
5. **Monitor webhooks** - Ensure backend processes new prices correctly

## 🎯 Centralized Configuration Recommendation

**Consider creating a shared pricing configuration:**

```typescript
// packages/shared-types/src/pricing.types.ts
export const PRICING_CONFIG = {
  professional: { monthly: 149, yearly: 119 },
  business: { monthly: 449, yearly: 359 },
  enterprise: { monthly: 999, yearly: 799 },
} as const;
```

Import this in all frontend components to ensure consistency and make future price changes require only one file edit.

---

## Quick Reference

**Current Pricing (as of January 2025):**

- Professional: $149/month, $119/month yearly
- Business: $449/month, $359/month yearly
- Enterprise: $999/month, $799/month yearly

**To change pricing: Update ALL 15+ locations above in coordinated deployment.**
