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

// ============================================================================
// STUCK SEARCH RECOVERY (Every 10 minutes)
// ============================================================================
// Detect and recover searches stuck in processing phases beyond timeout
crons.interval(
  "recover-stuck-searches",
  { minutes: 10 },
  (internal as any)["search/monitoring"].recoverStuckSearches,
);

// ============================================================================
// API KEY SEMAPHORE SLOT CLEANUP (Every 5 minutes)
// ============================================================================
// Clean up expired slots from the distributed semaphore system
// Slots auto-expire after 10 minutes, this cron ensures cleanup of stuck slots
crons.interval(
  "cleanup-expired-semaphore-slots",
  { minutes: 5 },
  internal.apiKeySemaphore.semaphore.cleanupExpiredSlots,
);

export default crons;
