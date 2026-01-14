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

// ============================================================================
// FINDYMAIL API HEALTH CHECK (Every 30 minutes)
// ============================================================================
// Proactively check FindyMail API health and alert on issues
// Checks: authentication, credits, rate limits, API availability
crons.interval(
  "findymail-health-check",
  { minutes: 30 },
  (internal as any)["leads/enrichment/healthCheck"].checkFindyMailHealth,
);

// ============================================================================
// STUCK ENRICHMENT DETECTION (Every 5 minutes)
// ============================================================================
// Detects and recovers leads stuck in "in_progress" state
// - Leads stuck > 10 minutes are reset to pending for retry
// - Leads stuck > 30 minutes are marked as failed
crons.interval(
  "monitor-stuck-enrichments",
  { minutes: 5 },
  (internal as any)["leads/enrichmentMonitoring"].monitorStuckEnrichments,
);

// ============================================================================
// DEAD LETTER QUEUE PROCESSOR (Every 2 minutes)
// ============================================================================
// Processes failed pipeline operations (completion handlers, phase transitions)
// - Retries failed operations with exponential backoff
// - Marks exhausted operations after 5 attempts
crons.interval(
  "process-dead-letter-queue",
  { minutes: 2 },
  (internal as any)["leads/deadLetterProcessor"].processDeadLetterQueue,
);

// ============================================================================
// DLQ CLEANUP (Daily)
// ============================================================================
// Cleans up old resolved operations from the dead letter queue
// Keeps last 7 days of resolved operations for auditing
crons.interval(
  "cleanup-resolved-dlq-operations",
  { hours: 24 },
  internal.leads.deadLetterQueue.cleanupResolvedOperations,
);

export default crons;
