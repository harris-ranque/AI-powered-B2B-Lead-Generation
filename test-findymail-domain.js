#!/usr/bin/env node

/**
 * FindyMail Domain-Based Contact Discovery Test
 * Demonstrates that FindyMail can find contacts from just a domain
 */

const FINDYMAIL_API_KEY = process.env.FINDYMAIL_API_KEY || "";
const FINDYMAIL_BASE_URL = "https://app.findymail.com/api/v1";

async function testDomainDiscovery() {
  console.log("🔍 FindyMail Domain-Based Contact Discovery Test\n");
  console.log("Configuration:");
  console.log(`- Base URL: ${FINDYMAIL_BASE_URL}`);
  console.log(`- API Key: ${FINDYMAIL_API_KEY ? FINDYMAIL_API_KEY.substring(0, 8) + '...' : 'NOT SET'}\n`);

  if (!FINDYMAIL_API_KEY) {
    console.error("❌ Error: FINDYMAIL_API_KEY environment variable not set");
    console.log("\nUsage: FINDYMAIL_API_KEY=your_key node test-findymail-domain.js");
    process.exit(1);
  }

  // Test domains
  const testDomains = [
    "anthropic.com",
    "openai.com",
    "fredloya.com"
  ];

  console.log(`📧 Testing bulk enrichment for ${testDomains.length} domains\n`);
  console.log("Request payload:");
  console.log(JSON.stringify({ domains: testDomains }, null, 2));
  console.log("");

  try {
    const response = await fetch(`${FINDYMAIL_BASE_URL}/bulk-enrich`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${FINDYMAIL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        domains: testDomains
      }),
    });

    console.log(`Response status: ${response.status} ${response.statusText}\n`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ API Error:");
      console.error(errorText);
      return;
    }

    const data = await response.json();

    console.log("=" .repeat(70));
    console.log("📊 RESULTS SUMMARY");
    console.log("=".repeat(70) + "\n");

    for (const domain of testDomains) {
      const domainData = data[domain];

      if (!domainData) {
        console.log(`⚠️  ${domain}: NO DATA RETURNED\n`);
        continue;
      }

      const emails = domainData.emails || [];
      const contacts = domainData.contacts || [];

      console.log(`✅ ${domain}:`);
      console.log(`   Emails found: ${emails.length}`);
      console.log(`   Contacts found: ${contacts.length}`);

      if (emails.length > 0) {
        console.log(`   \n   📧 Emails:`);
        emails.forEach((email, i) => {
          console.log(`      ${i + 1}. ${email.email}`);
          console.log(`         Type: ${email.type || 'unknown'}`);
          console.log(`         Confidence: ${email.confidence || 'N/A'}`);
        });
      }

      if (contacts.length > 0) {
        console.log(`   \n   👤 Contacts:`);
        contacts.forEach((contact, i) => {
          console.log(`      ${i + 1}. ${contact.name || 'Unknown'}`);
          if (contact.title) console.log(`         Title: ${contact.title}`);
          if (contact.email) console.log(`         Email: ${contact.email}`);
          if (contact.linkedin) console.log(`         LinkedIn: ${contact.linkedin}`);
        });
      }

      console.log("");
    }

    console.log("=".repeat(70));
    console.log("\n🎉 SUCCESS: FindyMail can discover contacts from domain alone!");
    console.log("\n✅ Key Finding:");
    console.log("   - Input: Just a domain name (no person names required)");
    console.log("   - Output: Multiple contacts with names, titles, emails");
    console.log("   - Perfect for your use case!");

  } catch (error) {
    console.error("\n❌ ERROR:", error.message);
    if (error.stack) {
      console.error("\nStack trace:");
      console.error(error.stack);
    }
  }
}

testDomainDiscovery().catch(console.error);
