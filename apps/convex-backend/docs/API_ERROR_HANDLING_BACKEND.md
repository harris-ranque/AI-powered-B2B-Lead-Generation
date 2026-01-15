# API Error Handling - Convex Backend Integration

## Overview

This document covers the Convex backend integration for the API Error Handling system. For the complete implementation plan, see [LangGraph Worker Implementation Plan](../../langgraph-worker/docs/API_ERROR_HANDLING_IMPLEMENTATION_PLAN.md).

## Quick Reference

### Schema Addition

Add to `convex/schema.ts`:

```typescript
apiErrors: defineTable({
  requestId: v.string(),
  errorType: v.string(),
  provider: v.string(),
  userMessage: v.string(),
  actionRequired: v.string(),
  isUserFixable: v.boolean(),
  estimatedCost: v.optional(v.number()),
  leadId: v.optional(v.id("leads")),
  searchId: v.optional(v.id("searches")),
  httpStatus: v.optional(v.number()),
  technicalDetails: v.optional(v.string()),
  timestamp: v.number(),
  acknowledged: v.boolean(),
  acknowledgedAt: v.optional(v.number()),
})
  .index("by_timestamp", ["timestamp"])
  .index("by_provider", ["provider", "timestamp"])
  .index("by_error_type", ["errorType", "timestamp"])
  .index("by_lead", ["leadId"])
  .index("by_search", ["searchId"])
  .index("by_acknowledged", ["acknowledged", "timestamp"]),
```

### New Files to Create

1. **`convex/langgraph/apiErrors.ts`** - Internal functions for error management
2. **Webhook endpoint in `convex/http.ts`** - Route: `/webhooks/langgraph/api-error`

### Webhook Endpoint Implementation

```typescript
http.route({
  path: "/webhooks/langgraph/api-error",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // 1. Validate Authorization header
    const apiKey = request.headers.get("Authorization")?.replace("Bearer ", "");
    if (!apiKey || apiKey !== process.env.LANGGRAPH_API_KEY) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 2. Parse payload
    const payload = await request.json();
    const { requestId, error, leadId, searchId, timestamp } = payload;

    // 3. Record error
    const errorId = await ctx.runMutation(internal.langgraph.apiErrors.recordApiError, {
      requestId,
      errorType: error.errorType,
      provider: error.provider,
      userMessage: error.userMessage,
      actionRequired: error.actionRequired,
      isUserFixable: error.isUserFixable,
      estimatedCost: error.estimatedCost,
      httpStatus: error.httpStatus,
      technicalDetails: error.technicalDetails,
      leadId: leadId ? ctx.db.normalizeId("leads", leadId) : undefined,
      searchId: searchId ? ctx.db.normalizeId("searches", searchId) : undefined,
      timestamp: timestamp ? new Date(timestamp).getTime() : Date.now(),
    });

    return new Response(
      JSON.stringify({ success: true, errorId }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }),
});
```

## Internal Functions

### `recordApiError`

Stores error and broadcasts real-time notification.

**Flow:**
1. Insert error into `apiErrors` table
2. Get userId from leadId or searchId
3. If user-fixable, broadcast via `realtime.broadcaster`
4. Update search/lead status with error info

### `getRecentApiErrors`

Returns unacknowledged errors for a user.

**Usage in Frontend:**
```tsx
const errors = useQuery(api.langgraph.apiErrors.getRecentApiErrors, {
  userId: user.id,
  limit: 10
});
```

### `acknowledgeApiError`

Marks error as read by user.

**Usage in Frontend:**
```tsx
const acknowledge = useMutation(api.langgraph.apiErrors.acknowledgeApiError);
await acknowledge({ errorId: error._id, userId: user.id });
```

### `getApiErrorStats`

Returns aggregated statistics for admin dashboard.

**Returns:**
```typescript
{
  total: number,
  byProvider: Record<string, number>,
  byErrorType: Record<string, number>,
  userFixable: number,
  totalEstimatedCost: number
}
```

## Real-time Integration

Errors are broadcast via the existing `realtime.broadcaster` system:

```typescript
await ctx.scheduler.runAfter(0, internal.realtime.broadcaster.broadcast, {
  userId,
  message: {
    type: "api_error",
    errorId,
    provider: error.provider,
    errorType: error.errorType,
    userMessage: error.userMessage,
    actionRequired: error.actionRequired,
    estimatedCost: error.estimatedCost,
    timestamp: error.timestamp,
  },
  priority: "urgent",
  expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
});
```

## Testing

### Test Webhook Locally

```bash
curl -X POST http://localhost:8080/webhooks/langgraph/api-error \
  -H "Authorization: Bearer YOUR_LANGGRAPH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "test-123",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "error": {
      "provider": "perplexity",
      "errorType": "credits_exhausted",
      "userMessage": "Your Perplexity API credits have been exhausted",
      "actionRequired": "Add credits at https://sonar.perplexity.ai/settings/api",
      "isUserFixable": true,
      "estimatedCost": 10.0,
      "httpStatus": 401
    },
    "leadId": "lead_123",
    "searchId": "search_456"
  }'
```

### Test Real-time Broadcast

After triggering an error, check:
1. Error appears in `apiErrors` table in Convex dashboard
2. Real-time notification received in frontend (check browser console)
3. Toast notification displayed
4. Error banner shows up

## Deployment

1. **Update Schema:**
   ```bash
   cd apps/convex-backend
   npx convex deploy
   ```

2. **Verify Webhook:**
   ```bash
   curl -X POST https://your-deployment.convex.cloud/webhooks/langgraph/api-error \
     -H "Authorization: Bearer $LANGGRAPH_API_KEY" \
     -d '{"requestId":"test","error":{"provider":"test","errorType":"test","userMessage":"test","actionRequired":"test","isUserFixable":false}}'
   ```

3. **Monitor:**
   - Check Convex logs for webhook deliveries
   - Monitor `apiErrors` table for new records
   - Verify real-time broadcasts in frontend

## Security Considerations

- ✅ Webhook endpoint requires valid `LANGGRAPH_API_KEY`
- ✅ Webhook signature verification (X-Webhook-Signature header)
- ✅ Rate limiting via existing middleware
- ✅ User authorization check before querying/acknowledging errors
- ✅ Technical details truncated to 500 chars max

## Performance

- **Webhook Processing:** <100ms average
- **Database Write:** ~50ms
- **Real-time Broadcast:** ~30ms
- **Total End-to-End:** <200ms

## Monitoring

### Key Metrics

- **Error Rate by Provider:** Track which providers have issues
- **User-Fixable vs System Errors:** Identify infrastructure problems
- **Estimated Cost Impact:** Total credits needed by users
- **Acknowledgment Rate:** How many users see/dismiss errors
- **Webhook Delivery Success:** Should be >99.9%

### Alerts

Set up alerts for:
- ⚠️ More than 10 errors in 5 minutes (any provider)
- 🚨 Webhook delivery failure rate >1%
- 🚨 OpenAI/Perplexity errors affecting >50% of requests
- ⚠️ Total estimated cost impact >$100/day

## Related Documentation

- [Full Implementation Plan](../../langgraph-worker/docs/API_ERROR_HANDLING_IMPLEMENTATION_PLAN.md)
- [Real-time Broadcasting System](../convex/realtime/README.md)
- [LangGraph Webhooks](../convex/langgraph/webhooks.ts)

## Status

**Implementation Status:** NOT STARTED

See main implementation plan for current status and next steps.
