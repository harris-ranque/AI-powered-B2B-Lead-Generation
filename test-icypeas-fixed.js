#!/usr/bin/env node

/**
 * ICypeas API Test Script - Fixed Implementation
 * Tests the corrected ICypeas integration that matches the codebase
 */

const ICYPEAS_API_KEY = process.env.ICYPEAS_API_KEY || "";
const ICYPEAS_BASE_URL = "https://app.icypeas.com/api";

async function testFixedImplementation() {
  console.log("🔍 Testing FIXED ICypeas Implementation\n");
  console.log("Configuration:");
  console.log(`- Base URL: ${ICYPEAS_BASE_URL}`);
  console.log(`- API Key: ${ICYPEAS_API_KEY ? ICYPEAS_API_KEY.substring(0, 8) + '...' : 'NOT SET'}\n`);

  if (!ICYPEAS_API_KEY) {
    console.error("❌ Error: ICYPEAS_API_KEY environment variable not set");
    console.log("\nUsage: ICYPEAS_API_KEY=your_key node test-icypeas-fixed.js");
    process.exit(1);
  }

  const testDomain = "fredloya.com";
  const companyName = "Fred Loya"; // Extract from domain

  console.log(`📧 Test: Domain-based enrichment for ${testDomain}\n`);
  console.log("Fixed Implementation (matching codebase):");
  console.log("─".repeat(60));

  // This matches the FIXED implementation in icypeas.ts
  const fixedRequest = {
    firstname: companyName || "",  // Use company name as firstname (or empty)
    lastname: "",                  // Empty lastname
    domainOrCompany: testDomain    // The domain to search
  };

  console.log("Request body:", JSON.stringify(fixedRequest, null, 2));

  try {
    const response = await fetch(`${ICYPEAS_BASE_URL}/email-search`, {
      method: "POST",
      headers: {
        "Authorization": ICYPEAS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(fixedRequest),
    });

    console.log(`\nResponse status: ${response.status} ${response.statusText}`);

    const data = await response.json();
    console.log("Raw response:", JSON.stringify(data, null, 2));

    // Extract searchId from response (matching the fixed code)
    const searchId = data.item?._id || data.searchId;
    const status = data.item?.status || data.status;

    if (data.validationErrors && data.validationErrors.length > 0) {
      console.log("\n❌ VALIDATION ERRORS:");
      data.validationErrors.forEach(err => {
        console.log(`   - ${err.humanReadableMessage || err.message}`);
      });
      return;
    }

    if (data.success && searchId) {
      console.log("\n✅ FIXED IMPLEMENTATION WORKS!");
      console.log(`   Search ID: ${searchId}`);
      console.log(`   Status: ${status}`);

      // Poll for results
      console.log("\n📊 Polling for results...");
      const result = await pollForResults(searchId);

      if (result) {
        console.log("\n🎉 SUCCESS - Email enrichment complete!");
        console.log(`   Status: ${result.status}`);
        console.log(`   Emails found: ${result.emails?.length || 0}`);
        if (result.emails && result.emails.length > 0) {
          result.emails.forEach((email, i) => {
            console.log(`   ${i + 1}. ${email.email} (${email.certainty})`);
          });
        }
      }
    } else {
      console.log("\n❌ Request failed");
      console.log("   Success:", data.success);
      console.log("   Message:", data.message || "Unknown error");
    }
  } catch (error) {
    console.error("\n❌ ERROR:", error.message);
  }
}

async function pollForResults(searchId, maxAttempts = 15) {
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
  return null;
}

// Run the test
testFixedImplementation().catch(console.error);
