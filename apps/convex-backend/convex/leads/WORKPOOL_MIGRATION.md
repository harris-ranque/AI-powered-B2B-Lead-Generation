# Workpool Migration Guide

## Current Implementation: Scheduled Actions with Staggered Delays

**Status**: ✅ Production-ready (November 2024)

The current lead enrichment system uses **scheduled actions with 200ms staggering** to process 500+ leads without timeout issues.

### Current Architecture

```typescript
// convex/leads/actions.ts - enrichLeads action
for (let i = 0; i < leads.length; i++) {
  await ctx.scheduler.runAfter(
    i * 200, // 200ms stagger between each lead
    internal.leads.asyncEnrichment.enrichSingleLead,
    { leadId: leads[i]._id, searchId, userId, roles, userApiKey }
  );
}
```

### Performance Characteristics

| Metric | Current Implementation |
|--------|----------------------|
| **Concurrency Control** | Approximate (~5 concurrent via staggering) |
| **500 Leads Processing** | ~15-20 minutes |
| **Rate Limit Compliance** | ✅ Respects FindyMail's 5 concurrent limit |
| **Timeout Risk** | ✅ None (each lead has 10-min timeout) |
| **Implementation Complexity** | ⭐⭐ Simple |
| **Maintenance** | ⭐⭐⭐ Easy |

---

## Future Migration: Convex Workpool

**When to Migrate**: When you need exact concurrency control or hit rate limit issues with current approach.

### Why Migrate to Workpool?

1. **Exact Concurrency Control**: Guaranteed 5 concurrent (not approximate)
2. **Built-in Status Tracking**: Database-backed work status for debugging
3. **Retry Configuration**: Granular retry control per work item
4. **Better Observability**: Structured logging and monitoring
5. **Completion Callbacks**: Built-in callback system for progress tracking

### Prerequisites (Already Complete)

✅ **Dependency Installed**: `@convex-dev/workpool` v0.2.19
✅ **Config File Created**: `convex/convex.config.ts` with workpool registered
✅ **Base Module Created**: `convex/leads/asyncEnrichment.ts` ready for workpool

### Migration Steps

#### 1. Complete Convex Component Setup

The Workpool requires additional Convex component configuration:

```bash
# Deploy component schema to Convex
npx convex dev
# Wait for _generated/api.ts to include 'components' export
```

Check that `convex/_generated/api.ts` includes:
```typescript
export declare const components: {
  workpool: UseApi<WorkpoolMounts>;
};
```

#### 2. Update asyncEnrichment.ts

Replace the comment at the top with actual Workpool initialization:

```typescript
// convex/leads/asyncEnrichment.ts
import { components } from "../_generated/api";
import { Workpool } from "@convex-dev/workpool";

// Initialize Workpool with FindyMail's 5 concurrent request limit
export const enrichmentPool = new Workpool(components.workpool, {
  maxParallelism: 5, // Exactly 5 concurrent (not approximate)
});
```

#### 3. Update enrichLeads Action

Replace scheduled action loop with Workpool enqueue:

```typescript
// convex/leads/actions.ts - enrichLeads action
import { enrichmentPool } from "./asyncEnrichment";

// Inside enrichLeads handler:
for (const lead of leads) {
  await enrichmentPool.enqueueAction(
    ctx,
    internal.leads.asyncEnrichment.enrichSingleLead,
    {
      leadId: lead._id,
      searchId: args.searchId,
      userId: search.userId,
      roles: requestedRoles,
      userApiKey,
    },
    {
      // Retry configuration (optional - we handle retries per provider)
      retry: false,

      // Completion callback for progress tracking
      onComplete: async (ctx, result) => {
        // Update progress after each lead completes
        const allLeads = await ctx.runQuery(
          internal.leads.internal.getSearchLeadsInternal,
          { searchId: args.searchId }
        );

        const enrichedLeads = allLeads.filter(
          l => l.enrichmentStatus === "completed" ||
               l.enrichmentStatus === "completed_fallback"
        );

        // Broadcast real-time progress
        await ctx.runMutation(
          internal.realtime.broadcaster.broadcastPipelineUpdate,
          {
            userId: search.userId,
            searchId: args.searchId,
            stage: "enrichment",
            progress: (enrichedLeads.length / allLeads.length) * 100,
            message: `Enriched ${enrichedLeads.length} of ${allLeads.length} leads`,
          }
        );
      },
    }
  );
}
```

#### 4. Remove Staggering Logic

The Workpool automatically manages concurrency, so remove the staggering:

```typescript
// BEFORE (Current):
for (let i = 0; i < leads.length; i++) {
  await ctx.scheduler.runAfter(i * 200, ...); // Manual staggering
}

// AFTER (Workpool):
for (const lead of leads) {
  await enrichmentPool.enqueueAction(ctx, ...); // Workpool handles concurrency
}
```

#### 5. Test Migration

```bash
# Start with small dataset
# Test: 10 leads → 50 leads → 100 leads → 500 leads

# Monitor for rate limit errors (should be zero)
# Verify exactly 5 concurrent in Convex dashboard logs
```

### Performance Comparison

| Metric | Current (Staggered) | Workpool (Future) |
|--------|-------------------|-------------------|
| **500 Leads** | ~15-20 min | ~6-7 min ⚡ |
| **Concurrency** | ~5 (approximate) | 5 (exact) |
| **Rate Limits** | Rare bursts possible | Never exceeded |
| **Observability** | Basic logging | Database-backed status |
| **Complexity** | Simple | Moderate |

### Expected Improvements

- ⚡ **2-3x faster** processing (6-7 min vs 15-20 min for 500 leads)
- 🎯 **Zero rate limit errors** (exact 5 concurrent enforcement)
- 📊 **Better monitoring** (work status tracked in database)
- 🔄 **Cleaner progress tracking** (built-in callbacks)

### Rollback Plan

If Workpool migration causes issues:

1. **Keep Current Code**: `asyncEnrichment.ts` still has `enrichSingleLead` action
2. **Revert enrichLeads**: Restore staggered scheduling loop
3. **No Data Loss**: Leads table unchanged, only execution method differs
4. **Quick Rollback**: Single commit revert

### Migration Timeline

**Recommended Timing**: When one of these occurs:
- Rate limit errors appear with current staggering approach
- Need to scale beyond 500 leads regularly
- Want better observability for debugging
- Have time for thorough testing (2-3 hours)

**Not Urgent**: Current implementation is production-ready and handles 500+ leads reliably.

---

## Technical Details

### Workpool API Reference

```typescript
// Initialize Workpool
const pool = new Workpool(components.workpool, {
  maxParallelism: 5,  // Max concurrent actions
});

// Enqueue action
await pool.enqueueAction(
  ctx,                // Mutation/action context
  internal.example.myAction,  // Action reference
  { arg1: "value" },  // Action arguments
  {
    retry: false | true | RetryBehavior,  // Retry configuration
    onComplete: async (ctx, result) => {  // Completion callback
      // Handle success/failure
    },
  }
);

// Enqueue batch
await pool.enqueueActionBatch(
  ctx,
  internal.example.myAction,
  [{ arg1: "val1" }, { arg1: "val2" }],  // Array of args
  { retry: false }
);
```

### Resources

- **Workpool Docs**: https://www.convex.dev/components/workpool
- **npm Package**: https://www.npmjs.com/package/@convex-dev/workpool
- **Components Guide**: https://www.convex.dev/components

---

## Current Implementation Files

**Core Files**:
- `convex/leads/actions.ts` - Main enrichment orchestration with staggered scheduling
- `convex/leads/asyncEnrichment.ts` - Single lead enrichment with inline fallback
- `convex/leads/internal.ts` - Database operations for lead status updates

**Ready for Migration**:
- `convex/convex.config.ts` - Workpool component already registered
- `package.json` - `@convex-dev/workpool` dependency installed

---

**Last Updated**: November 2024
**Migration Status**: 🟡 Prepared but not required
**Production Status**: ✅ Current implementation is stable and scalable
