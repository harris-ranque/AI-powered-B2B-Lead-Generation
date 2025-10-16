import { test, expect, Page } from '@playwright/test'

// Test data
const testUser = {
  email: 'test@example.com',
  password: 'test-password-123'
}

const testBusinessProfile = {
  companyName: 'Test AI Solutions',
  industry: 'Artificial Intelligence',
  valueProposition: 'We help businesses automate their processes with AI',
  services: ['AI Consulting', 'Process Automation', 'Machine Learning'],
  targetMarkets: ['B2B SaaS', 'Manufacturing', 'Healthcare'],
  keyDifferentiators: ['Advanced AI algorithms', 'Fast implementation', '24/7 support']
}

const testSearch = {
  name: 'San Francisco SaaS Companies',
  location: 'San Francisco, CA',
  keywords: ['SaaS', 'software', 'technology'],
  radius: 25,
  maxResults: 20
}

test.describe('Lead Generation Workflow', () => {
  test.beforeEach(async ({ page }) => {
    // Set up test environment
    await page.goto('/')

    // Mock API responses to avoid consuming real credits
    await page.route('**/api/**', (route) => {
      const url = route.request().url()

      if (url.includes('/search/create')) {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            _id: 'test-search-id',
            status: 'pending',
            message: 'Search created successfully'
          })
        })
      } else if (url.includes('/places/predictions')) {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            predictions: [
              {
                placeId: 'test-place-id',
                description: 'San Francisco, CA, USA',
                mainText: 'San Francisco',
                secondaryText: 'CA, USA'
              }
            ]
          })
        })
      } else {
        route.continue()
      }
    })
  })

  test('Complete lead generation workflow from signup to email generation', async ({ page }) => {
    test.setTimeout(120000) // 2 minute timeout for full workflow

    // Step 1: User Authentication
    await test.step('User signs up and authenticates', async () => {
      await page.click('[data-testid="sign-in-button"]')

      // Fill authentication form (mocked)
      await page.fill('[data-testid="email-input"]', testUser.email)
      await page.fill('[data-testid="password-input"]', testUser.password)
      await page.click('[data-testid="submit-button"]')

      // Wait for successful authentication
      await expect(page.locator('[data-testid="user-button"]')).toBeVisible({ timeout: 10000 })
    })

    // Step 2: Business Profile Setup
    await test.step('User completes business profile setup', async () => {
      // Should show profile setup wizard
      await expect(page.locator('text=Complete your profile')).toBeVisible()

      // Fill business profile form
      await page.fill('[data-testid="company-name-input"]', testBusinessProfile.companyName)
      await page.selectOption('[data-testid="industry-select"]', testBusinessProfile.industry)
      await page.fill('[data-testid="value-proposition-textarea"]', testBusinessProfile.valueProposition)

      // Add services
      for (const service of testBusinessProfile.services) {
        await page.fill('[data-testid="service-input"]', service)
        await page.click('[data-testid="add-service-button"]')
      }

      // Add target markets
      for (const market of testBusinessProfile.targetMarkets) {
        await page.fill('[data-testid="market-input"]', market)
        await page.click('[data-testid="add-market-button"]')
      }

      // Add key differentiators
      for (const differentiator of testBusinessProfile.keyDifferentiators) {
        await page.fill('[data-testid="differentiator-input"]', differentiator)
        await page.click('[data-testid="add-differentiator-button"]')
      }

      // Submit profile
      await page.click('[data-testid="save-profile-button"]')

      // Wait for profile completion
      await expect(page.locator('text=Dashboard')).toBeVisible({ timeout: 10000 })
    })

    // Step 3: Create New Search
    await test.step('User creates a new lead search', async () => {
      await page.click('[data-testid="new-search-button"]')

      // Fill search form
      await page.fill('[data-testid="search-name-input"]', testSearch.name)

      // Location input with autocomplete
      await page.fill('[data-testid="location-input"]', testSearch.location)
      await page.waitForSelector('[data-testid="location-suggestion"]')
      await page.click('[data-testid="location-suggestion"]')

      // Set radius
      await page.fill('[data-testid="radius-input"]', testSearch.radius.toString())

      // Add keywords
      for (const keyword of testSearch.keywords) {
        await page.fill('[data-testid="keyword-input"]', keyword)
        await page.click('[data-testid="add-keyword-button"]')
      }

      // Set max results
      await page.fill('[data-testid="max-results-input"]', testSearch.maxResults.toString())

      // Submit search
      await page.click('[data-testid="create-search-button"]')

      // Wait for search creation confirmation
      await expect(page.locator('text=Search created successfully')).toBeVisible()
    })

    // Step 4: Monitor Search Progress
    await test.step('User monitors search progress', async () => {
      // Should redirect to search progress page
      await expect(page.locator('[data-testid="search-progress"]')).toBeVisible()

      // Wait for different progress stages
      await expect(page.locator('text=Discovering leads')).toBeVisible()

      // Mock progress updates
      await page.evaluate(() => {
        // Simulate real-time progress updates
        const progressElement = document.querySelector('[data-testid="progress-bar"]')
        if (progressElement) {
          progressElement.setAttribute('data-progress', '25')
        }
      })

      await expect(page.locator('text=Enriching contact information')).toBeVisible()

      // Continue until completion
      await page.evaluate(() => {
        const progressElement = document.querySelector('[data-testid="progress-bar"]')
        if (progressElement) {
          progressElement.setAttribute('data-progress', '100')
        }
      })

      await expect(page.locator('text=Search completed')).toBeVisible({ timeout: 30000 })
    })

    // Step 5: Review Lead Results
    await test.step('User reviews generated leads', async () => {
      // Should show lead results
      await expect(page.locator('[data-testid="lead-results"]')).toBeVisible()

      // Check that leads are displayed
      await expect(page.locator('[data-testid="lead-card"]')).toHaveCount({ min: 1 })

      // Check lead information display
      const firstLead = page.locator('[data-testid="lead-card"]').first()
      await expect(firstLead.locator('[data-testid="company-name"]')).toBeVisible()
      await expect(firstLead.locator('[data-testid="relevance-score"]')).toBeVisible()
      await expect(firstLead.locator('[data-testid="contact-info"]')).toBeVisible()
    })

    // Step 6: View Generated Email
    await test.step('User views AI-generated email content', async () => {
      // Click on first lead to view details
      await page.click('[data-testid="lead-card"]')

      // Should show lead details modal
      await expect(page.locator('[data-testid="lead-details-modal"]')).toBeVisible()

      // Check AI analysis results
      await expect(page.locator('[data-testid="ai-analysis"]')).toBeVisible()
      await expect(page.locator('[data-testid="pain-points"]')).toBeVisible()
      await expect(page.locator('[data-testid="value-matches"]')).toBeVisible()

      // Check generated email content
      await expect(page.locator('[data-testid="email-subject"]')).toBeVisible()
      await expect(page.locator('[data-testid="email-body"]')).toBeVisible()
      await expect(page.locator('[data-testid="personalization-notes"]')).toBeVisible()

      // Verify email quality
      const emailSubject = await page.locator('[data-testid="email-subject"]').textContent()
      expect(emailSubject).toBeTruthy()
      expect(emailSubject!.length).toBeGreaterThan(10)

      const emailBody = await page.locator('[data-testid="email-body"]').textContent()
      expect(emailBody).toBeTruthy()
      expect(emailBody!.length).toBeGreaterThan(100)
    })

    // Step 7: Export Results
    await test.step('User exports lead data', async () => {
      await page.click('[data-testid="close-modal-button"]')

      // Click export button
      await page.click('[data-testid="export-leads-button"]')

      // Choose export format
      await page.selectOption('[data-testid="export-format-select"]', 'csv')

      // Start download
      const downloadPromise = page.waitForEvent('download')
      await page.click('[data-testid="download-button"]')

      // Verify download
      const download = await downloadPromise
      expect(download.suggestedFilename()).toContain('.csv')
    })
  })

  test('Search progress real-time updates', async ({ page }) => {
    await authenticateUser(page)
    await completeBusinessProfile(page)

    // Create a search
    await createTestSearch(page)

    // Monitor real-time updates
    await test.step('Real-time progress updates work correctly', async () => {
      // Mock WebSocket or SSE updates
      await page.evaluate(() => {
        // Simulate real-time progress events
        const events = [
          { stage: 'discovery', progress: 25, message: 'Found 5 potential leads' },
          { stage: 'enrichment', progress: 50, message: 'Enriched 3 leads with contact information' },
          { stage: 'analysis', progress: 75, message: 'Analyzed 2 leads with AI' },
          { stage: 'completed', progress: 100, message: 'Search completed successfully' }
        ]

        events.forEach((event, index) => {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('search-progress', { detail: event }))
          }, index * 2000)
        })
      })

      // Verify each progress update
      await expect(page.locator('text=Found 5 potential leads')).toBeVisible({ timeout: 5000 })
      await expect(page.locator('text=Enriched 3 leads')).toBeVisible({ timeout: 5000 })
      await expect(page.locator('text=Analyzed 2 leads')).toBeVisible({ timeout: 5000 })
      await expect(page.locator('text=Search completed successfully')).toBeVisible({ timeout: 5000 })
    })
  })

  test('Error handling and recovery', async ({ page }) => {
    await authenticateUser(page)
    await completeBusinessProfile(page)

    await test.step('Handles API errors gracefully', async () => {
      // Mock API failure
      await page.route('**/api/search/create', (route) => {
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Internal server error',
            message: 'Failed to create search'
          })
        })
      })

      // Attempt to create search
      await page.click('[data-testid="new-search-button"]')
      await fillSearchForm(page)
      await page.click('[data-testid="create-search-button"]')

      // Should show error message
      await expect(page.locator('text=Failed to create search')).toBeVisible()

      // Should allow retry
      await expect(page.locator('[data-testid="retry-button"]')).toBeVisible()
    })

    await test.step('Handles network connectivity issues', async () => {
      // Simulate network disconnection
      await page.context().setOffline(true)

      await page.click('[data-testid="retry-button"]')

      // Should show offline message
      await expect(page.locator('text=No internet connection')).toBeVisible()

      // Restore connection
      await page.context().setOffline(false)

      // Should automatically retry
      await expect(page.locator('text=Connection restored')).toBeVisible()
    })
  })

  test('Performance benchmarks', async ({ page }) => {
    await test.step('Application loads within performance targets', async () => {
      const startTime = Date.now()

      await page.goto('/')
      await page.waitForLoadState('networkidle')

      const loadTime = Date.now() - startTime
      expect(loadTime).toBeLessThan(3000) // Should load within 3 seconds
    })

    await test.step('Search creation is responsive', async () => {
      await authenticateUser(page)
      await completeBusinessProfile(page)

      const startTime = Date.now()

      await page.click('[data-testid="new-search-button"]')
      await fillSearchForm(page)

      const formTime = Date.now() - startTime
      expect(formTime).toBeLessThan(1000) // Form should be responsive

      const submitStartTime = Date.now()
      await page.click('[data-testid="create-search-button"]')
      await expect(page.locator('text=Search created successfully')).toBeVisible()

      const submitTime = Date.now() - submitStartTime
      expect(submitTime).toBeLessThan(5000) // Should submit within 5 seconds
    })
  })

  test('Accessibility compliance', async ({ page }) => {
    await page.goto('/')

    await test.step('Keyboard navigation works correctly', async () => {
      // Test tab navigation
      await page.keyboard.press('Tab')
      await expect(page.locator(':focus')).toBeVisible()

      // Test skip links
      await page.keyboard.press('Tab')
      const skipLink = page.locator('[data-testid="skip-to-content"]')
      if (await skipLink.isVisible()) {
        await page.keyboard.press('Enter')
        await expect(page.locator('[data-testid="main-content"]')).toBeFocused()
      }
    })

    await test.step('Screen reader compatibility', async () => {
      // Check for proper headings hierarchy
      const h1Count = await page.locator('h1').count()
      expect(h1Count).toBe(1) // Should have exactly one H1

      // Check for alt text on images
      const images = page.locator('img')
      const imageCount = await images.count()

      for (let i = 0; i < imageCount; i++) {
        const img = images.nth(i)
        const alt = await img.getAttribute('alt')
        expect(alt).toBeTruthy() // All images should have alt text
      }

      // Check for proper form labels
      const inputs = page.locator('input[type="text"], input[type="email"], textarea')
      const inputCount = await inputs.count()

      for (let i = 0; i < inputCount; i++) {
        const input = inputs.nth(i)
        const hasLabel = await input.evaluate((el) => {
          const id = el.getAttribute('id')
          const ariaLabel = el.getAttribute('aria-label')
          const ariaLabelledBy = el.getAttribute('aria-labelledby')

          if (ariaLabel || ariaLabelledBy) return true
          if (id) {
            return document.querySelector(`label[for="${id}"]`) !== null
          }
          return false
        })

        expect(hasLabel).toBe(true) // All inputs should have proper labels
      }
    })

    await test.step('Color contrast and visual accessibility', async () => {
      // This would typically use axe-core or similar accessibility testing library
      await page.addScriptTag({ url: 'https://unpkg.com/axe-core@4.7.0/axe.min.js' })

      const accessibilityResults = await page.evaluate(() => {
        return new Promise((resolve) => {
          // @ts-ignore
          axe.run((err, results) => {
            if (err) throw err
            resolve(results)
          })
        })
      })

      // @ts-ignore
      const violations = accessibilityResults.violations
      expect(violations.length).toBe(0) // Should have no accessibility violations
    })
  })
})

// Helper functions
async function authenticateUser(page: Page) {
  await page.click('[data-testid="sign-in-button"]')
  await page.fill('[data-testid="email-input"]', testUser.email)
  await page.fill('[data-testid="password-input"]', testUser.password)
  await page.click('[data-testid="submit-button"]')
  await expect(page.locator('[data-testid="user-button"]')).toBeVisible()
}

async function completeBusinessProfile(page: Page) {
  if (await page.locator('text=Complete your profile').isVisible()) {
    await page.fill('[data-testid="company-name-input"]', testBusinessProfile.companyName)
    await page.selectOption('[data-testid="industry-select"]', testBusinessProfile.industry)
    await page.fill('[data-testid="value-proposition-textarea"]', testBusinessProfile.valueProposition)
    await page.click('[data-testid="save-profile-button"]')
    await expect(page.locator('text=Dashboard')).toBeVisible()
  }
}

async function createTestSearch(page: Page) {
  await page.click('[data-testid="new-search-button"]')
  await fillSearchForm(page)
  await page.click('[data-testid="create-search-button"]')
  await expect(page.locator('text=Search created successfully')).toBeVisible()
}

async function fillSearchForm(page: Page) {
  await page.fill('[data-testid="search-name-input"]', testSearch.name)
  await page.fill('[data-testid="location-input"]', testSearch.location)
  await page.fill('[data-testid="radius-input"]', testSearch.radius.toString())

  for (const keyword of testSearch.keywords) {
    await page.fill('[data-testid="keyword-input"]', keyword)
    await page.click('[data-testid="add-keyword-button"]')
  }

  await page.fill('[data-testid="max-results-input"]', testSearch.maxResults.toString())
}