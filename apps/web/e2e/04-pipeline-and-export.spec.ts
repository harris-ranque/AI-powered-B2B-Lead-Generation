import { test, expect } from '@playwright/test';
import {
  AuthHelpers,
  SearchHelpers,
  CreditHelpers,
  TestAssertions,
  WaitHelpers,
  TEST_USER,
} from './utils/test-helpers';
import * as fs from 'fs';
import * as path from 'path';

/**
 * E2E Test 4 & 5: Pipeline Status Display & CSV Export Validation
 * Tests real-time pipeline status updates and data export accuracy
 *
 * Test 4: Pipeline Status Display Accuracy
 * - Real-time status updates throughout pipeline
 * - Stage progression visualization
 * - Progress indicators and metrics
 * - Error state display
 *
 * Test 5: CSV Export Data Validation
 * - Export contains all expected fields
 * - Data accuracy and completeness
 * - Format validation
 * - Download functionality
 */
test.describe('Pipeline Status & CSV Export', () => {
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
   * Test 4: Pipeline Status Display Accuracy
   */
  test.describe('Pipeline Status Display', () => {
    test('should show accurate real-time pipeline status', async ({ page }) => {
      const uniqueEmail = `test-pipeline-${Date.now()}@genni-e2e.com`;

      await auth.signUp(uniqueEmail, TEST_USER.password, TEST_USER.name);

      test.step('Create search and monitor pipeline', async () => {
        const searchId = await search.createSearch({
          businessType: 'bookstore',
          location: 'Portland, OR',
          radius: 8,
          maxResults: 15,
        });

        // Verify initial status
        await assertions.assertText('[data-testid="search-status"]', 'processing');
      });

      test.step('Monitor Discovery Stage', async () => {
        // Wait for discovery stage to appear
        await waits.waitForElement(
          '[data-testid="pipeline-stage"][data-stage-name="discovery"]'
        );

        const discoveryStage = page.locator(
          '[data-testid="pipeline-stage"][data-stage-name="discovery"]'
        );

        // Verify stage is in progress
        await expect(discoveryStage).toHaveAttribute('data-stage-status', 'in_progress');

        // Verify stage details
        await expect(discoveryStage).toBeVisible();
        await expect(discoveryStage).toContainText('Discovering businesses');

        // Verify progress indicator
        await assertions.assertVisible('[data-testid="discovery-progress"]');

        // Wait for stage completion
        await page.waitForSelector(
          '[data-testid="pipeline-stage"][data-stage-name="discovery"][data-stage-status="completed"]',
          { timeout: 60000 }
        );

        // Verify discovered leads count
        await assertions.assertVisible('[data-testid="leads-discovered-count"]');
        const discoveredCount = await page.textContent('[data-testid="leads-discovered-count"]');
        expect(parseInt(discoveredCount || '0')).toBeGreaterThan(0);

        console.log(`Leads discovered: ${discoveredCount}`);
      });

      test.step('Monitor Enrichment Stage', async () => {
        // Wait for enrichment stage to start
        await waits.waitForElement(
          '[data-testid="pipeline-stage"][data-stage-name="enrichment"][data-stage-status="in_progress"]'
        );

        const enrichmentStage = page.locator(
          '[data-testid="pipeline-stage"][data-stage-name="enrichment"]'
        );

        // Verify stage details
        await expect(enrichmentStage).toContainText('Enriching contact information');

        // Verify batch processing indicator
        await assertions.assertVisible('[data-testid="enrichment-batch-progress"]');

        // Verify current/total leads being processed
        await assertions.assertVisible('[data-testid="enrichment-leads-status"]');
        const statusText = await page.textContent('[data-testid="enrichment-leads-status"]');
        expect(statusText).toMatch(/\d+\s*\/\s*\d+/); // Format: "5 / 15"

        // Verify enrichment rate limit indicator
        await assertions.assertVisible('[data-testid="enrichment-rate-info"]');

        // Wait for completion
        await page.waitForSelector(
          '[data-testid="pipeline-stage"][data-stage-name="enrichment"][data-stage-status="completed"]',
          { timeout: 120000 }
        );

        // Verify enrichment metrics
        await assertions.assertVisible('[data-testid="leads-enriched-count"]');
        const enrichedCount = await page.textContent('[data-testid="leads-enriched-count"]');
        console.log(`Leads enriched: ${enrichedCount}`);
      });

      test.step('Monitor AI Analysis Stage', async () => {
        // Wait for analysis stage
        await waits.waitForElement(
          '[data-testid="pipeline-stage"][data-stage-name="analysis"][data-stage-status="in_progress"]'
        );

        const analysisStage = page.locator(
          '[data-testid="pipeline-stage"][data-stage-name="analysis"]'
        );

        // Verify stage details
        await expect(analysisStage).toContainText('Analyzing relevance');

        // Verify AI analysis progress
        await assertions.assertVisible('[data-testid="analysis-progress"]');

        // Wait for completion
        await page.waitForSelector(
          '[data-testid="pipeline-stage"][data-stage-name="analysis"][data-stage-status="completed"]',
          { timeout: 120000 }
        );

        // Verify analysis metrics
        await assertions.assertVisible('[data-testid="leads-analyzed-count"]');
        await assertions.assertVisible('[data-testid="avg-relevance-score"]');

        const avgScore = await page.textContent('[data-testid="avg-relevance-score"]');
        console.log(`Average relevance score: ${avgScore}`);
      });

      test.step('Verify final status and metrics', async () => {
        // Verify search completed
        await assertions.assertText('[data-testid="search-status"]', 'completed');

        // Verify all stages completed
        const stages = await page.$$('[data-testid="pipeline-stage"]');
        for (const stage of stages) {
          const status = await stage.getAttribute('data-stage-status');
          expect(status).toBe('completed');
        }

        // Verify completion timestamp
        await assertions.assertVisible('[data-testid="completed-at"]');

        // Verify overall metrics
        await assertions.assertVisible('[data-testid="total-leads"]');
        await assertions.assertVisible('[data-testid="total-duration"]');

        const totalLeads = await page.textContent('[data-testid="total-leads"]');
        const duration = await page.textContent('[data-testid="total-duration"]');
        console.log(`Total leads: ${totalLeads}, Duration: ${duration}`);
      });
    });

    test('should display pipeline errors correctly', async ({ page }) => {
      const uniqueEmail = `test-pipeline-error-${Date.now()}@genni-e2e.com`;

      await auth.signUp(uniqueEmail, TEST_USER.password, TEST_USER.name);

      // Create search that might fail
      const searchId = await search.createSearch({
        businessType: 'invalid-business-type-xyz',
        location: 'Nowhere, XX',
        radius: 5,
        maxResults: 10,
      });

      // Wait for potential failure
      await page.waitForSelector('[data-testid="pipeline-stage"][data-stage-status="failed"]', {
        timeout: 60000,
      });

      // Verify error is displayed
      await assertions.assertVisible('[data-testid="pipeline-error"]');
      await assertions.assertText('[data-testid="search-status"]', 'failed');

      // Verify error message is helpful
      const errorMessage = await page.textContent('[data-testid="pipeline-error"]');
      expect(errorMessage).toBeTruthy();
      expect(errorMessage?.length).toBeGreaterThan(10);

      // Verify retry option
      await assertions.assertVisible('[data-testid="retry-search-button"]');
    });
  });

  /**
   * Test 5: CSV Export Data Validation
   */
  test.describe('CSV Export Validation', () => {
    test('should export complete and accurate CSV data', async ({ page }) => {
      const uniqueEmail = `test-export-${Date.now()}@genni-e2e.com`;

      let downloadPath: string;
      let searchId: string;

      await auth.signUp(uniqueEmail, TEST_USER.password, TEST_USER.name);

      test.step('Create and complete search', async () => {
        searchId = await search.createSearch({
          businessType: 'bakery',
          location: 'Austin, TX',
          radius: 5,
          maxResults: 10,
        });

        await search.waitForSearchCompletion(searchId, 120000);
      });

      test.step('Export search results to CSV', async () => {
        const download = await search.exportToCSV(searchId);

        // Verify download started
        expect(download).toBeTruthy();

        // Verify filename format
        const filename = download.suggestedFilename();
        expect(filename).toMatch(/^search-.*\.csv$/);
        expect(filename).toContain(searchId);

        // Save download
        downloadPath = await download.path();
        expect(downloadPath).toBeTruthy();

        console.log(`CSV downloaded to: ${downloadPath}`);
      });

      test.step('Validate CSV structure and content', async () => {
        // Read CSV file
        const csvContent = fs.readFileSync(downloadPath!, 'utf-8');
        const lines = csvContent.split('\n').filter((line) => line.trim());

        // Verify CSV has content
        expect(lines.length).toBeGreaterThan(1); // Header + data rows

        // Parse header
        const header = lines[0].split(',');

        // Verify required columns exist
        const requiredColumns = [
          'Business Name',
          'Address',
          'Phone',
          'Website',
          'Email',
          'Contact Name',
          'Relevance Score',
          'Rating',
          'Total Reviews',
          'Google Maps URL',
        ];

        for (const column of requiredColumns) {
          expect(header).toContain(column);
        }

        console.log(`CSV has ${lines.length - 1} data rows`);
        console.log(`Columns: ${header.join(', ')}`);

        // Verify data rows
        const dataRows = lines.slice(1);
        expect(dataRows.length).toBeGreaterThan(0);

        // Parse first data row for validation
        const firstRow = dataRows[0].split(',');

        // Verify data completeness
        const businessNameIndex = header.indexOf('Business Name');
        expect(firstRow[businessNameIndex]).toBeTruthy();
        expect(firstRow[businessNameIndex].length).toBeGreaterThan(0);

        // Verify email if present
        const emailIndex = header.indexOf('Email');
        if (firstRow[emailIndex]) {
          expect(firstRow[emailIndex]).toMatch(/@/); // Contains @ symbol
        }

        // Verify relevance score format
        const scoreIndex = header.indexOf('Relevance Score');
        if (firstRow[scoreIndex]) {
          const score = parseFloat(firstRow[scoreIndex]);
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(1);
        }

        // Verify rating format
        const ratingIndex = header.indexOf('Rating');
        if (firstRow[ratingIndex]) {
          const rating = parseFloat(firstRow[ratingIndex]);
          expect(rating).toBeGreaterThanOrEqual(0);
          expect(rating).toBeLessThanOrEqual(5);
        }
      });

      test.step('Verify CSV matches displayed results', async () => {
        await page.goto(`/search/${searchId}`);

        // Get displayed leads count
        const displayedCount = await search.getResultsCount();

        // Read CSV again
        const csvContent = fs.readFileSync(downloadPath!, 'utf-8');
        const csvRows = csvContent.split('\n').filter((line) => line.trim()).length - 1; // Exclude header

        // Verify counts match
        expect(csvRows).toBe(displayedCount);

        console.log(`Displayed: ${displayedCount}, CSV rows: ${csvRows} - Match!`);
      });

      test.step('Verify special characters are properly escaped', async () => {
        const csvContent = fs.readFileSync(downloadPath!, 'utf-8');

        // Check for proper CSV escaping
        // Commas in data should be quoted
        // Quotes should be doubled
        // No broken rows

        const lines = csvContent.split('\n').filter((line) => line.trim());
        const header = lines[0].split(',');

        for (let i = 1; i < lines.length; i++) {
          const row = lines[i];

          // Count commas (should match header count if properly escaped)
          const commaCount = (row.match(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g) || []).length;

          // Allow some flexibility for optional fields
          expect(commaCount).toBeGreaterThanOrEqual(header.length - 5);
          expect(commaCount).toBeLessThanOrEqual(header.length);
        }
      });
    });

    test('should handle empty results export', async ({ page }) => {
      const uniqueEmail = `test-empty-export-${Date.now()}@genni-e2e.com`;

      await auth.signUp(uniqueEmail, TEST_USER.password, TEST_USER.name);

      // Create search that returns no results
      const searchId = await search.createSearch({
        businessType: 'extremely-rare-business-xyz',
        location: 'Middle of Nowhere, AK',
        radius: 1,
        maxResults: 5,
      });

      await search.waitForSearchCompletion(searchId, 120000);

      // Attempt export
      const resultsCount = await search.getResultsCount();

      if (resultsCount === 0) {
        // Verify export button shows appropriate message
        const exportButton = page.locator('[data-testid="export-csv-button"]');
        await expect(exportButton).toBeDisabled();

        // Verify empty results message
        await assertions.assertVisible('[data-testid="no-results-message"]');
      }
    });

    test('should allow re-export with same data', async ({ page }) => {
      const uniqueEmail = `test-reexport-${Date.now()}@genni-e2e.com`;

      await auth.signUp(uniqueEmail, TEST_USER.password, TEST_USER.name);

      const searchId = await search.createSearch({
        businessType: 'pharmacy',
        location: 'Miami, FL',
        radius: 10,
        maxResults: 8,
      });

      await search.waitForSearchCompletion(searchId, 120000);

      // Export twice
      const download1 = await search.exportToCSV(searchId);
      const path1 = await download1.path();
      const content1 = fs.readFileSync(path1!, 'utf-8');

      // Wait a bit
      await page.waitForTimeout(2000);

      // Export again
      const download2 = await search.exportToCSV(searchId);
      const path2 = await download2.path();
      const content2 = fs.readFileSync(path2!, 'utf-8');

      // Verify both exports have identical data
      expect(content1).toBe(content2);

      console.log('Re-export verification: Data is identical ✓');
    });
  });
});
