# Search Completion Reliability System

**Status**: Implementation Plan
**Priority**: High
**Category**: System Reliability, User Experience
**Last Updated**: November 11, 2025

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Root Cause Analysis](#root-cause-analysis)
3. [Proposed Solution](#proposed-solution)
4. [Implementation Plan](#implementation-plan)
5. [Technical Specifications](#technical-specifications)
6. [Testing Strategy](#testing-strategy)
7. [Rollout Plan](#rollout-plan)

---

## Problem Statement

### The Issue

Lead searches can become **permanently stuck in "processing" state** when the batch completion webhook from the LangGraph worker fails to reach the Convex backend. This results in:

- ❌ Search shows "0 leads found" despite successful analysis
- ❌ Users cannot access analyzed leads or export CSV
- ❌ Credits are reserved but search never completes
- ❌ No user-facing indication that the search is stuck
- ❌ Automated monitoring doesn't catch the issue

### Real-World Incident

**Date**: November 10, 2025
**Search ID**: `k97ethkvm3v39eredg50jz01jd7v7enc`

**Timeline**:
```
22:24:16 - Batch analysis started (14 leads)
22:24:52 - Progress webhook received (21.4%)
22:25:11 - Progress webhook received (64.3%)
22:25:14 - Monitoring cron ran (too early, skipped search)
22:25:32 - Worker completed batch, sent completion webhook
         ❌ WEBHOOK NEVER ARRIVED AT CONVEX
22:25:14+ - Monitoring ran every 3 minutes but kept skipping
         - Leads stuck in "processing" status
         - Search status: "processing" forever
         - UI shows: "0 leads found"
```

**Resolution**: Manual intervention required (`npx convex run search/actions:completeSearch`)

---

## Root Cause Analysis

### Webhook Failure Points

1. **Authentication Failure**: Worker signature doesn't match Convex expectations
2. **Network Timeout**: Request times out before reaching Convex
3. **Rate Limiting**: Convex rate-limits the webhook endpoint
4. **Payload Size**: Batch results exceed payload limits (14 leads × ~2KB each = ~28KB)
5. **Silent Failures**: Worker logs success before confirming delivery

### Monitoring System Gaps

Current monitoring (`convex/search/monitoring.ts`) has critical flaws:

```typescript
// Line 88-98: Only completes search if ALL leads have final status
const activeLeads = eligibleLeads.filter((lead) =>
  !FINAL_ANALYSIS_STATUSES.has(lead.analysisStatus ?? "")
);

if (activeLeads.length > 0) {
  continue; // ⚠️ SKIPS THE SEARCH!
}
```

**The Problem**: Circular dependency
- Monitoring waits for leads to have "completed"/"failed" status
- Lead status is only set by webhooks
- If webhook fails, status never updates
- **Monitoring skips the search forever**

### Why It Wasn't Caught

The monitoring system ran **4+ times** but never fixed the stuck search:

| Time | Result | Why Skipped |
|------|--------|-------------|
| 22:28:14 | ❌ Skipped | 14 leads in "processing", `activeLeads.length > 0` |
| 22:31:14 | ❌ Skipped | 14 leads still "processing" |
| 22:34:14 | ❌ Skipped | 14 leads still "processing" |
| 22:37:12 | ✅ **Manual fix** | User ran `completeSearch` manually |

**Key Insight**: Monitoring runs every 3 minutes but has no timeout-based detection for stuck leads.

---

## Proposed Solution

### Design Philosophy

> "Don't try to predict every edge case with complex timeout algorithms.
> Give users a manual escape hatch and let them decide when something is stuck."

### Two-Layer Approach

#### Layer 1: Manual Force Complete Button (Primary)

**User-Facing Control** - Let users force complete stuck searches

Benefits:
- ✅ **Instant feedback** - Users see exactly what's happening
- ✅ **No false positives** - Users decide when it's "stuck enough"
- ✅ **Simple logic** - Just track last activity timestamp
- ✅ **Clear communication** - Show progress stats before forcing
- ✅ **Audit trail** - Log all manual interventions

#### Layer 2: Automated Monitoring (Safety Net)

**Conservative Timeout** - Only force complete after 30+ minutes of inactivity

Benefits:
- ✅ **Catches edge cases** - When user doesn't notice stuck search
- ✅ **No user intervention required** - System self-heals eventually
- ✅ **Very conservative** - Won't interrupt legitimate long-running searches
- ✅ **Logging & alerts** - Track all auto-completions for debugging

---

## Implementation Plan

### Phase 1: Backend Infrastructure

#### 1.1 Schema Changes

```typescript
// convex/schema.ts

searches: defineTable({
  // ... existing fields

  // Track last activity for timeout detection
  lastActivityAt: v.optional(v.number()),

  // Track manual interventions
  forceCompletedBy: v.optional(v.id("users")),
  forceCompletedAt: v.optional(v.number()),
  forceCompletionReason: v.optional(v.string()),
})
```

#### 1.2 Update Webhook Handlers

Update all webhook handlers to track activity:

```typescript
// convex/langgraph/webhooks.ts

// In handleBatchProgress (line 1038-1059)
await ctx.db.patch(searchIdTyped, {
  lastActivityAt: Date.now(),
});

// In handleEmailGenerationCompleted (line 469-500)
await ctx.db.patch(searchId, {
  lastActivityAt: Date.now(),
});

// In handleBatchCompleted (line 1378-1407)
await ctx.db.patch(searchIdTyped, {
  lastActivityAt: Date.now(),
});
```

#### 1.3 Force Complete Action

```typescript
// convex/search/actions.ts

export const forceCompleteSearch = action({
  args: {
    searchId: v.id("searches"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // 1. Authenticate user
    const userId = await getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // 2. Verify ownership
    const search = await ctx.runQuery(
      internal.search.internal.getSearchInternal,
      { searchId: args.searchId }
    );

    if (!search) throw new Error("Search not found");
    if (search.userId !== userId) throw new Error("Not authorized");

    // 3. Verify status
    if (!["processing", "in_progress"].includes(search.status)) {
      throw new Error(`Cannot force complete: status is ${search.status}`);
    }

    // 4. Log intervention
    const correlation = createCorrelationContext(
      OPERATION_TYPES.SEARCH_COMPLETION,
      userId,
      {
        searchId: args.searchId,
        metadata: {
          trigger: "manual_force_complete",
          reason: args.reason || "user_initiated",
          previousStatus: search.status,
        },
      }
    );

    logWithCorrelation(
      "warn",
      correlation,
      "🔧 MANUAL FORCE COMPLETE: User triggered completion",
      {
        searchId: args.searchId,
        userId,
        reason: args.reason,
      }
    );

    // 5. Update search metadata
    await ctx.runMutation(internal.search.internal.updateSearch, {
      searchId: args.searchId,
      updates: {
        forceCompletedBy: userId,
        forceCompletedAt: Date.now(),
        forceCompletionReason: args.reason || "user_initiated",
      },
    });

    // 6. Broadcast to user
    await ctx.runMutation(internal.realtime.broadcaster.broadcast, {
      userId,
      type: "search_force_completed",
      title: "Search completion initiated",
      message: "Finalizing search results...",
      data: { searchId: args.searchId },
      priority: "high",
    });

    // 7. Trigger completion
    await ctx.scheduler.runAfter(
      0,
      internal.search.actions.completeSearch,
      { searchId: args.searchId }
    );

    return {
      success: true,
      message: "Search completion initiated",
    };
  },
});
```

#### 1.4 Enhanced Monitoring

Update monitoring with timeout-based detection:

```typescript
// convex/search/monitoring.ts

const ACTIVITY_TIMEOUTS = {
  WARNING: 10 * 60 * 1000,   // 10 min - log warning
  ERROR: 20 * 60 * 1000,      // 20 min - send alert
  CRITICAL: 30 * 60 * 1000,   // 30 min - force completion
};

export const checkPendingCompletions: any = internalAction({
  handler: async (ctx) => {
    const searches = await ctx.runQuery(
      internal.search.internal.getSearchesByStatusesInternal,
      { statuses: ["processing", "in_progress"] }
    );

    const now = Date.now();

    for (const search of searches) {
      const leads = await ctx.runQuery(
        internal.leads.internal.getSearchLeadsInternal,
        { searchId: search._id }
      );

      const eligibleLeads = leads.filter((lead) => {
        const enrichmentComplete =
          lead.enrichmentStatus === "completed" ||
          lead.enrichmentStatus === "completed_fallback";
        const hasEmail = Boolean(lead.contactInfo?.emails?.length);
        const hasContactName = Boolean(lead.contactInfo?.contacts?.[0]?.name);
        return enrichmentComplete && hasEmail && hasContactName;
      });

      if (eligibleLeads.length === 0) continue;

      const finishedLeads = eligibleLeads.filter((lead) =>
        FINAL_ANALYSIS_STATUSES.has(lead.analysisStatus ?? "")
      );

      const activeLeads = eligibleLeads.filter((lead) =>
        !FINAL_ANALYSIS_STATUSES.has(lead.analysisStatus ?? "")
      );

      // Normal completion (all leads finished)
      if (activeLeads.length === 0 && finishedLeads.length > 0) {
        await ctx.scheduler.runAfter(0, "search/actions:completeSearch", {
          searchId: search._id,
        });
        continue;
      }

      // Timeout-based detection
      const lastActivity = search.lastActivityAt || search.createdAt;
      const inactivityDuration = now - lastActivity;

      if (inactivityDuration > ACTIVITY_TIMEOUTS.CRITICAL) {
        logger.error("CRITICAL: 30min timeout - auto-completing", {
          searchId: search._id,
          inactivityMin: (inactivityDuration / 60000).toFixed(1),
          eligibleLeads: eligibleLeads.length,
          finishedLeads: finishedLeads.length,
          activeLeads: activeLeads.length,
        });

        await ctx.runMutation(internal.search.internal.updateSearch, {
          searchId: search._id,
          updates: {
            forceCompletionReason: "automated_timeout_30min",
            forceCompletedAt: Date.now(),
          },
        });

        await ctx.scheduler.runAfter(0, "search/actions:completeSearch", {
          searchId: search._id,
        });
      } else if (inactivityDuration > ACTIVITY_TIMEOUTS.ERROR) {
        logger.error("ERROR: 20min inactivity - search may be stuck", {
          searchId: search._id,
          inactivityMin: (inactivityDuration / 60000).toFixed(1),
        });
      } else if (inactivityDuration > ACTIVITY_TIMEOUTS.WARNING) {
        logger.warn("WARNING: 10min inactivity", {
          searchId: search._id,
          inactivityMin: (inactivityDuration / 60000).toFixed(1),
        });
      }
    }
  }
});
```

### Phase 2: Frontend Implementation

#### 2.1 Force Complete Button Component

```typescript
// apps/web/src/components/search/ForceCompleteButton.tsx

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@genni/convex-types";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ForceCompleteButtonProps {
  searchId: string;
  status: string;
  leadStats: {
    discovered: number;
    enriched: number;
    analyzed: number;
    processing: number;
  };
  lastActivityAt?: number;
}

export function ForceCompleteButton({
  searchId,
  status,
  leadStats,
  lastActivityAt,
}: ForceCompleteButtonProps) {
  const [isCompleting, setIsCompleting] = useState(false);
  const forceComplete = useMutation(api.search.actions.forceCompleteSearch);

  // Calculate inactivity duration
  const now = Date.now();
  const timeSinceActivity = lastActivityAt
    ? (now - lastActivityAt) / 60000
    : 0; // minutes

  const isProcessing = status === "processing" || status === "in_progress";

  // Enable button only for processing searches
  if (!isProcessing) return null;

  // Suggest force complete if no activity for 5+ minutes
  const suggestForceComplete = timeSinceActivity > 5;

  const handleForceComplete = async () => {
    const confirmMessage =
      `Force complete this search?\n\n` +
      `Analyzed leads: ${leadStats.analyzed}\n` +
      `Still processing: ${leadStats.processing}\n\n` +
      `Processing leads will be excluded from results.`;

    if (!confirm(confirmMessage)) return;

    setIsCompleting(true);
    try {
      await forceComplete({
        searchId,
        reason: `Manual completion - ${leadStats.processing} leads still processing`,
      });
      toast.success("Search completed successfully");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to complete search"
      );
    } finally {
      setIsCompleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {suggestForceComplete && (
        <Alert variant="warning">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No progress for {timeSinceActivity.toFixed(0)} minutes.
            Search may be stuck. Force completion to access analyzed leads.
          </AlertDescription>
        </Alert>
      )}

      <Button
        onClick={handleForceComplete}
        disabled={isCompleting}
        variant={suggestForceComplete ? "default" : "outline"}
        className="w-full"
      >
        {isCompleting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Completing...
          </>
        ) : (
          <>
            <CheckCircle className="mr-2 h-4 w-4" />
            {suggestForceComplete
              ? `Force Complete (${leadStats.analyzed} leads ready)`
              : "Finish Search Now"}
          </>
        )}
      </Button>

      {!suggestForceComplete && (
        <p className="text-xs text-muted-foreground text-center">
          Search is still processing. Only use if stuck.
        </p>
      )}
    </div>
  );
}
```

#### 2.2 Enhanced Search History Card

```typescript
// apps/web/src/components/search/SearchHistoryCard.tsx

import { ForceCompleteButton } from "./ForceCompleteButton";

export function SearchHistoryCard({ search }: { search: SearchWithStats }) {
  const { discovered, enriched, analyzed, processing } = search.leadStats;
  const isProcessing = search.status === "processing" || search.status === "in_progress";

  const lastActivityAt = search.lastActivityAt || search.createdAt;
  const timeSinceActivity = (Date.now() - lastActivityAt) / 60000;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>{search.searchQuery}</CardTitle>
            <CardDescription>
              {search.location.city}, {search.location.state}
            </CardDescription>
          </div>

          <Badge variant={
            search.status === "completed" ? "success" :
            search.status === "processing" ? "default" :
            "secondary"
          }>
            {search.status === "processing" && processing > 0 && (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            )}
            {search.status}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Progress Stats */}
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Discovered</div>
            <div className="text-2xl font-bold">{discovered}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Enriched</div>
            <div className="text-2xl font-bold">{enriched}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Analyzed</div>
            <div className="text-2xl font-bold">{analyzed}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Processing</div>
            <div className="text-2xl font-bold">
              {processing}
              {processing > 0 && isProcessing && (
                <span className="ml-1 text-xs text-muted-foreground">
                  ({timeSinceActivity.toFixed(0)}m ago)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        {isProcessing && (
          <div className="space-y-2">
            <Progress value={(analyzed / discovered) * 100} />
            <p className="text-xs text-muted-foreground">
              {analyzed} of {discovered} leads analyzed (
              {((analyzed / discovered) * 100).toFixed(0)}%)
            </p>
          </div>
        )}

        {/* Force Complete Button */}
        {isProcessing && (
          <ForceCompleteButton
            searchId={search._id}
            status={search.status}
            leadStats={{ discovered, enriched, analyzed, processing }}
            lastActivityAt={lastActivityAt}
          />
        )}

        {/* Export Button (completed searches) */}
        {search.status === "completed" && (
          <Button
            onClick={() => downloadCSV(search._id)}
            className="w-full"
          >
            <Download className="mr-2 h-4 w-4" />
            Export CSV ({analyzed} leads)
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
```

### Phase 3: Testing

#### 3.1 Unit Tests

```typescript
// apps/web/src/components/search/__tests__/ForceCompleteButton.test.tsx

describe("ForceCompleteButton", () => {
  it("should not render for completed searches", () => {
    const { container } = render(
      <ForceCompleteButton
        searchId="test"
        status="completed"
        leadStats={{ discovered: 10, enriched: 10, analyzed: 10, processing: 0 }}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("should show warning after 5 minutes of inactivity", () => {
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000 + 1000);

    const { getByText } = render(
      <ForceCompleteButton
        searchId="test"
        status="processing"
        leadStats={{ discovered: 10, enriched: 10, analyzed: 5, processing: 5 }}
        lastActivityAt={fiveMinutesAgo}
      />
    );

    expect(getByText(/No progress for 5 minutes/)).toBeInTheDocument();
  });

  it("should show confirmation dialog on click", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);

    const { getByRole } = render(
      <ForceCompleteButton
        searchId="test"
        status="processing"
        leadStats={{ discovered: 10, enriched: 10, analyzed: 5, processing: 5 }}
      />
    );

    const button = getByRole("button");
    fireEvent.click(button);

    expect(confirmSpy).toHaveBeenCalled();
  });
});
```

#### 3.2 Integration Tests

```typescript
// apps/convex-backend/convex/search/actions.test.ts

describe("forceCompleteSearch", () => {
  it("should force complete a stuck search", async () => {
    // Create stuck search
    const searchId = await createTestSearch({
      status: "processing",
      lastActivityAt: Date.now() - 10 * 60 * 1000, // 10 min ago
    });

    // Force complete
    const result = await forceCompleteSearch({ searchId });

    expect(result.success).toBe(true);

    // Verify search status updated
    const search = await getSearch(searchId);
    expect(search.status).toBe("completed");
    expect(search.forceCompletedBy).toBeDefined();
  });

  it("should reject if user doesn't own search", async () => {
    const searchId = await createTestSearch({ userId: "other-user" });

    await expect(
      forceCompleteSearch({ searchId })
    ).rejects.toThrow("Not authorized");
  });

  it("should reject if search is already completed", async () => {
    const searchId = await createTestSearch({ status: "completed" });

    await expect(
      forceCompleteSearch({ searchId })
    ).rejects.toThrow("Cannot force complete");
  });
});
```

#### 3.3 E2E Tests

```typescript
// apps/web/e2e/search-completion.spec.ts

test("should force complete stuck search", async ({ page }) => {
  // Create search
  await page.goto("/dashboard");
  await createSearch(page, "Marketing Agencies in Seattle");

  // Wait for processing to start
  await page.waitForSelector('[data-testid="search-status"][data-status="processing"]');

  // Simulate webhook failure (intercept and block)
  await page.route("**/webhooks/langgraph/batch-completed", route => route.abort());

  // Wait for "Force Complete" button to appear
  await page.waitForSelector('button:has-text("Force Complete")', {
    timeout: 6 * 60 * 1000, // 6 minutes
  });

  // Click force complete
  await page.click('button:has-text("Force Complete")');
  await page.click('button:has-text("OK")'); // Confirmation

  // Verify search completed
  await expect(page.locator('[data-testid="search-status"]')).toHaveText("completed");
  await expect(page.locator('button:has-text("Export CSV")')).toBeVisible();
});
```

---

## Testing Strategy

### Test Scenarios

1. **Normal Operation** - Search completes without force
2. **Webhook Failure** - Search stuck, user forces complete
3. **Partial Results** - Some leads analyzed, rest stuck
4. **Permission Checks** - User can only force own searches
5. **Status Validation** - Can't force complete finished searches
6. **Timeout Detection** - Automated completion after 30 min

### Load Testing

Test with various batch sizes:
- 14 leads (1 batch) - ~3 min expected
- 100 leads (1 batch) - ~18 min expected
- 500 leads (5 batches) - ~19 min expected (parallel)
- 1000 leads (10 batches) - ~20 min expected (parallel)

Verify timeouts scale appropriately.

---

## Rollout Plan

### Phase 1: Backend (Week 1)

- ✅ Day 1-2: Schema changes and migrations
- ✅ Day 3-4: Update webhook handlers with activity tracking
- ✅ Day 5: Implement force complete action
- ✅ Day 6-7: Enhanced monitoring with timeouts

### Phase 2: Frontend (Week 2)

- ✅ Day 1-2: Force complete button component
- ✅ Day 3-4: Search history card enhancements
- ✅ Day 5: User confirmation flows
- ✅ Day 6-7: UI polish and edge cases

### Phase 3: Testing (Week 3)

- ✅ Day 1-3: Unit and integration tests
- ✅ Day 4-5: E2E tests
- ✅ Day 6-7: Load testing and performance validation

### Phase 4: Deployment (Week 4)

- ✅ Day 1: Deploy backend to staging
- ✅ Day 2-3: QA testing on staging
- ✅ Day 4: Deploy to production
- ✅ Day 5-7: Monitor and iterate

---

## Monitoring & Metrics

### Key Metrics to Track

1. **Force Completion Rate**
   - Manual force completions / total searches
   - Target: <2% (most searches complete naturally)

2. **Timeout Completion Rate**
   - Automated 30min timeouts / total searches
   - Target: <0.5% (rare edge cases only)

3. **Webhook Failure Rate**
   - Failed webhooks / total webhooks
   - Target: <1%

4. **Average Time to Force Complete**
   - How long users wait before forcing
   - Expected: 5-15 minutes

5. **Search Completion Time**
   - P50, P95, P99 completion times
   - Track by lead count

### Alerts

- 🚨 **Critical**: Webhook failure rate >5%
- ⚠️ **Warning**: Force completion rate >5%
- ℹ️ **Info**: Timeout completion rate >1%

---

## Success Criteria

✅ **Must Have**:
- Manual force complete button in search history
- Activity tracking on all webhook handlers
- Conservative automated timeout (30 min)
- Comprehensive logging and audit trail

✅ **Should Have**:
- Warning indicators for stuck searches
- Confirmation dialog with clear stats
- Real-time progress updates
- Admin dashboard for stuck search analytics

✅ **Nice to Have**:
- Automated webhook retry mechanism
- Webhook delivery confirmation
- Per-batch timeout tracking
- Predictive "stuck search" detection

---

## Future Enhancements

### Short Term (Next Quarter)

1. **Webhook Reliability Improvements**
   - Implement webhook delivery confirmation
   - Add automatic retry with exponential backoff
   - Track webhook latency and failure patterns

2. **Batch-Level Tracking**
   - Track individual batch completion
   - Detect partial batch failures
   - Enable per-batch force completion

3. **Enhanced Monitoring**
   - Dashboard for stuck searches
   - Real-time webhook health monitoring
   - Automated alerting for anomalies

### Long Term (Next 6 Months)

1. **Predictive Detection**
   - ML-based stuck search prediction
   - Proactive user notifications
   - Smart timeout calculation based on patterns

2. **Self-Healing System**
   - Automatic webhook retry
   - Fallback polling mechanism
   - Distributed batch processing

3. **Advanced Analytics**
   - Search completion funnel analysis
   - Webhook performance dashboards
   - User behavior patterns

---

## Conclusion

This two-layer approach provides:

1. **Immediate user control** via manual force complete button
2. **Automatic safety net** via conservative timeout monitoring
3. **Clear visibility** into search progress and stuck states
4. **Comprehensive logging** for debugging and improvements

**Expected Outcomes**:
- ✅ Zero searches permanently stuck
- ✅ <5 minute user wait before force complete option
- ✅ <2% manual intervention rate (most searches complete naturally)
- ✅ 100% of stuck searches resolved (manually or automatically)

---

## References

- [Webhook Improvements](./WEBHOOK-IMPROVEMENTS.md)
- [Pipeline Implementation](./PIPELINE_IMPLEMENTATION_COMPLETE.md)
- [Data Contracts](./DATA_CONTRACTS.md)
- [Testing Strategy](./TESTING_STRATEGY.md)

---

**Document Version**: 1.0
**Author**: System Analysis
**Review Status**: Pending Implementation
