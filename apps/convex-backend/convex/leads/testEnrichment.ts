// Test action for enrichment providers
import { action } from "../_generated/server";
import { v } from "convex/values";
import { runAllTests, testEnrichmentWithSampleDomain, testBatchEnrichment as runBatchEnrichmentTest } from "./enrichment/test";

/**
 * Test action to verify enrichment provider functionality
 * Can be called from Convex dashboard for testing
 */
export const testEnrichmentProviders = action({
  args: {},
  handler: async (ctx, args) => {
    try {
      console.log("🧪 Starting enrichment provider tests...");

      const results = await runAllTests();

      console.log("✅ Tests completed successfully");
      return {
        success: true,
        results,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error("❌ Test execution failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      };
    }
  },
});

/**
 * Test single domain enrichment
 */
export const testSingleEnrichment = action({
  args: {
    domain: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const domain = args.domain || "icypeas.com";
      console.log(`🧪 Testing single enrichment for: ${domain}`);

      const result = await testEnrichmentWithSampleDomain(domain);

      return {
        success: true,
        result,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error("❌ Single enrichment test failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      };
    }
  },
});

/**
 * Test batch enrichment
 */
export const testBatchEnrichment = action({
  args: {
    domains: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    try {
      const domains = args.domains || ["icypeas.com", "anthropic.com"];
      console.log(`🧪 Testing batch enrichment for: ${domains.join(", ")}`);

      const result = await runBatchEnrichmentTest(domains);

      return {
        success: true,
        result,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error("❌ Batch enrichment test failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      };
    }
  },
});