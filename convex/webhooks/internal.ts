import { internalMutation } from "../_generated/server";

// Process webhook retries (called by cron job)
export const processRetries = internalMutation({
  args: {},
  handler: async (ctx) => {
    // This would handle webhook retry logic for failed webhooks
    // For now, just return a placeholder since we don't have a webhooks table
    console.log("Processing webhook retries...");
    return { processed: 0 };
  },
});