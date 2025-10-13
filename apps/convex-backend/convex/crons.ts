import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// ============================================================================
// ASYNC LEAD ANALYSIS MONITORING (Every 5 minutes)
// ============================================================================
// Monitor stuck/timeout leads and trigger completion checks
crons.interval(
  "monitor-stuck-lead-analysis",
  { minutes: 5 }, // Run every 5 minutes
  (internal as any)["leads/monitoring"].monitorStuckLeads,
);

// ============================================================================
// SCHEDULED ACTIONS HEALTH CHECK (Every 15 minutes)
// ============================================================================
// Verify scheduled actions are executing properly
crons.interval(
  "check-scheduled-actions-health",
  { minutes: 15 }, // Run every 15 minutes
  (internal as any)["leads/monitoring"].checkScheduledActionsHealth,
);

// ============================================================================
// SEARCH COMPLETION CHECKING (Every 3 minutes)
// ============================================================================
// Check if any searches with all leads processed need completion
crons.interval(
  "check-search-completion",
  { minutes: 3 },
  (internal as any)["search/monitoring"].checkPendingCompletions,
);

export default crons;
