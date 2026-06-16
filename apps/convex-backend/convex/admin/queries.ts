import { query, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { requireAdmin } from "../auth";

// Constants for query limits to prevent memory issues
// Lead documents are 5-20KB each (AI analysis, email content, enrichment data)
// Convex enforces 16MB per function execution, so we need conservative limits
const MAX_ITERATION_COUNT = 10000; // Safety limit for matching results
const MAX_DOCS_SCAN = 5000; // Safety limit for total documents scanned regardless of filter match
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

// Diagnostic query - run from dashboard without auth to check search/enrichment state
export const diagnoseSearch = internalQuery({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      return { error: "Search not found" };
    }

    // Get all leads
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    // Get enrichment batch
    const batches = await ctx.db
      .query("enrichmentBatches")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    // Get slot queue entries for this search
    const queueEntries = await ctx.db
      .query("enrichmentSlotQueue")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    // Get all semaphore slots (to check for leaks)
    const allSlots = await ctx.db
      .query("enrichmentApiKeySlots")
      .collect();

    // Compute stats
    const enrichmentStats = {
      pending: leads.filter((l) => l.enrichmentStatus === "pending").length,
      in_progress: leads.filter((l) => l.enrichmentStatus === "in_progress").length,
      completed: leads.filter((l) => l.enrichmentStatus === "completed").length,
      completed_fallback: leads.filter((l) => l.enrichmentStatus === "completed_fallback").length,
      failed: leads.filter((l) => l.enrichmentStatus === "failed").length,
      no_contacts_found: leads.filter((l) => l.enrichmentStatus === "no_contacts_found").length,
    };

    const analysisStats = {
      none: leads.filter((l) => !l.analysisStatus).length,
      pending: leads.filter((l) => l.analysisStatus === "pending").length,
      scheduled: leads.filter((l) => l.analysisStatus === "scheduled").length,
      processing: leads.filter((l) => l.analysisStatus === "processing").length,
      completed: leads.filter((l) => l.analysisStatus === "completed").length,
      failed: leads.filter((l) => l.analysisStatus === "failed").length,
      skipped: leads.filter((l) => l.analysisStatus === "skipped").length,
    };

    const slotStats = {
      totalSlotRecords: allSlots.length,
      claimed: allSlots.filter((s) => s.claimedBy).length,
      available: allSlots.filter((s) => !s.claimedBy).length,
      byApiKey: Object.entries(
        allSlots.reduce((acc, slot) => {
          const key = slot.apiKeyHash.substring(0, 8);
          if (!acc[key]) acc[key] = { claimed: 0, available: 0 };
          if (slot.claimedBy) acc[key]!.claimed++;
          else acc[key]!.available++;
          return acc;
        }, {} as Record<string, { claimed: number; available: number }>)
      ),
    };

    const prospects = await ctx.db
      .query("leadProspects")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    const prospectStats = {
      total: prospects.length,
      discovered: prospects.filter((p) => p.status === "discovered").length,
      email_pending: prospects.filter((p) => p.status === "email_pending").length,
      email_found: prospects.filter((p) => p.status === "email_found").length,
      email_not_found: prospects.filter((p) => p.status === "email_not_found").length,
      rejected: prospects.filter((p) => p.status === "rejected").length,
    };

    return {
      search: {
        id: search._id,
        name: search.name,
        status: search.status,
        researchStage: search.researchStage,
        createdAt: new Date(search.createdAt).toISOString(),
      },
      leads: {
        total: leads.length,
        enrichmentStats,
        analysisStats,
      },
      prospects: prospectStats,
      batches: batches.map((b) => ({
        batchId: b.batchId,
        status: b.status,
        totalLeads: b.totalLeads,
        completedLeads: b.completedLeads,
        successfulLeads: b.successfulLeads,
        failedLeads: b.failedLeads,
      })),
      slotQueue: {
        total: queueEntries.length,
        pending: queueEntries.filter((q) => q.status === "pending").length,
        processing: queueEntries.filter((q) => q.status === "processing").length,
      },
      semaphoreSlots: slotStats,
    };
  },
});

/**
 * Get admin metrics - OPTIMIZED VERSION
 * Uses single query per table and computes all metrics in-memory
 * Falls back to pre-computed adminMetrics table when available
 */
export const getAdminMetrics = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    // Try to get today's pre-computed metrics first
    const today: string = new Date().toISOString().split("T")[0] || "";
    const cachedMetrics = await ctx.db
      .query("adminMetrics")
      .withIndex("by_date", (q) => q.eq("date", today))
      .unique();

    // If we have cached metrics, use totals from cache and only compute recent breakdowns
    const cachedTotals = cachedMetrics?.metrics;

    // Get user stats - users table is typically small, safe to scan with limit
    let totalUsers = 0;
    let activeUsers = 0;
    let newUsers7d = 0;
    let newUsers30d = 0;
    const planDistribution: Record<string, number> = {};

    for await (const user of ctx.db.query("users")) {
      totalUsers++;
      if (user.isActive) activeUsers++;
      if (user.createdAt >= sevenDaysAgo) newUsers7d++;
      if (user.createdAt >= thirtyDaysAgo) newUsers30d++;
      planDistribution[user.plan] = (planDistribution[user.plan] || 0) + 1;
      if (totalUsers >= MAX_DOCS_SCAN) break;
    }

    // Get search stats - use by_created index for time-range, scan with safety limit
    let totalSearches = cachedTotals?.totalSearches ?? 0;
    let completedSearches = 0;
    let searches7d = 0;
    let searches30d = 0;
    let docsScanned = 0;

    if (cachedTotals) {
      // Only compute recent growth stats using indexed time-range query
      for await (const search of ctx.db
        .query("searches")
        .withIndex("by_created", (q) => q.gte("createdAt", thirtyDaysAgo))) {
        searches30d++;
        if (search.status === "completed") completedSearches++;
        if (search.createdAt >= sevenDaysAgo) searches7d++;
        if (searches30d >= MAX_ITERATION_COUNT) break;
      }
    } else {
      // No cache - scan with safety limit
      for await (const search of ctx.db.query("searches")) {
        totalSearches++;
        docsScanned++;
        if (search.status === "completed") completedSearches++;
        if (search.createdAt >= sevenDaysAgo) searches7d++;
        if (search.createdAt >= thirtyDaysAgo) searches30d++;
        if (docsScanned >= MAX_DOCS_SCAN) break;
      }
    }

    // Get credit usage - use compound index for time-range queries
    let totalCreditsSpent = cachedTotals?.totalCreditsUsed ?? 0;
    let creditsSpent7d = 0;
    let creditsSpent30d = 0;
    docsScanned = 0;

    if (cachedTotals) {
      // Only compute recent spending using indexed time-range query
      for await (const tx of ctx.db
        .query("creditTransactions")
        .withIndex("by_type_created", (q) =>
          q.eq("type", "usage").gte("createdAt", thirtyDaysAgo))) {
        creditsSpent30d += tx.amount;
        if (tx.createdAt >= sevenDaysAgo) creditsSpent7d += tx.amount;
        docsScanned++;
        if (docsScanned >= MAX_DOCS_SCAN) break;
      }
    } else {
      // No cache - scan all usage transactions with safety limit
      for await (const tx of ctx.db
        .query("creditTransactions")
        .withIndex("by_type", (q) => q.eq("type", "usage"))) {
        totalCreditsSpent += tx.amount;
        if (tx.createdAt >= sevenDaysAgo) creditsSpent7d += tx.amount;
        if (tx.createdAt >= thirtyDaysAgo) creditsSpent30d += tx.amount;
        docsScanned++;
        if (docsScanned >= MAX_DOCS_SCAN) break;
      }
    }

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        new7d: newUsers7d,
        new30d: newUsers30d,
        planDistribution,
      },
      searches: {
        total: totalSearches,
        completed: completedSearches,
        completionRate:
          totalSearches > 0 ? (completedSearches / totalSearches) * 100 : 0,
        new7d: searches7d,
        new30d: searches30d,
      },
      credits: {
        totalSpent: totalCreditsSpent,
        spent7d: creditsSpent7d,
        spent30d: creditsSpent30d,
        avgPerUser:
          totalUsers > 0 ? Math.round(totalCreditsSpent / totalUsers) : 0,
      },
      growth: {
        userGrowth7d: newUsers7d,
        userGrowth30d: newUsers30d,
        searchGrowth7d: searches7d,
        searchGrowth30d: searches30d,
      },
      cachedAt: cachedMetrics?.createdAt,
    };
  },
});

// Get recent system activity - already optimized with .take()
export const getRecentActivity = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const limit = Math.min(args.limit || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

    // Get recent searches
    const recentSearches = await ctx.db
      .query("searches")
      .order("desc")
      .take(limit);

    // Get recent user registrations
    const recentUsers = await ctx.db.query("users").order("desc").take(limit);

    // Get recent credit transactions
    const recentTransactions = await ctx.db
      .query("creditTransactions")
      .order("desc")
      .take(limit);

    return {
      searches: recentSearches,
      users: recentUsers,
      transactions: recentTransactions,
    };
  },
});

/**
 * Get system health metrics - OPTIMIZED VERSION
 * Uses indexes for status filtering
 */
export const getSystemHealth = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    // Check for recent failures using index
    const failedSearches = await ctx.db
      .query("searches")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .filter((q) => q.gte(q.field("createdAt"), oneHourAgo))
      .take(100); // Limit results

    const failedLangGraphRequests = await ctx.db
      .query("langgraphRequests")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .filter((q) => q.gte(q.field("createdAt"), oneHourAgo))
      .take(100);

    // Check processing queue health using index
    const processingSearches = await ctx.db
      .query("searches")
      .withIndex("by_status", (q) => q.eq("status", "processing"))
      .take(100);

    const stuckSearches = processingSearches.filter(
      (search) =>
        now - (search.lastOrchestrationAt || search.createdAt) > 30 * 60 * 1000,
    );

    return {
      status: stuckSearches.length > 0 ? "degraded" : "healthy",
      failures: {
        searches: failedSearches.length,
        langGraphRequests: failedLangGraphRequests.length,
      },
      processing: {
        activeSearches: processingSearches.length,
        stuckSearches: stuckSearches.length,
      },
      timestamp: now,
    };
  },
});

/**
 * Get all users for admin dashboard - OPTIMIZED VERSION
 * Uses indexes for filtering and proper pagination
 */
export const getAllUsers = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    plan: v.optional(
      v.union(
        v.literal("starter"),
        v.literal("professional"),
        v.literal("business"),
        v.literal("enterprise"),
      ),
    ),
    role: v.optional(v.union(v.literal("user"), v.literal("admin"))),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const limit = Math.min(args.limit || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const offset = args.offset || 0;

    // Build query with appropriate index
    let query;
    if (args.plan !== undefined) {
      query = ctx.db
        .query("users")
        .withIndex("by_plan", (q) => q.eq("plan", args.plan!));
    } else if (args.role !== undefined) {
      query = ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", args.role!));
    } else if (args.isActive !== undefined) {
      query = ctx.db
        .query("users")
        .withIndex("by_active", (q) => q.eq("isActive", args.isActive!));
    } else {
      query = ctx.db.query("users");
    }

    // Apply additional isActive filter if needed when using other indexes
    if (args.isActive !== undefined && args.plan !== undefined) {
      query = query.filter((q) => q.eq(q.field("isActive"), args.isActive));
    }
    if (args.isActive !== undefined && args.role !== undefined) {
      query = query.filter((q) => q.eq(q.field("isActive"), args.isActive));
    }

    // Get total count using streaming (more efficient than .collect())
    let total = 0;
    const users: typeof query extends AsyncIterable<infer T> ? T[] : never[] = [];
    let skipped = 0;

    for await (const user of query) {
      total++;
      if (skipped < offset) {
        skipped++;
        continue;
      }
      if (users.length < limit) {
        users.push(user as any);
      }
      // Safety limit - stop scanning once we have our page and counted enough
      if (users.length >= limit && total >= offset + limit + 1) break;
      if (total >= MAX_DOCS_SCAN) break;
    }

    return {
      users,
      total,
      hasMore: offset + limit < total,
    };
  },
});

/**
 * Get analytics data - OPTIMIZED VERSION
 * Uses indexes for efficient queries
 */
export const getAnalytics = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    // Count using streaming with indexes where possible
    let activeUsers = 0;
    for await (const _ of ctx.db
      .query("users")
      .withIndex("by_active", (q) => q.eq("isActive", true))) {
      activeUsers++;
      if (activeUsers >= MAX_ITERATION_COUNT) break;
    }

    // Use by_created index for time-based counts
    let userGrowth7d = 0;
    let userGrowth30d = 0;
    for await (const user of ctx.db
      .query("users")
      .withIndex("by_created", (q) => q.gte("createdAt", thirtyDaysAgo))) {
      userGrowth30d++;
      if (user.createdAt >= sevenDaysAgo) userGrowth7d++;
      if (userGrowth30d >= MAX_ITERATION_COUNT) break;
    }

    let searchGrowth7d = 0;
    let searchGrowth30d = 0;
    for await (const search of ctx.db
      .query("searches")
      .withIndex("by_created", (q) => q.gte("createdAt", thirtyDaysAgo))) {
      searchGrowth30d++;
      if (search.createdAt >= sevenDaysAgo) searchGrowth7d++;
      if (searchGrowth30d >= MAX_ITERATION_COUNT) break;
    }

    // Credit usage with compound index - only read last 30 days
    let creditUsage7d = 0;
    let creditUsage30d = 0;
    let creditDocsScanned = 0;
    for await (const tx of ctx.db
      .query("creditTransactions")
      .withIndex("by_type_created", (q) =>
        q.eq("type", "usage").gte("createdAt", thirtyDaysAgo))) {
      creditUsage30d += tx.amount;
      if (tx.createdAt >= sevenDaysAgo) {
        creditUsage7d += tx.amount;
      }
      creditDocsScanned++;
      if (creditDocsScanned >= MAX_DOCS_SCAN) break;
    }

    const averageSearchesPerActiveUser =
      activeUsers > 0
        ? Number((searchGrowth30d / activeUsers).toFixed(2))
        : 0;

    return {
      growth: {
        userGrowth7d,
        userGrowth30d,
        searchGrowth7d,
        searchGrowth30d,
        creditUsage7d,
        creditUsage30d,
      },
      engagement: {
        activeUsers,
        averageSearchesPerActiveUser,
      },
      // Legacy fields preserved for compatibility
      userGrowth: userGrowth30d,
      searchVolume: searchGrowth30d,
      revenueGrowth: creditUsage30d,
    };
  },
});

/**
 * Get revenue statistics - OPTIMIZED VERSION
 * Uses index for type filtering
 */
export const getRevenueStats = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    let totalRevenue = 0;
    let revenueThisMonth = 0;
    let revenueThisWeek = 0;
    let transactionCount = 0;

    // Use index for purchase transactions with docs-scanned safety limit
    for await (const tx of ctx.db
      .query("creditTransactions")
      .withIndex("by_type", (q) => q.eq("type", "purchase"))) {
      totalRevenue += tx.amount;
      transactionCount++;
      if (tx.createdAt > thirtyDaysAgo) {
        revenueThisMonth += tx.amount;
      }
      if (tx.createdAt > sevenDaysAgo) {
        revenueThisWeek += tx.amount;
      }
      if (transactionCount >= MAX_DOCS_SCAN) break;
    }

    return {
      totalRevenue,
      revenueThisMonth,
      revenueThisWeek,
      transactionCount,
    };
  },
});

/**
 * Get usage statistics - OPTIMIZED VERSION
 * Uses pre-computed adminMetrics when available, otherwise streams with limits
 */
export const getUsageStats = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    // Try to get today's pre-computed metrics first
    const today: string = new Date().toISOString().split("T")[0] || "";
    const cachedMetrics = await ctx.db
      .query("adminMetrics")
      .withIndex("by_date", (q) => q.eq("date", today))
      .unique();

    if (cachedMetrics) {
      return {
        totalSearches: cachedMetrics.metrics.totalSearches,
        totalLeads: cachedMetrics.metrics.totalLeads,
        totalCreditsSpent: cachedMetrics.metrics.totalCreditsUsed,
        averageLeadsPerSearch:
          cachedMetrics.metrics.totalSearches > 0
            ? cachedMetrics.metrics.totalLeads / cachedMetrics.metrics.totalSearches
            : 0,
        cachedAt: cachedMetrics.createdAt,
        note: "Using cached metrics from daily aggregation",
      };
    }

    // Fallback: derive lead counts from searches table (small docs) instead of
    // scanning leads table (5-20KB per doc) which hits the 16MB byte limit
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    let totalSearches = 0;
    let totalLeads = 0;
    let docsScanned = 0;
    for await (const search of ctx.db.query("searches")) {
      totalSearches++;
      totalLeads += search.results?.totalFound ?? search.progress?.discovered ?? 0;
      docsScanned++;
      if (docsScanned >= MAX_DOCS_SCAN) break;
    }

    // Credit usage with compound index + safety limit
    let totalCreditsSpent = 0;
    docsScanned = 0;
    for await (const tx of ctx.db
      .query("creditTransactions")
      .withIndex("by_type", (q) => q.eq("type", "usage"))) {
      totalCreditsSpent += tx.amount;
      docsScanned++;
      if (docsScanned >= MAX_DOCS_SCAN) break;
    }

    const approximate = totalSearches >= MAX_DOCS_SCAN ||
      docsScanned >= MAX_DOCS_SCAN;

    return {
      totalSearches,
      totalLeads,
      totalCreditsSpent,
      averageLeadsPerSearch:
        totalSearches > 0 ? totalLeads / totalSearches : 0,
      note: approximate
        ? "Counts may be approximate due to dataset size. Run daily aggregation for accurate totals."
        : "Using live counts derived from searches. Set up daily aggregation for cached metrics.",
    };
  },
});

/**
 * Get system control status - OPTIMIZED VERSION
 * Uses indexes for status filtering
 */
export const getSystemControlStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const systemConfig = await ctx.db.query("systemConfiguration").unique();

    // Get current processing statistics using index
    const processingSearches = await ctx.db
      .query("searches")
      .withIndex("by_status", (q) => q.eq("status", "processing"))
      .take(100);

    const inProgressSearches = await ctx.db
      .query("searches")
      .withIndex("by_status", (q) => q.eq("status", "in_progress"))
      .take(100);

    const queuedSearches = await ctx.db
      .query("searches")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(100);

    // Get orchestration settings from system config
    const orchestrationSettings = systemConfig?.orchestrationSettings || {
      leadGenerationEnabled: true,
      maintenanceMode: false,
      maxConcurrentSearches: 10,
      pauseReason: undefined,
      pausedAt: undefined,
      pausedBy: undefined,
    };

    return {
      maintenanceMode: orchestrationSettings.maintenanceMode,
      leadGenerationPaused: !orchestrationSettings.leadGenerationEnabled,
      orchestrationSettings,
      processingQueue: {
        processing: processingSearches.length + inProgressSearches.length,
        queued: queuedSearches.length,
        total:
          processingSearches.length +
          inProgressSearches.length +
          queuedSearches.length,
      },
      systemLoad: {
        status:
          processingSearches.length > 10
            ? "high"
            : processingSearches.length > 5
              ? "medium"
              : "low",
        activeProcesses: processingSearches.length + inProgressSearches.length,
      },
    };
  },
});

/**
 * Get system activity - OPTIMIZED VERSION
 * Uses indexes and proper limits
 */
export const getSystemActivity = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const limit = Math.min(args.limit || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    // Get recent system logs using timestamp index
    const systemLogs = await ctx.db
      .query("systemLogs")
      .withIndex("by_timestamp", (q) => q.gte("timestamp", oneHourAgo))
      .order("desc")
      .take(limit);

    // Get recent searches using created index
    const recentSearches = await ctx.db
      .query("searches")
      .withIndex("by_created", (q) => q.gte("createdAt", oneHourAgo))
      .order("desc")
      .take(limit);

    // Get recent failed operations using index
    const failedOperations = await ctx.db
      .query("searches")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .filter((q) => q.gte(q.field("createdAt"), oneHourAgo))
      .take(limit);

    return {
      systemLogs: systemLogs.map((log) => ({
        id: log._id,
        type: log.type,
        action: log.action,
        timestamp: log.timestamp,
        data: log.data,
      })),
      recentSearches: recentSearches.map((search) => ({
        id: search._id,
        userId: search.userId,
        status: search.status,
        createdAt: search._creationTime,
        name: search.name,
        parameters: search.parameters,
      })),
      failedOperations: failedOperations.length,
      activitySummary: {
        totalSearches: recentSearches.length,
        failedSearches: failedOperations.length,
        successRate:
          recentSearches.length > 0
            ? Math.round(
                ((recentSearches.length - failedOperations.length) /
                  recentSearches.length) *
                  100,
              )
            : 100,
      },
    };
  },
});

// Get system configuration - no changes needed (simple unique query)
export const getSystemConfiguration = query({
  args: {},
  handler: async (ctx) => {
    const systemConfig = await ctx.db.query("systemConfiguration").unique();
    return systemConfig;
  },
});

// Get admin settings - no changes needed (simple unique queries)
export const getAdminSettings = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const [settings, systemConfig] = await Promise.all([
      ctx.db.query("adminSettings").unique(),
      ctx.db.query("systemConfiguration").unique(),
    ]);

    const defaults = {
      maintenanceMode: false,
      systemNotifications: true,
      debugMode: false,
      rateLimitEnabled: true,
      registrationEnabled: true,
      maxDailySearches: 100,
      systemMessage: "",
    } as const;

    const orchestration = systemConfig?.orchestrationSettings ?? null;

    return {
      maintenanceMode:
        settings?.maintenanceMode ??
        orchestration?.maintenanceMode ??
        defaults.maintenanceMode,
      systemNotifications:
        settings?.systemNotifications ?? defaults.systemNotifications,
      debugMode: settings?.debugMode ?? defaults.debugMode,
      rateLimitEnabled:
        settings?.rateLimitEnabled ?? defaults.rateLimitEnabled,
      registrationEnabled:
        settings?.registrationEnabled ?? defaults.registrationEnabled,
      maxDailySearches:
        settings?.maxDailySearches ?? defaults.maxDailySearches,
      systemMessage: settings?.systemMessage ?? defaults.systemMessage,
      creditCosts: systemConfig?.creditCosts ?? null,
      planLimits: systemConfig?.planLimits ?? null,
      orchestrationSettings: orchestration,
      updatedAt: settings?.updatedAt ?? systemConfig?.updatedAt ?? null,
      updatedBy: settings?.updatedBy ?? systemConfig?.updatedBy ?? null,
    };
  },
});

/**
 * Get recent credit transactions - OPTIMIZED VERSION
 * Batch user lookups instead of N+1
 */
export const getRecentCreditTransactions = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const limit = Math.min(args.limit || 20, MAX_PAGE_SIZE);

    // Get recent credit transactions
    const transactions = await ctx.db
      .query("creditTransactions")
      .order("desc")
      .take(limit);

    // Batch user lookups - collect unique user IDs
    const userIds = [...new Set(transactions.map((t) => t.userId))];
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));
    const userMap = new Map(
      users.filter(Boolean).map((u) => [u!._id, u!])
    );

    // Map transactions with user info
    const transactionsWithUsers = transactions.map((transaction) => {
      const user = userMap.get(transaction.userId);
      return {
        ...transaction,
        userEmail: user?.email || "Unknown",
        userName: user?.name || "Unknown User",
      };
    });

    return transactionsWithUsers;
  },
});

/**
 * Get system status for admin monitoring - OPTIMIZED VERSION
 * Uses indexes and streaming counts
 */
export const getSystemStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    try {
      // Get processing queue status using indexes
      const processingSearches = await ctx.db
        .query("searches")
        .withIndex("by_status", (q) => q.eq("status", "processing"))
        .take(100);

      const queuedSearches = await ctx.db
        .query("searches")
        .withIndex("by_status", (q) => q.eq("status", "pending"))
        .take(100);

      const failedSearches = await ctx.db
        .query("searches")
        .withIndex("by_status", (q) => q.eq("status", "failed"))
        .filter((q) => q.gte(q.field("createdAt"), oneHourAgo))
        .take(100);

      // Check for stuck operations
      const stuckSearches = processingSearches.filter(
        (search) =>
          now - (search.lastOrchestrationAt || search.createdAt) >
          30 * 60 * 1000,
      );

      // Get user counts - scan with conservative safety limit
      let totalUsers = 0;
      let activeUsers = 0;
      for await (const user of ctx.db.query("users")) {
        totalUsers++;
        if (user.isActive) activeUsers++;
        if (totalUsers >= MAX_DOCS_SCAN) break;
      }

      // Check LangGraph worker status using index
      const recentLangGraphRequests = await ctx.db
        .query("langgraphRequests")
        .withIndex("by_status")
        .filter((q) => q.gte(q.field("createdAt"), oneHourAgo))
        .take(500);

      const failedLangGraphRequests = recentLangGraphRequests.filter(
        (req) => req.status === "failed",
      );

      // Determine overall system health
      let systemHealth: "healthy" | "degraded" | "critical";
      const issues: string[] = [];

      if (stuckSearches.length > 5 || failedSearches.length > 10) {
        systemHealth = "critical";
        if (stuckSearches.length > 5)
          issues.push(`${stuckSearches.length} stuck searches`);
        if (failedSearches.length > 10)
          issues.push(`${failedSearches.length} failed searches`);
      } else if (stuckSearches.length > 0 || failedSearches.length > 5) {
        systemHealth = "degraded";
        if (stuckSearches.length > 0)
          issues.push(`${stuckSearches.length} stuck searches`);
        if (failedSearches.length > 5)
          issues.push(`${failedSearches.length} failed searches`);
      } else {
        systemHealth = "healthy";
      }

      // Calculate success rates
      const searchSuccessRate =
        recentLangGraphRequests.length > 0
          ? Math.round(
              ((recentLangGraphRequests.length -
                failedLangGraphRequests.length) /
                recentLangGraphRequests.length) *
                100,
            )
          : 100;

      return {
        systemHealth,
        issues,
        processing: {
          queuedSearches: queuedSearches.length,
          processingSearches: processingSearches.length,
          stuckSearches: stuckSearches.length,
          failedSearchesLastHour: failedSearches.length,
        },
        users: {
          total: totalUsers,
          active: activeUsers,
          activePercentage:
            totalUsers > 0 ? Math.round((activeUsers / totalUsers) * 100) : 0,
        },
        aiService: {
          requestsLastHour: recentLangGraphRequests.length,
          failedRequests: failedLangGraphRequests.length,
          successRate: searchSuccessRate,
        },
        timestamp: now,
      };
    } catch (error) {
      return {
        systemHealth: "critical" as const,
        issues: ["Unable to fetch system status"],
        processing: {
          queuedSearches: 0,
          processingSearches: 0,
          stuckSearches: 0,
          failedSearchesLastHour: 0,
        },
        users: {
          total: 0,
          active: 0,
          activePercentage: 0,
        },
        aiService: {
          requestsLastHour: 0,
          failedRequests: 0,
          successRate: 0,
        },
        timestamp: now,
      };
    }
  },
});
