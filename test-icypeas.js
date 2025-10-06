#!/usr/bin/env node

/**
 * ICypeas API Test Script
 * Tests the ICypeas email search API with proper request format
 */

const ICYPEAS_API_KEY = process.env.ICYPEAS_API_KEY || "";
const ICYPEAS_BASE_URL = "https://app.icypeas.com/api";

async function testEmailSearch() {
  console.log("🔍 Testing ICypeas Email Search API\n");
  console.log("Configuration:");
  console.log(`- Base URL: ${ICYPEAS_BASE_URL}`);
  console.log(`- API Key: ${ICYPEAS_API_KEY ? ICYPEAS_API_KEY.substring(0, 8) + '...' : 'NOT SET'}\n`);

  if (!ICYPEAS_API_KEY) {
    console.error("❌ Error: ICYPEAS_API_KEY environment variable not set");
    console.log("\nUsage: ICYPEAS_API_KEY=your_key node test-icypeas.js");
    process.exit(1);
  }

  const testDomain = "icypeas.com";

  console.log(`📧 Test Case: Searching for email at domain: ${testDomain}\n`);

  // Test 1: Correct format with firstname and lastname
  console.log("Test 1: Email search with firstname, lastname, and domain");
  console.log("─".repeat(60));

  const correctRequest = {
    firstname: "John",
    lastname: "Doe",
    domainOrCompany: testDomain
  };

  console.log("Request body:", JSON.stringify(correctRequest, null, 2));

  try {
    const response = await fetch(`${ICYPEAS_BASE_URL}/email-search`, {
      method: "POST",
      headers: {
        "Authorization": ICYPEAS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(correctRequest),
    });

    console.log(`\nResponse status: ${response.status} ${response.statusText}`);

    const data = await response.json();
    console.log("Response body:", JSON.stringify(data, null, 2));

    if (data.success && data.searchId) {
      console.log("\n✅ Test 1 PASSED: Search initiated successfully");
      console.log(`   Search ID: ${data.searchId}`);

      // Poll for results
      console.log("\n📊 Polling for results...");
      await pollForResults(data.searchId);
    } else {
      console.log("\n❌ Test 1 FAILED: Search did not initiate");
      console.log("   Reason:", data.message || "Unknown");
    }
  } catch (error) {
    console.error("\n❌ Test 1 ERROR:", error.message);
  }

  // Test 2: Domain-only search (current incorrect implementation)
  console.log("\n\nTest 2: Domain-only search (EXPECTED TO FAIL)");
  console.log("─".repeat(60));

  const domainOnlyRequest = {
    domainOrCompany: testDomain
  };

  console.log("Request body:", JSON.stringify(domainOnlyRequest, null, 2));

  try {
    const response = await fetch(`${ICYPEAS_BASE_URL}/email-search`, {
      method: "POST",
      headers: {
        "Authorization": ICYPEAS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(domainOnlyRequest),
    });

    console.log(`\nResponse status: ${response.status} ${response.statusText}`);

    const data = await response.json();
    console.log("Response body:", JSON.stringify(data, null, 2));

    if (!data.success) {
      console.log("\n✅ Test 2 CONFIRMED: Domain-only search fails as expected");
      console.log("   This matches the error in your logs");
    } else {
      console.log("\n⚠️ Test 2 UNEXPECTED: Domain-only search succeeded");
    }
  } catch (error) {
    console.error("\n❌ Test 2 ERROR:", error.message);
  }

  // Test 3: With empty firstname/lastname (API allows this)
  console.log("\n\nTest 3: Search with empty firstname/lastname");
  console.log("─".repeat(60));

  const emptyNameRequest = {
    firstname: "",
    lastname: "",
    domainOrCompany: testDomain
  };

  console.log("Request body:", JSON.stringify(emptyNameRequest, null, 2));

  try {
    const response = await fetch(`${ICYPEAS_BASE_URL}/email-search`, {
      method: "POST",
      headers: {
        "Authorization": ICYPEAS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emptyNameRequest),
    });

    console.log(`\nResponse status: ${response.status} ${response.statusText}`);

    const data = await response.json();
    console.log("Response body:", JSON.stringify(data, null, 2));

    if (data.success && data.searchId) {
      console.log("\n✅ Test 3 PASSED: Empty names accepted");
      console.log(`   Search ID: ${data.searchId}`);
    } else {
      console.log("\n❌ Test 3 FAILED");
      console.log("   Reason:", data.message || "Unknown");
    }
  } catch (error) {
    console.error("\n❌ Test 3 ERROR:", error.message);
  }
}

async function pollForResults(searchId, maxAttempts = 10) {
  const url = `${ICYPEAS_BASE_URL}/bulk-single-searchs/read`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`   Attempt ${attempt}/${maxAttempts}...`);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": ICYPEAS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ searchId }),
      });

      const result = await response.json();

      if (result.status === "FOUND" || result.status === "NOT_FOUND") {
        console.log(`\n   ✅ Search completed: ${result.status}`);
        console.log(`   Emails found: ${result.emails?.length || 0}`);
        if (result.emails?.length > 0) {
          console.log(`   First email: ${result.emails[0].email} (${result.emails[0].certainty})`);
        }
        return result;
      } else if (result.status === "ERROR") {
        console.log(`\n   ❌ Search failed with ERROR status`);
        return result;
      }

      // Still processing, wait and try again
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`   Error on attempt ${attempt}:`, error.message);
      if (attempt === maxAttempts) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log("\n   ⏱️ Polling timeout - search took too long");
}

// Run the test
testEmailSearch().catch(console.error);
