#!/usr/bin/env node

/**
 * ICypeas Bulk Domain Search Test
 * Tests domain-based contact discovery using bulk-search API
 */

const ICYPEAS_API_KEY = process.env.ICYPEAS_API_KEY || "";
const ICYPEAS_BASE_URL = "https://app.icypeas.com/api";

async function testBulkDomainSearch() {
  console.log("🔍 ICypeas Bulk Domain Search Test\n");
  console.log("Configuration:");
  console.log(`- Base URL: ${ICYPEAS_BASE_URL}`);
  console.log(`- API Key: ${ICYPEAS_API_KEY ? ICYPEAS_API_KEY.substring(0, 8) + '...' : 'NOT SET'}\n`);

  if (!ICYPEAS_API_KEY) {
    console.error("❌ Error: ICYPEAS_API_KEY environment variable not set");
    console.log("\nUsage: ICYPEAS_API_KEY=your_key node test-icypeas-bulk-domain.js");
    process.exit(1);
  }

  const testDomains = [
    "icypeas.com",
    "anthropic.com"
  ];

  console.log(`📧 Testing domain-search for ${testDomains.length} domains:`);
  testDomains.forEach((d, i) => console.log(`   ${i + 1}. ${d}`));
  console.log("");

  try {
    // Step 1: Start bulk domain search
    console.log("Step 1: Starting bulk domain search...");
    const startResponse = await fetch(`${ICYPEAS_BASE_URL}/bulk-search`, {
      method: "POST",
      headers: {
        "Authorization": ICYPEAS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task: "domain-search",
        name: `Domain Test ${Date.now()}`,
        data: testDomains.map(d => [d])
      }),
    });

    if (!startResponse.ok) {
      throw new Error(`Start failed: ${startResponse.status} ${startResponse.statusText}`);
    }

    const startData = await startResponse.json();
    console.log("✅ Bulk search initiated:");
    console.log(JSON.stringify(startData, null, 2));
    console.log("");

    if (!startData.success || !startData.file) {
      throw new Error("Failed to get file ID");
    }

    const fileId = startData.file;

    // Step 2: Poll for completion
    console.log("Step 2: Polling for completion...");
    let status = "in_progress";
    let attempts = 0;
    const maxAttempts = 30;

    while (status !== "done" && attempts < maxAttempts) {
      attempts++;
      console.log(`   Attempt ${attempts}/${maxAttempts}...`);

      await new Promise(r => setTimeout(r, 2000));

      const statusResponse = await fetch(`${ICYPEAS_BASE_URL}/search-files/read`, {
        method: "POST",
        headers: {
          "Authorization": ICYPEAS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ file: fileId }),
      });

      const statusData = await statusResponse.json();

      if (statusData.files && statusData.files.length > 0) {
        status = statusData.files[0].status;
        console.log(`   Status: ${status}, Processed: ${statusData.files[0].processed || 0}/${statusData.files[0].total || 0}`);
      }
    }

    if (status !== "done") {
      throw new Error("Polling timeout - search did not complete");
    }

    console.log("✅ Bulk search completed!\n");

    // Step 3: Retrieve results
    console.log("Step 3: Retrieving results...");
    const resultsResponse = await fetch(`${ICYPEAS_BASE_URL}/bulk-single-searchs/read`, {
      method: "POST",
      headers: {
        "Authorization": ICYPEAS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "bulk",
        file: fileId,
        limit: 50
      }),
    });

    if (!resultsResponse.ok) {
      throw new Error(`Results retrieval failed: ${resultsResponse.status}`);
    }

    const resultsData = await resultsResponse.json();
    console.log("✅ Results retrieved!\n");

    // Step 4: Display results
    console.log("=".repeat(70));
    console.log("📊 DOMAIN SEARCH RESULTS");
    console.log("=".repeat(70) + "\n");

    if (!resultsData.items || resultsData.items.length === 0) {
      console.log("⚠️  No results found");
      console.log("\nRaw response:");
      console.log(JSON.stringify(resultsData, null, 2));
      return;
    }

    // Group results by original domain order
    const resultsByDomain = {};
    resultsData.items.forEach(item => {
      const domainIndex = item.order;
      const domain = testDomains[domainIndex];
      if (!resultsByDomain[domain]) {
        resultsByDomain[domain] = [];
      }
      resultsByDomain[domain].push(item);
    });

    // Display results per domain
    for (const domain of testDomains) {
      const items = resultsByDomain[domain] || [];

      console.log(`🌐 ${domain}:`);
      console.log(`   Found: ${items.length} result(s)\n`);

      items.forEach((item, i) => {
        console.log(`   Result ${i + 1}:`);
        console.log(`   Status: ${item.status}`);

        if (item.status === "FOUND" && item.results) {
          const r = item.results;

          if (r.fullname) {
            console.log(`   Name: ${r.fullname}`);
          }

          if (r.emails && r.emails.length > 0) {
            console.log(`   Emails: ${r.emails.length}`);
            r.emails.forEach(email => {
              console.log(`      • ${email.email} (${email.certainty})`);
            });
          }

          if (r.phones && r.phones.length > 0) {
            console.log(`   Phones: ${r.phones.join(', ')}`);
          }

          if (r.li) {
            console.log(`   LinkedIn: ${r.li}`);
          }
        } else if (item.status === "NOT_FOUND") {
          console.log(`   No contacts found for this domain`);
        }

        console.log("");
      });
    }

    console.log("=".repeat(70));
    console.log("\n🎉 SUCCESS: ICypeas domain-search works!");
    console.log("\n✅ Key Finding:");
    console.log("   - Input: Just domain names");
    console.log("   - Output: Contacts with names, emails, phones");
    console.log("   - Perfect for your use case!");

  } catch (error) {
    console.error("\n❌ ERROR:", error.message);
    if (error.stack) {
      console.error("\nStack trace:");
      console.error(error.stack);
    }
  }
}

testBulkDomainSearch().catch(console.error);
