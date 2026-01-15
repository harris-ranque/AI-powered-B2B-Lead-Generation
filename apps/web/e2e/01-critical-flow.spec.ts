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
 * E2E Test 1: Critical Happy Path Flow
 * Tests the complete user journey from signup to export
 *
 * Flow:
 * 1. User signs up for new account
 * 2. User creates a new search
 * 3. Pipeline processes search (Google Maps → Enrichment → AI Analysis)
 * 4. User views results
 * 5. User exports results to CSV
 */
test.describe('Critical User Flow: Signup → Search → Export', () => {
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

  test('should complete full user journey from signup to export', async ({ page }) => {
    // Generate unique test user email to avoid conflicts
    const uniqueEmail = `test-${Date.now()}@genni-e2e.com`;

    /**
     * Step 1: User Registration
     */
    test.step('User signs up for new account', async () => {
      await auth.signUp(uniqueEmail, TEST_USER.password, TEST_USER.name);

      // Verify user is on dashboard
      await expect(page).toHaveURL(/\/dashboard/);
      await assertions.assertPageTitle('Dashboard');

      // Verify welcome message or user profile
      await assertions.assertVisible('[data-testid="user-profile"]');
    });

    /**
     * Step 2: Check Initial Credit Balance
     */
    test.step('User receives starter credits', async () => {
      const initialBalance = await credits.getCreditBalance();

      // New users should receive starter credits (adjust based on your app)
      expect(initialBalance).toBeGreaterThan(0);
      console.log(`Initial credit balance: ${initialBalance}`);
    });

    /**
     * Step 3: Create New Search
     */
    test.step('User creates new search', async () => {
      const searchId = await search.createSearch({
        businessType: 'coffee shop',
        location: 'San Francisco, CA',
        radius: 5,
        maxResults: 10,
      });

      // Verify search was created
      expect(searchId).toBeTruthy();
      await expect(page).toHaveURL(new RegExp(`/search/${searchId}`));

      // Verify search status is displayed
      await assertions.assertVisible('[data-testid="search-status"]');
    });

    /**
     * Step 4: Monitor Pipeline Progress
     */
    test.step('Pipeline processes search', async () => {
      // Wait for pipeline to start
      await waits.waitForElement('[data-testid="pipeline-stage"][data-stage-name="discovery"]');

      // Verify all pipeline stages are displayed
      const stages = await search.getPipelineStages();
      expect(stages.length).toBeGreaterThanOrEqual(3); // discovery, enrichment, analysis

      // Verify stages show correct initial status
      const discoveryStage = stages.find((s) => s.name === 'discovery');
      expect(discoveryStage?.status).toMatch(/in_progress|completed/);
    });

    /**
     * Step 5: Wait for Search Completion
     */
    test.step('Search completes successfully', async () => {
      // Get current search ID from URL
      const url = page.url();
      const searchId = url.split('/').pop()!;

      // Wait for search to complete (max 2 minutes)
      await search.waitForSearchCompletion(searchId, 120000);

      // Verify completion status
      await assertions.assertText('[data-testid="search-status"]', 'completed');

      // Verify results are displayed
      const resultsCount = await search.getResultsCount();
      expect(resultsCount).toBeGreaterThan(0);
      expect(resultsCount).toBeLessThanOrEqual(10); // Max results limit

      console.log(`Search completed with ${resultsCount} results`);
    });

    /**
     * Step 6: View Search Results
     */
    test.step('User views search results', async () => {
      // Verify lead cards are displayed
      await assertions.assertVisible('[data-testid="lead-card"]');

      // Verify lead details are shown
      await assertions.assertVisible('[data-testid="lead-business-name"]');
      await assertions.assertVisible('[data-testid="lead-contact-info"]');

      // Verify enrichment data is displayed
      await assertions.assertVisible('[data-testid="lead-email"]');

      // Verify AI analysis is shown
      await assertions.assertVisible('[data-testid="lead-relevance-score"]');
    });

    /**
     * Step 7: Export Results to CSV
     */
    test.step('User exports results to CSV', async () => {
      const url = page.url();
      const searchId = url.split('/').pop()!;

      // Export to CSV
      const download = await search.exportToCSV(searchId);

      // Verify download started
      expect(download).toBeTruthy();

      // Verify filename
      const filename = download.suggestedFilename();
      expect(filename).toMatch(/\.csv$/);
      expect(filename).toContain(searchId);

      // Save download to verify content
      const path = await download.path();
      expect(path).toBeTruthy();

      console.log(`CSV exported successfully: ${filename}`);
    });

    /**
     * Step 8: Verify Credit Deduction
     */
    test.step('Credits are deducted correctly', async () => {
      const finalBalance = await credits.getCreditBalance();

      // Credits should have been deducted for the search
      // Exact amount depends on your pricing model
      expect(finalBalance).toBeLessThan(await credits.getCreditBalance());

      console.log(`Final credit balance: ${finalBalance}`);
    });

    /**
     * Step 9: Verify Search History
     */
    test.step('Search appears in history', async () => {
      await page.goto('/dashboard');

      // Verify search history section exists
      await assertions.assertVisible('[data-testid="search-history"]');

      // Verify recent search is listed
      await assertions.assertVisible('[data-testid="search-history-item"]');
      await assertions.assertText('[data-testid="search-history-item"]', 'coffee shop');
      await assertions.assertText('[data-testid="search-history-item"]', 'San Francisco');
    });
  });

  test('should handle navigation back to search from dashboard', async ({ page }) => {
    const uniqueEmail = `test-nav-${Date.now()}@genni-e2e.com`;

    // Sign up
    await auth.signUp(uniqueEmail, TEST_USER.password, TEST_USER.name);

    // Create search
    const searchId = await search.createSearch({
      businessType: 'restaurant',
      location: 'New York, NY',
      radius: 3,
      maxResults: 5,
    });

    // Wait for some progress
    await waits.waitForElement('[data-testid="pipeline-stage"]');

    // Navigate away to dashboard
    await page.goto('/dashboard');
    await assertions.assertVisible('[data-testid="search-history"]');

    // Navigate back to search
    await page.click(`[data-testid="search-history-item"][data-search-id="${searchId}"]`);

    // Verify we're back on search page
    await expect(page).toHaveURL(new RegExp(`/search/${searchId}`));
    await assertions.assertVisible('[data-testid="search-status"]');

    // Verify pipeline state is preserved
    await assertions.assertVisible('[data-testid="pipeline-stage"]');
  });

  test('should handle browser refresh during search', async ({ page }) => {
    const uniqueEmail = `test-refresh-${Date.now()}@genni-e2e.com`;

    // Sign up and create search
    await auth.signUp(uniqueEmail, TEST_USER.password, TEST_USER.name);
    const searchId = await search.createSearch({
      businessType: 'gym',
      location: 'Los Angeles, CA',
      radius: 5,
      maxResults: 5,
    });

    // Wait for pipeline to start
    await waits.waitForElement('[data-testid="pipeline-stage"]');

    // Refresh page
    await page.reload();

    // Verify search state is restored
    await expect(page).toHaveURL(new RegExp(`/search/${searchId}`));
    await assertions.assertVisible('[data-testid="search-status"]');
    await assertions.assertVisible('[data-testid="pipeline-stage"]');

    // Verify real-time updates continue after refresh
    await waits.waitForAPIResponse(/\/api\/.*/, 10000);
  });
});
