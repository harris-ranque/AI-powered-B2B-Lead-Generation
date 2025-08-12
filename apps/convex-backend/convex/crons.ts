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

// Process AI analysis queue every 3 minutes
crons.interval(
  "process-ai-analysis",
  { minutes: 3 },
  internal.crewai.internal.processAnalysisQueue
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

export default crons;