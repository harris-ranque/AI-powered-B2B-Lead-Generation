# E2E Testing with Playwright

End-to-end tests for Genni web application covering critical user journeys and error scenarios.

## Test Coverage

### Critical User Flows (5 tests implemented)
1. **Signup → Search → Export** (`01-critical-flow.spec.ts`)
   - User registration with Clerk
   - Complete search pipeline execution
   - Results viewing and CSV export
   - Search history verification

2. **Credit Purchase → Search** (`02-credit-purchase.spec.ts`)
   - Credit balance management
   - Stripe payment integration
   - Transaction history tracking
   - Search creation with purchased credits

3. **Error Handling** (`03-error-handling.spec.ts`)
   - Insufficient credits error flow
   - Network interruption recovery
   - Invalid search parameters validation
   - Search timeout handling
   - Partial results handling
   - Rate limit error handling

4. **Pipeline Status Display** (`04-pipeline-and-export.spec.ts`)
   - Real-time pipeline progress monitoring
   - Stage transitions (Discovery → Enrichment → Analysis)
   - Progress indicators and metrics
   - Error state display

5. **CSV Export Validation** (`04-pipeline-and-export.spec.ts`)
   - Complete data export
   - CSV structure validation
   - Data accuracy verification
   - Special character escaping

## Running Tests

### Prerequisites
```bash
# Install dependencies
pnpm install

# Install Playwright browsers
npx playwright install chromium
```

### Run All E2E Tests
```bash
cd apps/web
pnpm test:e2e
```

### Run Tests in UI Mode
```bash
pnpm test:e2e:ui
```

### Run Tests in Headed Mode (see browser)
```bash
pnpm test:e2e:headed
```

### Debug Tests
```bash
pnpm test:e2e:debug
```

### Run Specific Test File
```bash
npx playwright test e2e/01-critical-flow.spec.ts
```

## Test Configuration

### Environment Variables
Create `.env.test` file with:
```env
PLAYWRIGHT_BASE_URL=http://localhost:3000
CLERK_TEST_EMAIL=test@genni-e2e.com
CLERK_TEST_PASSWORD=TestPassword123!
STRIPE_TEST_CARD=4242424242424242
```

### Test User Accounts
Tests use dynamically generated email addresses to avoid conflicts:
- Format: `test-{timestamp}@genni-e2e.com`
- Password: `TestPassword123!`

**Note**: Make sure your test environment is configured to allow test account creation.

## Test Structure

### Helper Classes (`utils/test-helpers.ts`)

#### **AuthHelpers**
- `signUp(email, password, name)` - Create new user
- `login(email, password)` - Log in existing user
- `logout()` - Log out current user

#### **SearchHelpers**
- `createSearch(params)` - Create new search
- `waitForSearchCompletion(searchId)` - Wait for pipeline completion
- `exportToCSV(searchId)` - Export results
- `getResultsCount()` - Get displayed results count
- `getPipelineStages()` - Get pipeline stage status

#### **CreditHelpers**
- `getCreditBalance()` - Get current balance
- `purchaseCredits(amount)` - Buy credits via Stripe

#### **TestAssertions**
- `assertPageTitle(text)` - Verify page title
- `assertVisible(selector)` - Verify element visibility
- `assertText(selector, text)` - Verify element text
- `assertToast(message)` - Verify toast notification
- `assertError(message)` - Verify error message

#### **WaitHelpers**
- `waitForNetworkIdle()` - Wait for network activity to stop
- `waitForAPIResponse(pattern)` - Wait for specific API call
- `waitForElement(selector)` - Wait for element with retry

## Test Data Attributes

### Required Test IDs

For E2E tests to work, your components must include these `data-testid` attributes:

#### Authentication
- `sign-up-button` - Sign up button
- `sign-in-button` - Sign in button
- `sign-out-button` - Sign out button
- `user-menu` - User menu dropdown
- `user-profile` - User profile section

#### Search
- `business-type-input` - Business type field
- `location-input` - Location field
- `radius-input` - Radius field
- `max-results-input` - Max results field
- `create-search-button` - Create search button
- `search-status` - Search status indicator
- `search-history` - Search history section
- `search-history-item` - Individual search in history

#### Pipeline
- `pipeline-stage` - Pipeline stage component (with `data-stage-name` and `data-stage-status`)
- `pipeline-error` - Pipeline error message
- `discovery-progress` - Discovery stage progress
- `enrichment-progress` - Enrichment stage progress
- `analysis-progress` - Analysis stage progress
- `leads-discovered-count` - Count of discovered leads
- `leads-enriched-count` - Count of enriched leads
- `leads-analyzed-count` - Count of analyzed leads

#### Results
- `lead-card` - Lead card component
- `lead-business-name` - Business name field
- `lead-contact-info` - Contact information section
- `lead-email` - Email address field
- `lead-relevance-score` - AI relevance score
- `results-count` - Total results count
- `export-csv-button` - CSV export button

#### Credits & Billing
- `credit-balance` - Credit balance display
- `buy-credits-button` - Buy credits button
- `credit-package` - Credit package option
- `credit-amount-{N}` - Specific credit package (e.g., `credit-amount-100`)
- `submit-payment-button` - Payment form submit
- `payment-success` - Payment success message
- `transaction-history` - Transaction history section
- `transaction-item` - Individual transaction

#### Errors & Notifications
- `[role="alert"]` - Error messages
- `[data-testid="toast"]` - Toast notifications
- `offline-indicator` - Offline status indicator
- `online-indicator` - Online status indicator

## CI/CD Integration

### GitHub Actions Example
```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          node-version: 18
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install

      - name: Install Playwright
        run: npx playwright install --with-deps chromium

      - name: Run E2E tests
        run: pnpm test:e2e
        env:
          CI: true

      - uses: actions/upload-artifact@v3
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
```

## Best Practices

### 1. Use Unique Test Data
Generate unique emails/data to avoid conflicts:
```typescript
const uniqueEmail = `test-${Date.now()}@genni-e2e.com`;
```

### 2. Wait for Network Stability
Use proper waits instead of arbitrary timeouts:
```typescript
await waits.waitForNetworkIdle();
await waits.waitForAPIResponse(/\/api\/search/);
```

### 3. Use Test Steps
Organize tests into logical steps:
```typescript
test.step('User creates search', async () => {
  // Test code
});
```

### 4. Clean Up Test Data
If needed, implement cleanup logic in `afterEach`:
```typescript
test.afterEach(async ({ page }) => {
  // Clean up test data
});
```

### 5. Screenshot on Failure
Playwright automatically captures screenshots and videos on failure when `screenshot: 'only-on-failure'` is configured.

## Troubleshooting

### Tests timing out
- Increase timeout in `playwright.config.ts`
- Check network conditions
- Verify dev server is running
- Check for infinite loops in app code

### Authentication failures
- Verify Clerk test credentials
- Check environment variables
- Ensure test environment allows new signups

### Element not found
- Verify `data-testid` attributes exist
- Check for dynamic content loading
- Use proper wait strategies

### Stripe payment failures
- Verify Stripe test mode is enabled
- Use correct test card numbers
- Check webhook configuration

## Reporting

### HTML Report
After test run:
```bash
npx playwright show-report
```

### CI Reports
Reports are automatically generated in `playwright-report/` directory.

## Next Steps

### Component Tests (Remaining)
- SearchPage component
- CompanyCard component
- PipelineProgressPanel (already has 1 test)
- CreditBalance component
- SubscriptionGuard component

### Security Tests (Remaining)
- Authentication flow security
- Authorization checks
- Data isolation between users
- Rate limiting validation
- Input sanitization

## Resources

- [Playwright Documentation](https://playwright.dev)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Test Selectors](https://playwright.dev/docs/selectors)
- [Debugging Tests](https://playwright.dev/docs/debug)
