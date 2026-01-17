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
// ENRICHMENT QUEUE PROCESSOR (Every 3 seconds)
// ============================================================================
// OCC-safe single-consumer cron for processing queued leads
// - Eliminates OCC failures from trigger-on-release pattern
// - Uses cron lock to prevent overlapping executions
// - Processes leads FIFO by search within each API key (tenant isolation)
// - Maximum 25 leads processed per tick to keep execution time low
//
// COST/SPEED TRADEOFF: 3 seconds balances responsiveness vs Convex billing.
// - 3s = 28,800 calls/day (vs 43,200 at 2s, 17,280 at 5s)
// - 500 leads: ~7.5 min (vs ~6.7 min at 2s, ~8.3 min at 5s)
// - Each call when idle: ~3-5 database ops (lock acquire, query, lock release)
crons.interval(
  "process-enrichment-queue",
  { seconds: 3 },
  internal.leads.enrichmentQueueProcessor.processEnrichmentQueue,
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
