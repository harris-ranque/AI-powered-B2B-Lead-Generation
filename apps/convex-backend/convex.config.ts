import { defineApp } from "convex/server";
import workpool from "@convex-dev/workpool/convex.config";

const app = defineApp();

// Enrichment workpool for lead enrichment with FindyMail/IcyPeas
// High parallelism (25) to support multiple users with their own API keys
// Per-API-key concurrency limiting (5 concurrent per key) handled by semaphore system
app.use(workpool, {
  name: "enrichmentPool",
});

export default app;
