import { test, expect } from '@playwright/test';
import {
  AuthHelpers,
  SearchHelpers,
  CreditHelpers,
  TestAssertions,
  WaitHelpers,
  TEST_USER,
} from './utils/test-helpers';

/**
 * E2E Test 2: Credit Purchase Flow
 * Tests the complete credit purchase and usage flow
 *
 * Flow:
 * 1. User logs in with existing account
 * 2. User checks current credit balance
 * 3. User purchases additional credits via Stripe
 * 4. User creates search using purchased credits
 * 5. Credits are deducted correctly
 */
test.describe('Credit Purchase → Search Creation', () => {
  let auth: AuthHelpers;
  let search: SearchHelpers;
  let credits: CreditHelpers;
  let assertions: TestAssertions;
  let waits: WaitHelpers;

  test.beforeEach(async ({ page }) => {
    auth = new AuthHelpers(page);
    search = new SearchHelpers(page);
    credits = new CreditHelpers(page);
    assertions = new TestAssertions(page);
    waits = new WaitHelpers(page);
  });

  test('should complete full credit purchase and usage flow', async ({ page }) => {
    const uniqueEmail = `test-credit-${Date.now()}@genni-e2e.com`;

    /**
     * Step 1: User Registration
     */
    test.step('User signs up and gets starter credits', async () => {
      await auth.signUp(uniqueEmail, TEST_USER.password, TEST_USER.name);
      await expect(page).toHaveURL(/\/dashboard/);

      // Record initial balance
      const initialBalance = await credits.getCreditBalance();
      expect(initialBalance).toBeGreaterThan(0);
      console.log(`Initial starter credits: ${initialBalance}`);
    });

    /**
     * Step 2: Navigate to Billing
     */
    test.step('User navigates to billing page', async () => {
      await page.goto('/settings/billing');

      // Verify billing page loads
      await assertions.assertPageTitle('Billing');
      await assertions.assertVisible('[data-testid="credit-balance"]');
      await assertions.assertVisible('[data-testid="buy-credits-button"]');
    });

    /**
     * Step 3: View Credit Packages
     */
    test.step('User views available credit packages', async () => {
      // Click buy credits button
      await page.click('[data-testid="buy-credits-button"]');

      // Verify credit packages are displayed
      await assertions.assertVisible('[data-testid="credit-package"]');

      // Verify multiple package options exist
      const packages = await page.$$('[data-testid^="credit-amount-"]');
      expect(packages.length).toBeGreaterThan(0);

      // Verify package details (price, credits, savings)
      await assertions.assertVisible('[data-testid="package-price"]');
      await assertions.assertVisible('[data-testid="package-credits"]');
    });

    /**
     * Step 4: Purchase Credits
     */
    test.step('User purchases credits via Stripe', async () => {
      const balanceBeforePurchase = await credits.getCreditBalance();

      // Select credit package (e.g., 100 credits)
      await page.click('[data-testid="credit-amount-100"]');

      // Fill in Stripe test payment details
      const stripeFrame = page.frameLocator('iframe[name^="__privateStripeFrame"]');

      await stripeFrame.locator('[placeholder="Card number"]').fill('4242424242424242');
      await stripeFrame.locator('[placeholder="MM / YY"]').fill('12/34');
      await stripeFrame.locator('[placeholder="CVC"]').fill('123');
      await stripeFrame.locator('[placeholder="ZIP"]').fill('12345');

      // Submit payment
      await page.click('[data-testid="submit-payment-button"]');

      // Wait for payment processing
      await waits.waitForElement('[data-testid="payment-success"]', 30000);

      // Verify success message
      await assertions.assertToast('Credits purchased successfully');

      // Verify balance increased
      await waits.waitForNetworkIdle(3000);
      const balanceAfterPurchase = await credits.getCreditBalance();
      expect(balanceAfterPurchase).toBeGreaterThan(balanceBeforePurchase);
      expect(balanceAfterPurchase).toBe(balanceBeforePurchase + 100);

      console.log(`Balance after purchase: ${balanceAfterPurchase}`);
    });

    /**
     * Step 5: Create Search with Purchased Credits
     */
    test.step('User creates search using purchased credits', async () => {
      const balanceBeforeSearch = await credits.getCreditBalance();

      // Create search
      const searchId = await search.createSearch({
        businessType: 'pizza restaurant',
        location: 'Chicago, IL',
        radius: 10,
        maxResults: 20,
      });

      // Verify search created
      expect(searchId).toBeTruthy();
      await expect(page).toHaveURL(new RegExp(`/search/${searchId}`));

      // Wait for search to complete
      await search.waitForSearchCompletion(searchId, 120000);

      // Verify credits were deducted
      const balanceAfterSearch = await credits.getCreditBalance();
      expect(balanceAfterSearch).toBeLessThan(balanceBeforeSearch);

      // Verify credit transaction appears in history
      await page.goto('/settings/billing');
      await assertions.assertVisible('[data-testid="transaction-history"]');
      await assertions.assertVisible('[data-testid="transaction-item"]');
      await assertions.assertText('[data-testid="transaction-item"]', 'Search');

      console.log(`Credits deducted: ${balanceBeforeSearch - balanceAfterSearch}`);
    });

    /**
     * Step 6: Verify Transaction History
     */
    test.step('Transaction history shows purchase and usage', async () => {
      await page.goto('/settings/billing');

      // Verify transaction history section
      await assertions.assertVisible('[data-testid="transaction-history"]');

      // Verify purchase transaction
      const purchaseTransaction = page.locator(
        '[data-testid="transaction-item"][data-type="purchase"]'
      );
      await expect(purchaseTransaction).toBeVisible();
      await expect(purchaseTransaction).toContainText('+100');
      await expect(purchaseTransaction).toContainText('Credits');

      // Verify search usage transaction
      const usageTransaction = page.locator(
        '[data-testid="transaction-item"][data-type="usage"]'
      );
      await expect(usageTransaction).toBeVisible();
      await expect(usageTransaction).toContainText('Search');
    });
  });

  test('should handle failed payment gracefully', async ({ page }) => {
    const uniqueEmail = `test-failed-payment-${Date.now()}@genni-e2e.com`;

    // Sign up
    await auth.signUp(uniqueEmail, TEST_USER.password, TEST_USER.name);
    const initialBalance = await credits.getCreditBalance();

    // Navigate to billing
    await page.goto('/settings/billing');
    await page.click('[data-testid="buy-credits-button"]');

    // Select package
    await page.click('[data-testid="credit-amount-100"]');

    // Use declined test card
    const stripeFrame = page.frameLocator('iframe[name^="__privateStripeFrame"]');
    await stripeFrame.locator('[placeholder="Card number"]').fill('4000000000000002');
    await stripeFrame.locator('[placeholder="MM / YY"]').fill('12/34');
    await stripeFrame.locator('[placeholder="CVC"]').fill('123');
    await stripeFrame.locator('[placeholder="ZIP"]').fill('12345');

    // Submit payment
    await page.click('[data-testid="submit-payment-button"]');

    // Verify error message appears
    await assertions.assertError('Your card was declined');

    // Verify balance unchanged
    const balanceAfterFailure = await credits.getCreditBalance();
    expect(balanceAfterFailure).toBe(initialBalance);

    // Verify user can retry
    await assertions.assertVisible('[data-testid="submit-payment-button"]');
  });

  test('should display correct pricing for different packages', async ({ page }) => {
    const uniqueEmail = `test-pricing-${Date.now()}@genni-e2e.com`;

    await auth.signUp(uniqueEmail, TEST_USER.password, TEST_USER.name);
    await page.goto('/settings/billing');
    await page.click('[data-testid="buy-credits-button"]');

    // Verify starter package
    const starter = page.locator('[data-testid="credit-amount-50"]');
    await expect(starter).toBeVisible();
    await expect(starter).toContainText('50 credits');

    // Verify pro package
    const pro = page.locator('[data-testid="credit-amount-100"]');
    await expect(pro).toBeVisible();
    await expect(pro).toContainText('100 credits');

    // Verify enterprise package
    const enterprise = page.locator('[data-testid="credit-amount-500"]');
    await expect(enterprise).toBeVisible();
    await expect(enterprise).toContainText('500 credits');

    // Verify savings badge on larger packages
    await expect(enterprise).toContainText('Save');
  });

  test('should prevent search creation without sufficient credits', async ({ page }) => {
    const uniqueEmail = `test-no-credits-${Date.now()}@genni-e2e.com`;

    // Sign up
    await auth.signUp(uniqueEmail, TEST_USER.password, TEST_USER.name);

    // Attempt to create large search that exceeds balance
    await page.goto('/search');
    await page.fill('[data-testid="business-type-input"]', 'hotel');
    await page.fill('[data-testid="location-input"]', 'Las Vegas, NV');
    await page.fill('[data-testid="max-results-input"]', '1000'); // Excessive

    // Click create search
    await page.click('[data-testid="create-search-button"]');

    // Verify insufficient credits error
    await assertions.assertError('Insufficient credits');

    // Verify redirect to billing or show purchase modal
    await expect(page.locator('[data-testid="buy-credits-modal"]')).toBeVisible();

    // Verify search was not created
    await expect(page).not.toHaveURL(/\/search\/[^/]+$/);
  });

  test('should handle subscription plans and credit allocations', async ({ page }) => {
    const uniqueEmail = `test-subscription-${Date.now()}@genni-e2e.com`;

    await auth.signUp(uniqueEmail, TEST_USER.password, TEST_USER.name);
    await page.goto('/settings/billing');

    // Verify subscription section exists
    await assertions.assertVisible('[data-testid="subscription-plans"]');

    // Verify free tier information
    await assertions.assertVisible('[data-testid="current-plan"]');
    await assertions.assertText('[data-testid="current-plan"]', 'Free');

    // Verify upgrade options
    await assertions.assertVisible('[data-testid="upgrade-button"]');

    // Click upgrade
    await page.click('[data-testid="upgrade-button"]');

    // Verify plan comparison
    await assertions.assertVisible('[data-testid="plan-comparison"]');
    await assertions.assertVisible('[data-testid="plan-pro"]');
    await assertions.assertVisible('[data-testid="plan-enterprise"]');

    // Verify monthly credit allocations displayed
    await expect(page.locator('[data-testid="plan-pro"]')).toContainText('credits/month');
  });
});
