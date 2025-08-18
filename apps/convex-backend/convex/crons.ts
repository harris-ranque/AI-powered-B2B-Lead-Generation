import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Process pending searches every minute
crons.interval(
  "process-pending-searches",
  { minutes: 1 },
  internal.search.internal.processPendingSearches
);

// Check for stale in-progress searches every 10 minutes
crons.interval(
  "check-stale-searches",
  { minutes: 10 },
  internal.search.internal.checkStaleSearches
);

// Process lead enrichment queue every 2 minutes
crons.interval(
  "process-lead-enrichment",
  { minutes: 2 },
  internal.leads.enrichment.processEnrichmentQueue
);

// High-frequency queue processing for real-time responsiveness (every 30 seconds)
crons.interval(
  "process-priority-queues",
  { seconds: 30 },
  internal.search.orchestrator.processPriorityQueues
);

// Process AI analysis queue every 3 minutes
crons.interval(
  "process-ai-analysis",
  { minutes: 3 },
  internal.langgraph.internal.processAnalysisQueue
);

// Send scheduled notifications every 5 minutes
crons.interval(
  "send-notifications",
  { minutes: 5 },
  internal.notifications.internal.sendPendingNotifications
);

// Calculate daily metrics at 1 AM UTC
crons.cron(
  "calculate-daily-metrics",
  "0 1 * * *", // 1 AM UTC daily
  internal.admin.metrics.calculateDailyMetrics
);

// Refresh monthly credits on the 1st of each month at 2 AM UTC
crons.cron(
  "refresh-monthly-credits",
  "0 2 1 * *", // 2 AM UTC on 1st of each month
  internal.billing.credits.refreshMonthlyCredits
);

// Clean up old data every Sunday at 3 AM UTC
crons.cron(
  "cleanup-old-data",
  "0 3 * * 0", // 3 AM UTC every Sunday
  internal.admin.cleanup.cleanupOldData
);

// Check for failed payments every 6 hours
crons.interval(
  "check-failed-payments",
  { hours: 6 },
  internal.billing.internal.checkFailedPayments
);

// Update search analytics every hour
crons.interval(
  "update-search-analytics",
  { hours: 1 },
  internal.search.internal.updateSearchAnalytics
);

// Monitor system health every 15 minutes
crons.interval(
  "system-health-check",
  { minutes: 15 },
  internal.admin.monitoring.systemHealthCheck
);

// Send weekly summary emails on Mondays at 9 AM UTC
crons.cron(
  "send-weekly-summaries",
  "0 9 * * 1", // 9 AM UTC every Monday
  internal.notifications.internal.sendWeeklySummaries
);

// Process webhook retries every 30 minutes
crons.interval(
  "process-webhook-retries",
  { minutes: 30 },
  internal.webhooks.internal.processRetries
);

// Process system-level operation retries every 5 minutes
crons.interval(
  "process-operation-retries",
  { minutes: 5 },
  internal.retries.internal.processPendingRetries
);

// Cleanup old retry records weekly
crons.cron(
  "cleanup-retry-records",
  "0 4 * * 0", // 4 AM UTC every Sunday
  internal.retries.internal.cleanupOldRetries
);

// Cleanup expired credit reservations every hour
crons.interval(
  "cleanup-expired-reservations",
  { hours: 1 },
  internal.credits.transactions.cleanupExpiredReservations
);

// Cleanup old rate limit records daily
crons.interval(
  "cleanup-rate-limit-records",
  { hours: 24 },
  internal.rateLimit.internal.cleanupOldRecords
);

// Adjust adaptive rate limits every 6 hours
crons.interval(
  "adjust-adaptive-limits",
  { hours: 6 },
  internal.rateLimit.adaptive.processAdaptiveLimits
);

// Process batch queues every 2 minutes
crons.interval(
  "process-batch-queues",
  { minutes: 2 },
  internal.search.batchQueue.processBatchQueues
);

// High-priority batch processing every 30 seconds
crons.interval(
  "process-priority-batches",
  { seconds: 30 },
  internal.search.batchQueue.processPriorityBatches
);

// Cleanup completed batches weekly
crons.cron(
  "cleanup-completed-batches",
  "0 5 * * 0", // 5 AM UTC every Sunday
  internal.search.batchQueue.cleanupCompletedBatches
);

// Process pending broadcasts every minute
crons.interval(
  "process-pending-broadcasts",
  { minutes: 1 },
  internal.realtime.broadcaster.processPendingBroadcasts
);

// Cleanup expired broadcasts every 6 hours
crons.interval(
  "cleanup-expired-broadcasts",
  { hours: 6 },
  internal.realtime.broadcaster.cleanupExpiredBroadcasts
);

// Cleanup old correlation logs daily
crons.interval(
  "cleanup-correlation-logs",
  { hours: 24 },
  internal.lib.logging.cleanupOldLogs
);

export default crons;