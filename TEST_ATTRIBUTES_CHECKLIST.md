# Test Attributes Implementation Checklist

This document tracks the implementation of all 54 required `data-testid` attributes for E2E testing.

## Progress: 37/54 attributes added (69%)

---

## ✅ Authentication Attributes (4/4 complete)

### **`sign-up-button`** ✅
- **File**: `apps/web/src/components/auth/ClerkAuthWrapper.tsx:27`
- **Component**: ClerkAuthWrapper (signup mode)
- **Status**: Added to container div wrapping SignUp component

### **`sign-in-button`** ✅
- **File**: `apps/web/src/components/auth/ClerkAuthWrapper.tsx:115`
- **Component**: ClerkAuthWrapper (signin mode)
- **Status**: Added to container div wrapping SignIn component

### **`user-menu`** ✅
- **File**: `apps/web/src/components/auth/ClerkAuthWrapper.tsx:158`
- **Component**: ClerkUserButton wrapper
- **Status**: Added to wrapper div around UserButton

### **`user-profile`** ✅
- **File**: `apps/web/src/components/Settings.tsx:352`
- **Component**: Settings account card
- **Status**: Added to Account Settings Card component

---

## ✅ Search Form Attributes (5/5 complete)

### **`business-type-input`** ✅
- **File**: `apps/web/src/components/SearchPage.tsx`
- **Component**: Search form business type input field
- **Status**: Added to business type input element

### **`location-input`** ✅
- **File**: `apps/web/src/components/SearchPage.tsx`
- **Component**: Search form location input field
- **Status**: Added to location input element

### **`radius-input`** ✅
- **File**: `apps/web/src/components/pipeline/LeadDiscoveryStage.tsx`
- **Component**: Search form radius slider
- **Status**: Added to radius slider element

### **`max-results-input`** ✅
- **File**: `apps/web/src/components/SearchPage.tsx`
- **Component**: Search form max results input field
- **Status**: Added to max results input element

### **`create-search-button`** ✅
- **File**: `apps/web/src/components/SearchPage.tsx`
- **Component**: Search form submit button
- **Status**: Added to create/submit button element

---

## ✅ Search Status & History Attributes (3/3 complete)

### **`search-status`** ✅
- **File**: `apps/web/src/components/SearchProgressTracker.tsx`
- **Component**: Search status badge
- **Status**: Added with `data-status` attribute

### **`search-history`** ✅
- **File**: `apps/web/src/components/LeadSearchHistory.tsx`
- **Component**: Search history container
- **Status**: Added to search history list container

### **`search-history-item`** ✅
- **File**: `apps/web/src/components/LeadSearchHistory.tsx`
- **Component**: Individual search history Card
- **Status**: Added to each search Card element

---

## ⚠️ Pipeline Monitoring Attributes (4/10 partial)

### **`pipeline-stage`** ✅
- **File**: `apps/web/src/components/SearchProgressTracker.tsx`
- **Component**: Pipeline stage indicator
- **Status**: Added with `data-stage-name` and `data-stage-status` attributes

### **`pipeline-error`** ⏳
- **Expected File**: Pipeline error display component
- **Component**: Error message display
- **Action**: Add to error message element

### **`discovery-progress`** ⏳
- **Expected File**: Pipeline stage components
- **Component**: Discovery stage progress indicator
- **Action**: Add to discovery progress element

### **`enrichment-progress`** ⏳
- **Expected File**: Pipeline stage components
- **Component**: Enrichment stage progress indicator
- **Action**: Add to enrichment progress element

### **`enrichment-batch-progress`** ⏳
- **Expected File**: Pipeline enrichment component
- **Component**: Batch processing progress
- **Action**: Add to batch progress indicator

### **`enrichment-rate-info`** ⏳
- **Expected File**: Pipeline enrichment component
- **Component**: Rate limit information display
- **Action**: Add to rate limit info element

### **`enrichment-leads-status`** ⏳
- **Expected File**: Pipeline enrichment component
- **Component**: Current/total leads status (e.g., "5 / 15")
- **Action**: Add to leads status text element

### **`analysis-progress`** ⏳
- **Expected File**: Pipeline stage components
- **Component**: AI analysis stage progress indicator
- **Action**: Add to analysis progress element

### **`leads-discovered-count`** ✅
- **File**: `apps/web/src/components/SearchProgressTracker.tsx`
- **Component**: Count of discovered leads
- **Status**: Added to discovery stage count display

### **`leads-enriched-count`** ✅
- **File**: `apps/web/src/components/SearchProgressTracker.tsx`
- **Component**: Count of enriched leads
- **Status**: Added to enrichment stage count display

### **`leads-analyzed-count`** ✅
- **File**: `apps/web/src/components/SearchProgressTracker.tsx`
- **Component**: Count of analyzed leads
- **Status**: Added to analysis stage count display

---

## ✅ Results Display Attributes (7/7 complete)

### **`lead-card`** ✅
- **File**: `apps/web/src/components/EnhancedLeadCard.tsx`
- **Component**: Lead card container
- **Status**: Added to Card wrapper element

### **`lead-business-name`** ✅
- **File**: `apps/web/src/components/EnhancedLeadCard.tsx`
- **Component**: Business name display
- **Status**: Added to CardTitle element

### **`lead-contact-info`** ✅
- **File**: `apps/web/src/components/EnhancedLeadCard.tsx`
- **Component**: Contact information section
- **Status**: Added to contact info grid container

### **`lead-email`** ✅
- **File**: `apps/web/src/components/EnhancedLeadCard.tsx`
- **Component**: Email address display
- **Status**: Added to email display element

### **`lead-relevance-score`** ✅
- **File**: `apps/web/src/components/EnhancedLeadCard.tsx`
- **Component**: AI relevance score display
- **Status**: Added to relevance score container

### **`results-count`** ✅
- **File**: `apps/web/src/components/LeadSearchHistory.tsx`
- **Component**: Total results count display
- **Status**: Added to leads found count display

### **`export-csv-button`** ✅
- **File**: `apps/web/src/components/LeadSearchHistory.tsx`
- **Component**: CSV export button
- **Status**: Added to export Button element

---

## ⚠️ Credit Management Attributes (3/8 partial)

### **`credit-balance`** ✅
- **File**: `apps/web/src/components/CreditManager.tsx`
- **Component**: Credit balance display
- **Status**: Added to balance display element

### **`buy-credits-button`** ✅
- **File**: `apps/web/src/components/CreditManager.tsx`
- **Component**: Buy credits button
- **Status**: Added to purchase Button element

### **`credit-package`** ✅
- **File**: `apps/web/src/components/CreditManager.tsx`
- **Component**: Credit package option container
- **Status**: Added to each package card with `data-credit-amount` attribute

### **`credit-amount-{N}`** ✅
- **File**: `apps/web/src/components/CreditManager.tsx`
- **Component**: Specific credit package buttons
- **Status**: Implemented via `data-credit-amount` attribute on credit-package

### **`submit-payment-button`** ⏳
- **Expected File**: Stripe payment form component
- **Component**: Payment submission button
- **Action**: Add to Stripe payment submit button (Stripe Elements component)

### **`payment-success`** ⏳
- **Expected File**: Payment confirmation component
- **Component**: Success message/indicator
- **Action**: Add to success message element

### **`transaction-history`** ⏳
- **Expected File**: Billing/transaction history component
- **Component**: Transaction list container
- **Action**: Add to transaction history container

### **`transaction-item`** ⏳
- **Expected File**: Transaction history component
- **Component**: Individual transaction row
- **Action**: Add with `data-type` attribute (purchase, usage, refund)

---

## ⚠️ Metrics & Additional Attributes (6/12 partial)

### **`total-leads`** ✅
- **File**: `apps/web/src/components/pipeline/ReviewExportStage.tsx`
- **Component**: Total leads metric
- **Status**: Added to leads discovered count display

### **`total-duration`** ✅
- **File**: `apps/web/src/components/LeadSearchHistory.tsx`
- **Component**: Pipeline duration display
- **Status**: Added to duration display element

### **`avg-relevance-score`** ✅
- **File**: `apps/web/src/components/pipeline/ReviewExportStage.tsx`
- **Component**: Average relevance score
- **Status**: Added to average relevance score display

### **`completed-at`** ✅
- **File**: `apps/web/src/components/SearchProgressTracker.tsx`
- **Component**: Completion timestamp
- **Status**: Added to timestamp element

### **`estimated-cost`** ✅
- **File**: `apps/web/src/components/DashboardOverview.tsx`
- **Component**: Cost estimate display
- **Status**: Added to average cost per lead display

### **`no-results-message`** ✅
- **File**: `apps/web/src/components/LeadSearchHistory.tsx` & `DashboardOverview.tsx`
- **Component**: Empty results message
- **Status**: Added to empty state message elements

### **`partial-results-warning`** ⏳
- **Expected File**: Search results warning component
- **Component**: Partial results warning
- **Action**: Add to warning message element

### **`enrichment-error-details`** ⏳
- **Expected File**: Lead enrichment error component
- **Component**: Enrichment error explanation
- **Action**: Add to error details element

### **`lead-enrichment-failed`** ⏳
- **Expected File**: Lead card component
- **Component**: Failed enrichment indicator
- **Action**: Add to failed lead elements

### **`retry-enrichment-button`** ⏳
- **Expected File**: Lead card or error component
- **Component**: Retry enrichment button
- **Action**: Add to retry button element

### **`retry-search-button`** ⏳
- **Expected File**: Search error/timeout component
- **Component**: Retry search button
- **Action**: Add to retry button element

### **`buy-credits-from-error`** ⏳
- **Expected File**: Insufficient credits error component
- **Component**: Buy credits link/button in error message
- **Action**: Add to buy credits call-to-action

---

## ⚠️ Error Handling Attributes (2/5 partial)

### **`[role="alert"]`** ✅
- **File**: `apps/web/src/components/ui/alert.tsx`
- **Component**: Alert component (built-in)
- **Status**: Added `data-testid="alert"` to Alert component with role="alert"

### **`[data-testid="toast"]`** ✅
- **File**: `apps/web/src/components/ui/toaster.tsx`
- **Component**: Toast notifications
- **Status**: Added to Toast component element

### **`offline-indicator`** ⏳
- **Expected File**: Network status component
- **Component**: Offline status indicator
- **Action**: Add to offline indicator element (if implemented)

### **`online-indicator`** ⏳
- **Expected File**: Network status component
- **Component**: Online/reconnected indicator
- **Action**: Add to online indicator element (if implemented)

### **`rate-limit-countdown`** ⏳
- **Expected File**: Rate limit error component
- **Component**: Countdown timer for rate limit
- **Action**: Add to countdown timer element (if implemented)

---

## Implementation Priority

### **High Priority** (Required for critical E2E tests to run)
1. ✅ Authentication (4/4) - **COMPLETE**
2. ✅ Search Form (5/5) - **COMPLETE**
3. ⚠️ Pipeline Stages (4/10) - **PARTIAL** - Needed for Test 4
4. ✅ Results Display (7/7) - **COMPLETE**
5. ⚠️ Credit Management (3/8) - **PARTIAL** - Needed for Test 2, 3

### **Medium Priority** (Needed for comprehensive E2E coverage)
6. ✅ Search Status (3/3) - **COMPLETE**
7. ⚠️ Metrics (6/12) - **PARTIAL**

### **Lower Priority** (Nice to have, improves test reliability)
8. ⚠️ Error Handling (2/5) - **PARTIAL**

---

## Next Steps

1. ✅ Authentication attributes (4/4) - **COMPLETE**
2. ✅ Search form attributes (5/5) - **COMPLETE**
3. ⚠️ Pipeline monitoring attributes (4/10) - **PARTIAL** - Need enrichment progress indicators
4. ✅ Results display attributes (7/7) - **COMPLETE**
5. ⚠️ Credit management attributes (3/8) - **PARTIAL** - Need payment flow and transaction history
6. ⚠️ Error handling attributes (2/5) - **PARTIAL** - Need network status indicators
7. ⚠️ Metrics attributes (6/12) - **PARTIAL** - Need partial results, enrichment errors, retry buttons
8. **Run E2E tests to verify all implemented attributes work correctly**

---

## Notes

- All attributes should be added as `data-testid="attribute-name"`
- Some attributes require additional data attributes (e.g., `data-stage-name`, `data-search-id`)
- Ensure attributes are on stable, existing elements (not dynamically created/destroyed)
- Test attributes should not affect styling or functionality
- Use semantic HTML elements where possible (e.g., `role="alert"` for errors)

---

## Testing Commands

After adding attributes, verify with:
```bash
cd apps/web
pnpm test:e2e:ui
```

Check specific test file:
```bash
npx playwright test e2e/01-critical-flow.spec.ts --headed
```
