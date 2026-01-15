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
 * E2E Test 3: Error Handling & Edge Cases
 * Tests system behavior under error conditions
 *
 * Scenarios:
 * 1. Insufficient credits → proper error message → redirect to billing
 * 2. Network interruption → graceful recovery → resume pipeline
 * 3. Invalid search parameters → validation errors
 * 4. Search timeout → proper error handling
 * 5. Enrichment failures → partial results handling
 */
test.describe('Error Handling & Edge Cases', () => {
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

  /**
   * Test 1: Insufficient Credits Error Flow
   */
  test('should handle insufficient credits gracefully', async ({ page }) => {
    const uniqueEmail = `test-no-credits-${Date.now()}@genni-e2e.com`;

    test.step('User signs up with limited credits', async () => {
      await auth.signUp(uniqueEmail, TEST_USER.password, TEST_USER.name);
      await expect(page).toHaveURL(/\/dashboard/);

      // Get initial balance
      const initialBalance = await credits.getCreditBalance();
      console.log(`Initial balance: ${initialBalance}`);
    });

    test.step('User attempts search exceeding credit balance', async () => {
      await page.goto('/search');

      // Fill in search form with excessive parameters
      await page.fill('[data-testid="business-type-input"]', 'restaurant');
      await page.fill('[data-testid="location-input"]', 'New York, NY');
      await page.fill('[data-testid="radius-input"]', '50'); // Large radius
      await page.fill('[data-testid="max-results-input"]', '500'); // Many results

      // Verify estimated cost warning appears
      await assertions.assertVisible('[data-testid="estimated-cost"]');
      const estimatedCost = await page.textContent('[data-testid="estimated-cost"]');
      expect(estimatedCost).toMatch(/\d+/);

      // Attempt to create search
      await page.click('[data-testid="create-search-button"]');

      // Verify insufficient credits error
      await assertions.assertError('Insufficient credits');

      // Verify helpful error message with exact deficit
      const errorMessage = await page.textContent('[role="alert"]');
      expect(errorMessage).toContain('credits needed');
      expect(errorMessage).toContain('purchase');
    });

    test.step('User is redirected to billing with context', async () => {
      // Click "Buy Credits" button in error message
      await page.click('[data-testid="buy-credits-from-error"]');

      // Verify redirect to billing
      await expect(page).toHaveURL(/\/settings\/billing/);

      // Verify purchase modal opens with context
      await assertions.assertVisible('[data-testid="buy-credits-modal"]');

      // Verify recommended package is highlighted
      await assertions.assertVisible('[data-testid="recommended-package"]');
    });

    test.step('User can return to search after error', async () => {
      // Navigate back to search page
      await page.goBack();

      // Verify search form is preserved
      const businessType = await page.inputValue('[data-testid="business-type-input"]');
      expect(businessType).toBe('restaurant');

      // Verify user can adjust parameters
      await page.fill('[data-testid="max-results-input"]', '10'); // Reduce

      // Verify new estimate is within budget
      const newEstimate = await page.textContent('[data-testid="estimated-cost"]');
      const balance = await credits.getCreditBalance();
      const estimate = parseInt(newEstimate?.match(/\d+/)?.[0] || '0');
      expect(estimate).toBeLessThanOrEqual(balance);
    });
  });

  /**
   * Test 2: Network Interruption Recovery
   */
  test('should recover gracefully from network interruption', async ({ page, context }) => {
    const uniqueEmail = `test-network-${Date.now()}@genni-e2e.com`;

    await auth.signUp(uniqueEmail, TEST_USER.password, TEST_USER.name);

    // Create search
    const searchId = await search.createSearch({
      businessType: 'cafe',
      location: 'Seattle, WA',
      radius: 5,
      maxResults: 10,
    });

    // Wait for pipeline to start
    await waits.waitForElement('[data-testid="pipeline-stage"]');

    test.step('Simulate network interruption', async () => {
      // Go offline
      await context.setOffline(true);

      // Wait a bit
      await page.waitForTimeout(2000);

      // Verify offline indicator appears
      await assertions.assertVisible('[data-testid="offline-indicator"]');

      // Go back online
      await context.setOffline(false);

      // Verify reconnection
      await assertions.assertVisible('[data-testid="online-indicator"]');
    });

    test.step('Pipeline resumes after reconnection', async () => {
      // Verify status updates resume
      await waits.waitForAPIResponse(/\/api\/.*/, 10000);

      // Verify pipeline continues
      await assertions.assertVisible('[data-testid="pipeline-stage"]');

      // Verify search eventually completes
      await search.waitForSearchCompletion(searchId, 120000);
      await assertions.assertText('[data-testid="search-status"]', 'completed');
    });
  });

  /**
   * Test 3: Invalid Search Parameters
   */
  test('should validate search parameters', async ({ page }) => {
    const uniqueEmail = `test-validation-${Date.now()}@genni-e2e.com`;

    await auth.signUp(uniqueEmail, TEST_USER.password, TEST_USER.name);
    await page.goto('/search');

    test.step('Empty business type shows validation error', async () => {
      await page.fill('[data-testid="location-input"]', 'Boston, MA');
      await page.click('[data-testid="create-search-button"]');

      await assertions.assertError('Business type is required');
      await expect(page).not.toHaveURL(/\/search\/[^/]+$/);
    });

    test.step('Empty location shows validation error', async () => {
      await page.fill('[data-testid="business-type-input"]', 'hotel');
      await page.fill('[data-testid="location-input"]', '');
      await page.click('[data-testid="create-search-button"]');

      await assertions.assertError('Location is required');
    });

    test.step('Invalid radius shows validation error', async () => {
      await page.fill('[data-testid="business-type-input"]', 'hotel');
      await page.fill('[data-testid="location-input"]', 'Boston, MA');
      await page.fill('[data-testid="radius-input"]', '0');
      await page.click('[data-testid="create-search-button"]');

      await assertions.assertError('Radius must be at least 1');
    });

    test.step('Invalid max results shows validation error', async () => {
      await page.fill('[data-testid="business-type-input"]', 'hotel');
      await page.fill('[data-testid="location-input"]', 'Boston, MA');
      await page.fill('[data-testid="radius-input"]', '5');
      await page.fill('[data-testid="max-results-input"]', '-1');
      await page.click('[data-testid="create-search-button"]');

      await assertions.assertError('Max results must be positive');
    });

    test.step('Excessive max results shows warning', async () => {
      await page.fill('[data-testid="max-results-input"]', '10000');

      // Verify warning appears
      await assertions.assertVisible('[data-testid="max-results-warning"]');
      await assertions.assertText(
        '[data-testid="max-results-warning"]',
        'Large searches may take longer'
      );
    });
  });

  /**
   * Test 4: Search Timeout Handling
   */
  test('should handle search timeout gracefully', async ({ page }) => {
    const uniqueEmail = `test-timeout-${Date.now()}@genni-e2e.com`;

    await auth.signUp(uniqueEmail, TEST_USER.password, TEST_USER.name);

    // Create search
    const searchId = await search.createSearch({
      businessType: 'business',
      location: 'Remote Area, AK', // Area with potential timeout
      radius: 50,
      maxResults: 100,
    });

    // Mock timeout by waiting for timeout status
    await page.waitForSelector('[data-testid="search-status"][data-status="timeout"]', {
      timeout: 180000, // 3 minutes max
    });

    test.step('Timeout error is displayed', async () => {
      await assertions.assertError('Search timed out');
      await assertions.assertText('[data-testid="search-status"]', 'timeout');
    });

    test.step('User can retry search', async () => {
      // Verify retry button appears
      await assertions.assertVisible('[data-testid="retry-search-button"]');

      // Click retry
      await page.click('[data-testid="retry-search-button"]');

      // Verify new search is created
      await expect(page).toHaveURL(/\/search\/[^/]+$/);
      const newUrl = page.url();
      const newSearchId = newUrl.split('/').pop();
      expect(newSearchId).not.toBe(searchId);
    });

    test.step('Credits are refunded for timeout', async () => {
      // Navigate to billing
      await page.goto('/settings/billing');

      // Verify refund transaction exists
      const refundTransaction = page.locator(
        '[data-testid="transaction-item"][data-type="refund"]'
      );
      await expect(refundTransaction).toBeVisible();
      await expect(refundTransaction).toContainText('Timeout refund');
    });
  });

  /**
   * Test 5: Partial Results Handling
   */
  test('should handle partial enrichment failures', async ({ page }) => {
    const uniqueEmail = `test-partial-${Date.now()}@genni-e2e.com`;

    await auth.signUp(uniqueEmail, TEST_USER.password, TEST_USER.name);

    // Create search
    const searchId = await search.createSearch({
      businessType: 'store',
      location: 'Denver, CO',
      radius: 10,
      maxResults: 20,
    });

    // Wait for completion
    await search.waitForSearchCompletion(searchId, 120000);

    test.step('Partial results are displayed with warnings', async () => {
      // Check if partial results warning exists
      const partialWarning = page.locator('[data-testid="partial-results-warning"]');

      if (await partialWarning.isVisible()) {
        // Verify warning message
        await expect(partialWarning).toContainText('Some leads could not be enriched');

        // Verify leads with missing data are marked
        await assertions.assertVisible('[data-testid="lead-enrichment-failed"]');

        // Verify user can still export partial results
        await assertions.assertVisible('[data-testid="export-csv-button"]');
      }
    });

    test.step('Failed leads show appropriate indicators', async () => {
      const failedLeads = page.locator('[data-testid="lead-enrichment-failed"]');
      const failedCount = await failedLeads.count();

      if (failedCount > 0) {
        // Click first failed lead
        await failedLeads.first().click();

        // Verify error explanation
        await assertions.assertVisible('[data-testid="enrichment-error-details"]');
        await assertions.assertText(
          '[data-testid="enrichment-error-details"]',
          'Unable to find contact information'
        );

        // Verify retry option
        await assertions.assertVisible('[data-testid="retry-enrichment-button"]');
      }
    });
  });

  /**
   * Test 6: Rate Limit Handling
   */
  test('should handle rate limit gracefully', async ({ page }) => {
    const uniqueEmail = `test-rate-limit-${Date.now()}@genni-e2e.com`;

    await auth.signUp(uniqueEmail, TEST_USER.password, TEST_USER.name);

    // Attempt to create multiple searches rapidly
    const searchPromises = [];
    for (let i = 0; i < 10; i++) {
      searchPromises.push(
        page.goto('/search').then(async () => {
          await page.fill('[data-testid="business-type-input"]', `business-${i}`);
          await page.fill('[data-testid="location-input"]', 'Test City');
          await page.click('[data-testid="create-search-button"]');
        })
      );
    }

    await Promise.all(searchPromises);

    // Verify rate limit error eventually appears
    const rateLimitError = page.locator('[role="alert"]:has-text("rate limit")');
    if (await rateLimitError.isVisible()) {
      await expect(rateLimitError).toContainText('Please wait before creating another search');

      // Verify countdown timer
      await assertions.assertVisible('[data-testid="rate-limit-countdown"]');
    }
  });
});
