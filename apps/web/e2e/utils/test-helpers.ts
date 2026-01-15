import { Page, expect } from '@playwright/test';

/**
 * Test user credentials for E2E testing
 * Note: These should be test accounts created in your test environment
 */
export const TEST_USER = {
  email: 'test@genni-e2e.com',
  password: 'TestPassword123!',
  name: 'Test User',
};

export const TEST_ADMIN = {
  email: 'admin@genni-e2e.com',
  password: 'AdminPassword123!',
  name: 'Admin User',
};

/**
 * Authentication helpers
 */
export class AuthHelpers {
  constructor(private page: Page) {}

  /**
   * Sign up a new user using Clerk
   */
  async signUp(email: string, password: string, name: string) {
    await this.page.goto('/');

    // Wait for Clerk sign-up button
    await this.page.waitForSelector('[data-testid="sign-up-button"]', { timeout: 10000 });
    await this.page.click('[data-testid="sign-up-button"]');

    // Fill in sign-up form
    await this.page.fill('input[name="emailAddress"]', email);
    await this.page.fill('input[name="password"]', password);
    await this.page.fill('input[name="firstName"]', name.split(' ')[0]);
    await this.page.fill('input[name="lastName"]', name.split(' ')[1] || '');

    // Submit form
    await this.page.click('button[type="submit"]');

    // Wait for redirect to dashboard
    await this.page.waitForURL('**/dashboard', { timeout: 30000 });
  }

  /**
   * Log in an existing user using Clerk
   */
  async login(email: string, password: string) {
    await this.page.goto('/');

    // Wait for Clerk sign-in button
    await this.page.waitForSelector('[data-testid="sign-in-button"]', { timeout: 10000 });
    await this.page.click('[data-testid="sign-in-button"]');

    // Fill in login form
    await this.page.fill('input[name="identifier"]', email);
    await this.page.click('button:has-text("Continue")');

    await this.page.fill('input[name="password"]', password);
    await this.page.click('button[type="submit"]');

    // Wait for redirect to dashboard
    await this.page.waitForURL('**/dashboard', { timeout: 30000 });
  }

  /**
   * Log out current user
   */
  async logout() {
    await this.page.click('[data-testid="user-menu"]');
    await this.page.click('[data-testid="sign-out-button"]');
    await this.page.waitForURL('**/', { timeout: 10000 });
  }
}

/**
 * Search workflow helpers
 */
export class SearchHelpers {
  constructor(private page: Page) {}

  /**
   * Create a new search with given parameters
   */
  async createSearch(params: {
    businessType: string;
    location: string;
    radius?: number;
    maxResults?: number;
  }) {
    // Navigate to search page
    await this.page.goto('/search');

    // Fill in search form
    await this.page.fill('[data-testid="business-type-input"]', params.businessType);
    await this.page.fill('[data-testid="location-input"]', params.location);

    if (params.radius) {
      await this.page.fill('[data-testid="radius-input"]', params.radius.toString());
    }

    if (params.maxResults) {
      await this.page.fill('[data-testid="max-results-input"]', params.maxResults.toString());
    }

    // Submit search
    await this.page.click('[data-testid="create-search-button"]');

    // Wait for search to be created
    await this.page.waitForSelector('[data-testid="search-status"]', { timeout: 10000 });

    // Get search ID from URL
    const url = this.page.url();
    const searchId = url.split('/').pop();
    return searchId!;
  }

  /**
   * Wait for search pipeline to complete
   */
  async waitForSearchCompletion(searchId: string, timeout = 120000) {
    await this.page.goto(`/search/${searchId}`);

    // Wait for completion status
    await this.page.waitForSelector(
      '[data-testid="search-status"]:has-text("completed")',
      { timeout }
    );
  }

  /**
   * Export search results to CSV
   */
  async exportToCSV(searchId: string) {
    await this.page.goto(`/search/${searchId}`);

    // Click export button
    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      this.page.click('[data-testid="export-csv-button"]'),
    ]);

    return download;
  }

  /**
   * Get search results count
   */
  async getResultsCount(): Promise<number> {
    const countText = await this.page.textContent('[data-testid="results-count"]');
    return parseInt(countText?.match(/\d+/)?.[0] || '0', 10);
  }

  /**
   * Get pipeline stage status
   */
  async getPipelineStages() {
    await this.page.waitForSelector('[data-testid="pipeline-stage"]');

    const stages = await this.page.$$eval('[data-testid="pipeline-stage"]', (elements) =>
      elements.map((el) => ({
        name: el.getAttribute('data-stage-name'),
        status: el.getAttribute('data-stage-status'),
      }))
    );

    return stages;
  }
}

/**
 * Credit management helpers
 */
export class CreditHelpers {
  constructor(private page: Page) {}

  /**
   * Get current credit balance
   */
  async getCreditBalance(): Promise<number> {
    await this.page.waitForSelector('[data-testid="credit-balance"]');
    const balanceText = await this.page.textContent('[data-testid="credit-balance"]');
    return parseInt(balanceText?.match(/\d+/)?.[0] || '0', 10);
  }

  /**
   * Purchase credits
   */
  async purchaseCredits(amount: number) {
    await this.page.goto('/settings/billing');

    // Click buy credits button
    await this.page.click('[data-testid="buy-credits-button"]');

    // Select amount
    await this.page.click(`[data-testid="credit-amount-${amount}"]`);

    // Fill in test payment details (Stripe test mode)
    await this.page.fill('[data-testid="card-number"]', '4242424242424242');
    await this.page.fill('[data-testid="card-expiry"]', '12/34');
    await this.page.fill('[data-testid="card-cvc"]', '123');
    await this.page.fill('[data-testid="card-zip"]', '12345');

    // Submit payment
    await this.page.click('[data-testid="submit-payment-button"]');

    // Wait for success message
    await this.page.waitForSelector('[data-testid="payment-success"]', { timeout: 30000 });
  }
}

/**
 * Common assertions for E2E tests
 */
export class TestAssertions {
  constructor(private page: Page) {}

  /**
   * Assert page title contains text
   */
  async assertPageTitle(text: string) {
    await expect(this.page).toHaveTitle(new RegExp(text, 'i'));
  }

  /**
   * Assert element is visible
   */
  async assertVisible(selector: string) {
    await expect(this.page.locator(selector)).toBeVisible();
  }

  /**
   * Assert element contains text
   */
  async assertText(selector: string, text: string) {
    await expect(this.page.locator(selector)).toContainText(text);
  }

  /**
   * Assert toast message appears
   */
  async assertToast(message: string) {
    await expect(this.page.locator('[data-testid="toast"]')).toContainText(message);
  }

  /**
   * Assert error message appears
   */
  async assertError(message: string) {
    await expect(this.page.locator('[role="alert"]')).toContainText(message);
  }
}

/**
 * Wait utilities
 */
export class WaitHelpers {
  constructor(private page: Page) {}

  /**
   * Wait for network to be idle
   */
  async waitForNetworkIdle(timeout = 5000) {
    await this.page.waitForLoadState('networkidle', { timeout });
  }

  /**
   * Wait for specific API response
   */
  async waitForAPIResponse(urlPattern: string | RegExp, timeout = 30000) {
    await this.page.waitForResponse(urlPattern, { timeout });
  }

  /**
   * Wait for element with retry
   */
  async waitForElement(selector: string, timeout = 10000) {
    await this.page.waitForSelector(selector, { timeout });
  }
}
