import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// ============================================================================
// LEAD HEALTH MONITORING (Every 5 minutes)
// ============================================================================
// Combined monitoring for all lead-related health checks:
// - Stuck lead analysis detection and recovery
// - Stuck enrichment detection and recovery
// - Scheduled actions health verification
crons.interval(
  "monitor-lead-health",
  { minutes: 5 },
  (internal as any)["leads/monitoring"].monitorLeadHealth,
);

// ============================================================================
// SEARCH HEALTH MONITORING (Every 5 minutes)
// ============================================================================
// Combined monitoring for all search-related health checks:
// - Pending search completion checks
// - Stuck search recovery
// Respects checkpoint pauses (won't interfere with user-action-required states)
crons.interval(
  "monitor-search-health",
  { minutes: 5 },
  (internal as any)["search/monitoring"].monitorSearchHealth,
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
