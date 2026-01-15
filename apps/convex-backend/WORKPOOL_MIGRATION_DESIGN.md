# Convex Workpool Migration Design

## Executive Summary

**Current Architecture**: Scheduled actions with staggered delays (200ms between leads)
- ✅ Simple to implement and understand
- ❌ Approximate concurrency control (5 concurrent ≈ 200ms stagger)
- ❌ No visibility into active workers
- ❌ Cannot dynamically adjust concurrency
- ❌ Difficult to pause/resume processing

**Proposed Architecture**: Convex Workpool-based processing
- ✅ Precise concurrency control (exactly N workers)
- ✅ Real-time worker visibility and metrics
- ✅ Dynamic concurrency adjustments
- ✅ Built-in pause/resume capabilities
- ✅ Automatic retry and error handling
- ✅ Better resource utilization

---

## Current Lead Processing Flow

### Enrichment Phase (leads/actions.ts)
```typescript
// CURRENT: Scheduled actions with 200ms stagger
for (let i = 0; i < leads.length; i++) {
  await ctx.scheduler.runAfter(
    i * 200, // Approximates 5 concurrent
    internal.leads.asyncEnrichment.enrichSingleLead,
    { leadId: leads[i]._id, ... }
  );
}
```

**Problems**:
1. **Approximate Concurrency**: 200ms stagger ≈ 5 concurrent, but not guaranteed
2. **No Visibility**: Can't see how many enrichments are actually running
3. **No Control**: Can't pause, adjust concurrency, or prioritize leads
4. **Resource Waste**: If 3 actions finish fast, we wait 200ms before next scheduled

---

## Workpool Architecture Design

### Core Concepts

**Workpool** = Queue + Workers + Coordination
- **Queue**: Persistent lead IDs waiting for processing
- **Workers**: Parallel actions pulling from queue
- **Coordinator**: Manages worker count, retries, and completion

### Schema Changes Required

```typescript
// New tables for workpool management
defineTable("enrichmentJobs", {
  searchId: v.id("searches"),
  leadId: v.id("leads"),
  status: v.union(
    v.literal("pending"),
    v.literal("processing"),
    v.literal("completed"),
    v.literal("failed")
  ),
  workerId: v.optional(v.string()),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  retryCount: v.number(),
  lastError: v.optional(v.string()),
  priority: v.number(), // For priority-based processing
  createdAt: v.number(),
})
  .index("by_search", ["searchId"])
  .index("by_status", ["status"])
  .index("by_priority", ["priority", "createdAt"]);

defineTable("enrichmentWorkers", {
  searchId: v.id("searches"),
  workerId: v.string(),
  status: v.union(v.literal("active"), v.literal("idle"), v.literal("failed")),
  currentJobId: v.optional(v.id("enrichmentJobs")),
  processedCount: v.number(),
  failedCount: v.number(),
  lastHeartbeat: v.number(),
  createdAt: v.number(),
})
  .index("by_search", ["searchId"])
  .index("by_status", ["status"])
  .index("by_heartbeat", ["lastHeartbeat"]);

defineTable("enrichmentWorkpool", {
  searchId: v.id("searches"),
  targetConcurrency: v.number(),
  activeWorkers: v.number(),
  pendingJobs: v.number(),
  completedJobs: v.number(),
  failedJobs: v.number(),
  status: v.union(
    v.literal("initializing"),
    v.literal("running"),
    v.literal("paused"),
    v.literal("completed"),
    v.literal("failed")
  ),
  createdAt: v.number(),
  completedAt: v.optional(v.number()),
})
  .index("by_search", ["searchId"])
  .index("by_status", ["status"]);
```

---

## Implementation Plan

### Phase 1: Workpool Infrastructure (Week 1)

**File**: `apps/convex-backend/convex/workpool/enrichment.ts`

```typescript
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

// ============================================================================
// WORKPOOL COORDINATOR
// ============================================================================

/**
 * Initialize enrichment workpool for a search
 * Creates job queue from leads and spawns initial workers
 */
export const initializeEnrichmentWorkpool = internalMutation({
  args: {
    searchId: v.id("searches"),
    leadIds: v.array(v.id("leads")),
    targetConcurrency: v.number(), // Default: 5 for FindyMail
    roles: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // Create workpool record
    const workpoolId = await ctx.db.insert("enrichmentWorkpool", {
      searchId: args.searchId,
      targetConcurrency: args.targetConcurrency,
      activeWorkers: 0,
      pendingJobs: args.leadIds.length,
      completedJobs: 0,
      failedJobs: 0,
      status: "initializing",
      createdAt: Date.now(),
    });

    // Create job queue (batch insert for performance)
    const jobInserts = args.leadIds.map((leadId, index) => ({
      searchId: args.searchId,
      leadId,
      status: "pending" as const,
      retryCount: 0,
      priority: index, // FIFO by default
      createdAt: Date.now(),
    }));

    // Batch insert jobs
    for (const job of jobInserts) {
      await ctx.db.insert("enrichmentJobs", job);
    }

    return { workpoolId, jobsCreated: jobInserts.length };
  },
});

/**
 * Spawn enrichment workers
 * Creates N worker actions that pull jobs from the queue
 */
export const spawnEnrichmentWorkers = internalAction({
  args: {
    searchId: v.id("searches"),
    workerCount: v.number(),
    roles: v.optional(v.array(v.string())),
    userApiKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const workers = [];

    // Spawn workers in parallel
    for (let i = 0; i < args.workerCount; i++) {
      const workerId = `worker_${args.searchId}_${i}_${Date.now()}`;

      // Register worker
      await ctx.runMutation(internal.workpool.enrichment.registerWorker, {
        searchId: args.searchId,
        workerId,
      });

      // Spawn worker action (fire-and-forget)
      ctx.scheduler.runAfter(
        0,
        internal.workpool.enrichment.enrichmentWorker,
        {
          searchId: args.searchId,
          workerId,
          roles: args.roles,
          userApiKey: args.userApiKey,
        }
      );

      workers.push(workerId);
    }

    // Mark workpool as running
    await ctx.runMutation(internal.workpool.enrichment.updateWorkpoolStatus, {
      searchId: args.searchId,
      status: "running",
      activeWorkers: args.workerCount,
    });

    return { workersSpawned: workers.length, workerIds: workers };
  },
});

// ============================================================================
// WORKER IMPLEMENTATION
// ============================================================================

/**
 * Enrichment worker - pulls jobs from queue and processes them
 * Runs until no more jobs available or search is cancelled
 */
export const enrichmentWorker = internalAction({
  args: {
    searchId: v.id("searches"),
    workerId: v.string(),
    roles: v.optional(v.array(v.string())),
    userApiKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let processedCount = 0;
    let failedCount = 0;

    while (true) {
      // Claim next job from queue (atomic)
      const job = await ctx.runMutation(
        internal.workpool.enrichment.claimNextJob,
        {
          searchId: args.searchId,
          workerId: args.workerId,
        }
      );

      // No more jobs - worker done
      if (!job) {
        await ctx.runMutation(internal.workpool.enrichment.deregisterWorker, {
          workerId: args.workerId,
        });
        break;
      }

      // Update worker heartbeat
      await ctx.runMutation(internal.workpool.enrichment.updateWorkerHeartbeat, {
        workerId: args.workerId,
        currentJobId: job._id,
      });

      // Process the lead enrichment
      try {
        const result = await ctx.runAction(
          internal.leads.asyncEnrichment.enrichSingleLead,
          {
            leadId: job.leadId,
            searchId: args.searchId,
            userId: job.userId,
            roles: args.roles,
            userApiKey: args.userApiKey,
          }
        );

        // Mark job as completed
        await ctx.runMutation(internal.workpool.enrichment.completeJob, {
          jobId: job._id,
          success: result.success,
        });

        processedCount++;
      } catch (error) {
        // Handle job failure with retry logic
        const shouldRetry = job.retryCount < 3;

        await ctx.runMutation(internal.workpool.enrichment.failJob, {
          jobId: job._id,
          error: error instanceof Error ? error.message : "Unknown error",
          shouldRetry,
        });

        failedCount++;
      }

      // Check if search was cancelled
      const search = await ctx.runQuery(internal.search.internal.getSearchInternal, {
        searchId: args.searchId,
      });

      if (search?.status === "cancelled") {
        await ctx.runMutation(internal.workpool.enrichment.deregisterWorker, {
          workerId: args.workerId,
        });
        break;
      }
    }

    // Check if workpool is complete
    await ctx.runMutation(internal.workpool.enrichment.checkWorkpoolCompletion, {
      searchId: args.searchId,
    });

    return {
      workerId: args.workerId,
      processedCount,
      failedCount,
    };
  },
});

// ============================================================================
// JOB QUEUE OPERATIONS
// ============================================================================

/**
 * Atomically claim next pending job
 * Returns null if no jobs available
 */
export const claimNextJob = internalMutation({
  args: {
    searchId: v.id("searches"),
    workerId: v.string(),
  },
  handler: async (ctx, args) => {
    // Find next pending job (sorted by priority)
    const job = await ctx.db
      .query("enrichmentJobs")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .filter((q) => q.eq(q.field("searchId"), args.searchId))
      .order("asc") // Priority ascending
      .first();

    if (!job) return null;

    // Atomically claim the job
    await ctx.db.patch(job._id, {
      status: "processing",
      workerId: args.workerId,
      startedAt: Date.now(),
    });

    // Get lead details
    const lead = await ctx.db.get(job.leadId);
    const search = await ctx.db.get(args.searchId);

    return {
      _id: job._id,
      leadId: job.leadId,
      userId: search?.userId,
      retryCount: job.retryCount,
    };
  },
});

/**
 * Mark job as completed
 */
export const completeJob = internalMutation({
  args: {
    jobId: v.id("enrichmentJobs"),
    success: v.boolean(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return;

    await ctx.db.patch(args.jobId, {
      status: "completed",
      completedAt: Date.now(),
    });

    // Update workpool stats
    const workpool = await ctx.db
      .query("enrichmentWorkpool")
      .withIndex("by_search", (q) => q.eq("searchId", job.searchId))
      .first();

    if (workpool) {
      await ctx.db.patch(workpool._id, {
        completedJobs: workpool.completedJobs + 1,
        pendingJobs: workpool.pendingJobs - 1,
      });
    }
  },
});

/**
 * Mark job as failed with retry support
 */
export const failJob = internalMutation({
  args: {
    jobId: v.id("enrichmentJobs"),
    error: v.string(),
    shouldRetry: v.boolean(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return;

    if (args.shouldRetry) {
      // Retry - reset to pending with incremented counter
      await ctx.db.patch(args.jobId, {
        status: "pending",
        workerId: undefined,
        retryCount: job.retryCount + 1,
        lastError: args.error,
      });
    } else {
      // Failed permanently
      await ctx.db.patch(args.jobId, {
        status: "failed",
        completedAt: Date.now(),
        lastError: args.error,
      });

      // Update workpool stats
      const workpool = await ctx.db
        .query("enrichmentWorkpool")
        .withIndex("by_search", (q) => q.eq("searchId", job.searchId))
        .first();

      if (workpool) {
        await ctx.db.patch(workpool._id, {
          failedJobs: workpool.failedJobs + 1,
          pendingJobs: workpool.pendingJobs - 1,
        });
      }
    }
  },
});
```

---

## Migration Benefits

### 1. **Precise Concurrency Control**
```typescript
// BEFORE: Approximate 5 concurrent
for (let i = 0; i < 500; i++) {
  await ctx.scheduler.runAfter(i * 200, ...); // ~5 concurrent
}

// AFTER: Exactly 5 concurrent
await spawnEnrichmentWorkers({
  searchId,
  workerCount: 5, // Exactly 5 workers
});
```

### 2. **Real-time Visibility**
```typescript
// Query workpool status
const workpool = await ctx.db
  .query("enrichmentWorkpool")
  .withIndex("by_search", (q) => q.eq("searchId", searchId))
  .first();

console.log({
  activeWorkers: workpool.activeWorkers,      // 5
  pendingJobs: workpool.pendingJobs,          // 245 remaining
  completedJobs: workpool.completedJobs,      // 250 done
  failedJobs: workpool.failedJobs,            // 5 failed
  completionRate: (250 / 500) * 100,          // 50%
});
```

### 3. **Dynamic Adjustments**
```typescript
// Pause processing (emergency stop)
await pauseEnrichmentWorkpool({ searchId });

// Resume processing
await resumeEnrichmentWorkpool({ searchId });

// Scale up concurrency
await scaleWorkpool({ searchId, targetConcurrency: 10 });

// Scale down concurrency
await scaleWorkpool({ searchId, targetConcurrency: 2 });
```

### 4. **Priority Processing**
```typescript
// Prioritize certain leads
await prioritizeLeads({
  searchId,
  leadIds: highValueLeads,
  priority: 0, // Process first
});

// Regular leads get default priority
// priority = insertion order
```

---

## Performance Comparison

| Metric | Current (Scheduled) | Workpool |
|--------|---------------------|----------|
| **Concurrency Control** | Approximate (~5) | Exact (5) |
| **Startup Time** | 500 leads × 200ms = 100s | Instant (<1s) |
| **Visibility** | None (logs only) | Real-time dashboard |
| **Pause/Resume** | Not supported | Instant |
| **Priority** | FIFO only | Configurable |
| **Resource Waste** | High (wait for stagger) | Low (pull immediately) |
| **Error Recovery** | Manual | Automatic retry |
| **Scaling** | Redeploy | Dynamic (runtime) |

---

## Migration Timeline

### Week 1: Infrastructure
- [ ] Add workpool schema tables
- [ ] Implement coordinator (init, spawn)
- [ ] Implement worker (claim, process)
- [ ] Add job queue operations

### Week 2: Integration
- [ ] Update `enrichLeads` action to use workpool
- [ ] Add workpool monitoring queries
- [ ] Implement pause/resume controls
- [ ] Add admin dashboard UI

### Week 3: Testing & Rollout
- [ ] Unit tests for workpool operations
- [ ] Integration tests with real enrichment
- [ ] Gradual rollout (10% → 50% → 100%)
- [ ] Monitor performance and errors

### Week 4: Optimization
- [ ] Tune concurrency based on provider limits
- [ ] Add priority-based processing
- [ ] Implement worker health checks
- [ ] Add automatic scaling based on load

---

## Risks & Mitigation

### Risk 1: Schema Migration Complexity
**Mitigation**: Add tables without removing old code, run both systems in parallel during migration.

### Risk 2: Increased Database Writes
**Mitigation**: Batch job inserts, use heartbeat throttling (every 30s not every lead).

### Risk 3: Worker Failures
**Mitigation**: Implement heartbeat monitoring, automatic worker restart, orphaned job recovery.

### Risk 4: Race Conditions in Job Claiming
**Mitigation**: Use atomic mutations, transaction-like semantics with status checks.

---

## Conclusion

**Workpool migration provides**:
- ✅ 50% faster startup (100s → <1s)
- ✅ Precise concurrency control (5 exact vs ~5 approximate)
- ✅ Real-time visibility and control
- ✅ Dynamic scaling without redeployment
- ✅ Automatic error recovery and retries
- ✅ Better resource utilization

**Recommended**: Migrate enrichment phase first (highest ROI), then analysis phase if successful.

**Timeline**: 4 weeks from start to full production rollout with monitoring and optimization.
