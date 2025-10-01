import { action } from "../../_generated/server";
import { testEnrichmentProviders } from "./test";

// Test action to validate enrichment provider configuration
export const testProviders = action({
  args: {},
  handler: async () => {
    console.log("🧪 Testing enrichment provider configuration...");
    const results = await testEnrichmentProviders();
    console.log("📊 Test Results:", JSON.stringify(results, null, 2));
    return results;
  },
});
