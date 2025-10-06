#!/usr/bin/env node

/**
 * Complete ICypeas API Integration Test
 * Tests the full enrichment flow with multiple domains
 */

const ICYPEAS_API_KEY = process.env.ICYPEAS_API_KEY || "";
const ICYPEAS_BASE_URL = "https://app.icypeas.com/api";

class IcyPeasTester {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async startEmailSearch(domain, companyName) {
    const url = `${ICYPEAS_BASE_URL}/email-search`;

    const body = {
      firstname: companyName || "",
      lastname: "",
      domainOrCompany: domain,
    };

    console.log(`[ICypeas] Starting search for ${domain}...`);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const jsonResponse = await response.json();

    // Extract searchId from response (matches fixed implementation)
    const searchId = jsonResponse.item?._id || jsonResponse.searchId;
    const status = jsonResponse.item?.status || jsonResponse.status;

    if (jsonResponse.validationErrors?.length > 0) {
      const errors = jsonResponse.validationErrors
        .map(e => e.humanReadableMessage || e.message)
        .join('; ');
      throw new Error(`Validation error: ${errors}`);
    }

    if (!jsonResponse.success || !searchId) {
      throw new Error(jsonResponse.message || "Search initiation failed");
    }

    return { searchId, status };
  }

  async pollForResults(searchId, maxAttempts = 15) {
    const url = `${ICYPEAS_BASE_URL}/bulk-single-searchs/read`;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: searchId }), // Use 'id' not 'searchId'
      });

      if (!response.ok) {
        throw new Error(`Polling error: ${response.status}`);
      }

      const rawResult = await response.json();

      // Extract result from items array (matches fixed implementation)
      const item = rawResult.items?.[0];
      const status = item?.status;
      const emails = item?.results?.emails || [];
      const phones = item?.results?.phones || [];

      if (status === "FOUND" || status === "NOT_FOUND") {
        return {
          success: true,
          status,
          emails,
          phones,
          searchId
        };
      } else if (status === "ERROR") {
        throw new Error("Search failed on ICypeas side");
      }

      // Still processing, wait and try again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error("Polling timeout");
  }

  async enrichSingle(domain, companyName) {
    try {
      const { searchId, status } = await this.startEmailSearch(domain, companyName);
      console.log(`   ✓ Search initiated: ${searchId} (${status})`);

      const result = await this.pollForResults(searchId);
      console.log(`   ✓ Search completed: ${result.status}`);
      console.log(`   ✓ Emails found: ${result.emails.length}`);

      return result;
    } catch (error) {
      console.error(`   ✗ Error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async enrichBatch(domains) {
    console.log(`\n🔄 Batch Enrichment Test: ${domains.length} domains\n`);

    const results = {};
    for (let i = 0; i < domains.length; i++) {
      const domain = domains[i];
      console.log(`[${i + 1}/${domains.length}] Processing ${domain}`);

      const result = await this.enrichSingle(domain, this.extractCompanyName(domain));
      results[domain] = result;

      // Small delay between requests to respect rate limits
      if (i < domains.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return results;
  }

  extractCompanyName(domain) {
    const cleaned = domain
      .replace(/^www\./, "")
      .replace(/\.(com|org|net|io|co|ai|app|dev|tech).*$/, "");
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
}

async function runTests() {
  console.log("🧪 ICypeas API Integration Test Suite\n");
  console.log("Configuration:");
  console.log(`- Base URL: ${ICYPEAS_BASE_URL}`);
  console.log(`- API Key: ${ICYPEAS_API_KEY ? ICYPEAS_API_KEY.substring(0, 8) + '...' : 'NOT SET'}\n`);

  if (!ICYPEAS_API_KEY) {
    console.error("❌ Error: ICYPEAS_API_KEY environment variable not set");
    console.log("\nUsage: ICYPEAS_API_KEY=your_key node test-icypeas-complete.js");
    process.exit(1);
  }

  const tester = new IcyPeasTester(ICYPEAS_API_KEY);

  // Test domains (from your error logs)
  const testDomains = [
    "icypeas.com",        // Should find emails
    "google.com",         // Large company - should find emails
    "nonexistent123.com"  // Should return NOT_FOUND
  ];

  const results = await tester.enrichBatch(testDomains);

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 Test Results Summary");
  console.log("=".repeat(60) + "\n");

  let successful = 0;
  let notFound = 0;
  let failed = 0;

  for (const [domain, result] of Object.entries(results)) {
    if (result.success === false) {
      console.log(`❌ ${domain}: FAILED - ${result.error}`);
      failed++;
    } else if (result.status === "FOUND") {
      console.log(`✅ ${domain}: FOUND - ${result.emails.length} emails`);
      if (result.emails.length > 0) {
        result.emails.forEach(email => {
          console.log(`   └─ ${email.email} (${email.certainty})`);
        });
      }
      successful++;
    } else if (result.status === "NOT_FOUND") {
      console.log(`⚠️  ${domain}: NOT_FOUND`);
      notFound++;
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`Total: ${testDomains.length} domains`);
  console.log(`✅ Found: ${successful}`);
  console.log(`⚠️  Not Found: ${notFound}`);
  console.log(`❌ Failed: ${failed}`);
  console.log("=".repeat(60) + "\n");

  if (failed === 0) {
    console.log("🎉 All tests completed successfully! ICypeas integration is working.");
  } else {
    console.log("⚠️  Some tests failed. Check the error messages above.");
  }
}

runTests().catch(console.error);
