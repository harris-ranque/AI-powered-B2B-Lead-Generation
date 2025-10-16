import { action } from "../../_generated/server";
import { createEnrichmentService } from "./provider";

export const testCredits = action({
  args: {},
  handler: async () => {
    console.log("🧪 Testing ICypeas credits endpoint...");
    const service = createEnrichmentService();
    const credits = await service.getCredits();
    console.log("📊 Credits Result:", credits);
    return { provider: service.getProviderName(), credits };
  },
});
