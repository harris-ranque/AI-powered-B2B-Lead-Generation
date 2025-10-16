// Test utilities for enrichment providers
import { EnrichmentProviderFactory, createEnrichmentService } from "./provider";
import { IcyPeasProvider } from "./icypeas";
import { FindyMailProvider } from "./findymail";

/**
 * Test enrichment provider functionality
 * This can be called from a Convex action for testing
 */
export async function testEnrichmentProviders() {
  const results = {
    configuredProvider: "",
    findyMailTest: { success: false, error: "" },
    icyPeasTest: { success: false, error: "" },
    providerFactoryTest: { success: false, error: "" },
  };

  try {
    // Test 1: Check configured provider
    results.configuredProvider = EnrichmentProviderFactory.getConfiguredProvider();
    console.log(`Configured provider: ${results.configuredProvider}`);

    // Test 2: Test FindyMail provider (if API key available)
    const findyMailKey = process.env.FINDYMAIL_API_KEY;
    if (findyMailKey) {
      try {
        const findyMailProvider = new FindyMailProvider(findyMailKey);
        const isValid = await findyMailProvider.validateApiKey(findyMailKey);
        results.findyMailTest.success = isValid;
        if (!isValid) {
          results.findyMailTest.error = "API key validation failed";
        }
      } catch (error) {
        results.findyMailTest.error = error instanceof Error ? error.message : "Unknown error";
      }
    } else {
      results.findyMailTest.error = "No API key configured";
    }

    // Test 3: Test IcyPeas provider (if API key available)
    const icyPeasKey = process.env.ICYPEAS_API_KEY;
    if (icyPeasKey) {
      try {
        const icyPeasProvider = new IcyPeasProvider(icyPeasKey);
        const isValid = await icyPeasProvider.validateApiKey(icyPeasKey);
        results.icyPeasTest.success = isValid;
        if (!isValid) {
          results.icyPeasTest.error = "API key validation failed";
        }
      } catch (error) {
        results.icyPeasTest.error = error instanceof Error ? error.message : "Unknown error";
      }
    } else {
      results.icyPeasTest.error = "No API key configured";
    }

    // Test 4: Test provider factory
    try {
      const service = createEnrichmentService();
      const providerName = service.getProviderName();
      results.providerFactoryTest.success = true;
      console.log(`Successfully created enrichment service using: ${providerName}`);
    } catch (error) {
      results.providerFactoryTest.error = error instanceof Error ? error.message : "Unknown error";
    }

    return results;
  } catch (error) {
    console.error("Test execution failed:", error);
    return {
      ...results,
      globalError: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Test enrichment with a sample domain
 */
export async function testEnrichmentWithSampleDomain(domain: string = "icypeas.com") {
  const results = {
    provider: "",
    domain,
    success: false,
    enrichmentResult: null as any,
    error: "",
    timing: 0,
  };

  try {
    const startTime = Date.now();

    // Create enrichment service
    const service = createEnrichmentService();
    results.provider = service.getProviderName();

    console.log(`Testing enrichment for ${domain} using ${results.provider}`);

    // Test single domain enrichment
    const enrichmentResult = await service.enrichSingle(domain);

    results.timing = Date.now() - startTime;
    results.success = enrichmentResult !== null;
    results.enrichmentResult = enrichmentResult;

    if (enrichmentResult) {
      console.log(`✅ Enrichment successful! Found ${enrichmentResult.emails?.length || 0} emails`);
    } else {
      console.log(`❌ Enrichment returned no results for ${domain}`);
    }

    return results;
  } catch (error) {
    results.error = error instanceof Error ? error.message : "Unknown error";
    console.error(`❌ Enrichment test failed:`, error);
    return results;
  }
}

/**
 * Test batch enrichment with multiple domains
 */
export async function testBatchEnrichment(domains: string[] = ["icypeas.com", "example.com"]) {
  const results = {
    provider: "",
    domains,
    success: false,
    batchResult: null as any,
    error: "",
    timing: 0,
    successCount: 0,
  };

  try {
    const startTime = Date.now();

    // Create enrichment service
    const service = createEnrichmentService();
    results.provider = service.getProviderName();

    console.log(`Testing batch enrichment for ${domains.length} domains using ${results.provider}`);

    // Test batch enrichment
    const batchResult = await service.enrichBatch(domains);

    results.timing = Date.now() - startTime;
    results.batchResult = batchResult;

    // Count successful enrichments
    results.successCount = Object.values(batchResult).filter(result => result !== null).length;
    results.success = results.successCount > 0;

    console.log(`✅ Batch enrichment completed! ${results.successCount}/${domains.length} domains enriched`);

    return results;
  } catch (error) {
    results.error = error instanceof Error ? error.message : "Unknown error";
    console.error(`❌ Batch enrichment test failed:`, error);
    return results;
  }
}

/**
 * Run all tests
 */
export async function runAllTests() {
  console.log("🧪 Starting enrichment provider tests...\n");

  const results = {
    providerTests: await testEnrichmentProviders(),
    singleEnrichmentTest: await testEnrichmentWithSampleDomain("icypeas.com"),
    batchEnrichmentTest: await testBatchEnrichment(["icypeas.com", "anthropic.com"]),
  };

  console.log("\n📊 Test Results Summary:");
  console.log("Provider tests:", results.providerTests);
  console.log("Single enrichment:", results.singleEnrichmentTest);
  console.log("Batch enrichment:", results.batchEnrichmentTest);

  return results;
}