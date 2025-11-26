# API Error Handling Implementation Plan

## Overview

Implement a comprehensive system to detect credit/quota/auth errors from all external API providers (Perplexity, OpenAI, Tavily, Google Maps, FindyMail) and automatically notify users with actionable messages via webhooks and real-time UI.

## Phase 1: Core Error Detection System (LangGraph Worker)

### 1.1 Create Error Detection Module

**File:** `apps/langgraph-worker/app/utils/api_error_detector.py`

**Purpose:** Detect and classify API errors across all providers

**Key Components:**
- `APIProvider` enum: perplexity, openai, tavily, google_maps, findymail
- `ErrorType` enum: credits_exhausted, quota_exceeded, rate_limit, auth_invalid, model_access_denied, etc.
- `APIErrorDetails` dataclass: Complete error information for user notification
- `APIErrorDetector` class: Pattern-based detection using regex

**Detection Logic:**
```python
# HTTP status first (most reliable)
401 + "credit" patterns → CREDITS_EXHAUSTED
401 + no credit patterns → AUTH_INVALID
403 + "model" patterns → MODEL_ACCESS_DENIED
429 → RATE_LIMIT
500-599 → SERVER_ERROR

# Provider detection from error message
"perplexity|pplx-|sonar-" → PERPLEXITY
"openai|gpt-|sk-" → OPENAI
"tavily" → TAVILY
```

**User Message Generation:**
- Provider-specific guidance with actionable links
- Cost estimates for credit-based errors
- Clear action required statements

**Estimated Time:** 2-3 hours

---

### 1.2 Create Webhook Notification Module

**File:** `apps/langgraph-worker/app/utils/api_error_notifier.py`

**Purpose:** Send error notifications to Convex via webhooks

**Key Components:**
- `APIErrorNotifier` class: Handles error analysis and webhook delivery
- `notify_api_error()` helper function: Easy integration point
- Retry logic with exponential backoff
- Webhook URL construction for error endpoint

**Integration Pattern:**
```python
try:
    result = await perplexity_client.deep_research(...)
except Exception as e:
    error_details = await notify_api_error(
        webhook_client=webhook_client,
        error=e,
        request_id=request_id,
        http_status=response.status,
        provider="perplexity",
        lead_id=lead_id
    )
    # Use error_details.user_message for user-facing error
```

**Estimated Time:** 2 hours

---

### 1.3 Integrate into Research Clients

**Files to Modify:**
- `apps/langgraph-worker/app/utils/research_clients.py`
- `apps/langgraph-worker/app/langgraph/nodes/business_intelligence_agent.py`
- `apps/langgraph-worker/app/langgraph/nodes/email_generation_agent.py`
- `apps/langgraph-worker/app/langgraph/nodes/quality_assurance_agent.py`

**Changes Required:**

**1. Add webhook_client parameter to constructors:**
```python
class PerplexityClient:
    def __init__(self, api_key: Optional[str] = None, webhook_client: Optional[WebhookClient] = None):
        self.webhook_client = webhook_client
        # ...

class TavilyClient:
    def __init__(self, api_key: Optional[str] = None, webhook_client: Optional[WebhookClient] = None):
        self.webhook_client = webhook_client
        # ...

class ResearchOrchestrator:
    def __init__(self, webhook_client: Optional[WebhookClient] = None):
        self.webhook_client = webhook_client
        self.perplexity_client = PerplexityClient(webhook_client=webhook_client)
        self.tavily_client = TavilyClient(webhook_client=webhook_client)
        # ...
```

**2. Replace error handling in PerplexityClient.deep_research():**
```python
# Line ~638-640: Replace
if response.status != 200:
    error_text = await response.text()
    raise Exception(f"Perplexity Deep Research API error {response.status}: {error_text}")

# With:
if response.status != 200:
    error_text = await response.text()
    error = Exception(f"Perplexity Deep Research API error {response.status}: {error_text}")

    if self.webhook_client:
        error_details = await notify_api_error(
            webhook_client=self.webhook_client,
            error=error,
            request_id=company_name,
            http_status=response.status,
            provider="perplexity",
            operation="deep_research"
        )
        # Return user-friendly error
        return ResearchResult(
            query=company_name,
            tier=ResearchTier.PERPLEXITY,
            confidence_score=0.2,
            response_time=time.time() - start_time,
            error=error_details.user_message
        )
    raise error
```

**3. Similar updates for:**
- `PerplexityClient.comprehensive_research()` (line ~450-500)
- `TavilyClient.search()` (line ~90-150)
- All OpenAI calls in agent nodes

**Estimated Time:** 4-5 hours

---

### 1.4 Add OpenAI Error Handling

**Files to Modify:**
- `apps/langgraph-worker/app/langgraph/nodes/business_intelligence_agent.py` (~line 336-400)
- `apps/langgraph-worker/app/langgraph/nodes/email_generation_agent.py`
- `apps/langgraph-worker/app/langgraph/nodes/quality_assurance_agent.py`

**Pattern:**
```python
from openai import OpenAIError, RateLimitError, AuthenticationError

try:
    response = await client.chat.completions.create(...)
except AuthenticationError as e:
    error_details = await notify_api_error(
        webhook_client=webhook_client,
        error=e,
        request_id=state.get("request_id"),
        http_status=401,
        provider="openai",
        operation="chat_completion"
    )
    raise Exception(error_details.user_message)
except RateLimitError as e:
    error_details = await notify_api_error(
        webhook_client=webhook_client,
        error=e,
        request_id=state.get("request_id"),
        http_status=429,
        provider="openai",
        operation="chat_completion"
    )
    # Potentially retry with backoff
    raise Exception(error_details.user_message)
```

**Estimated Time:** 3-4 hours

---

## Phase 2: Convex Backend Integration

### 2.1 Schema Updates

**File:** `apps/convex-backend/convex/schema.ts`

**Add new table:**
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

**Update searches table (optional):**
```typescript
searches: defineTable({
  // ... existing fields
  errorMessage: v.optional(v.string()),
  errorProvider: v.optional(v.string()),
  errorType: v.optional(v.string()),
})
```

**Deploy:**
```bash
cd apps/convex-backend
npx convex deploy
```

**Estimated Time:** 30 minutes

---

### 2.2 Create Internal Functions

**File:** `apps/convex-backend/convex/langgraph/apiErrors.ts` (new file)

**Functions:**
```typescript
// Internal mutations/queries
export const recordApiError = internalMutation({ ... })
export const getRecentApiErrors = internalQuery({ ... })
export const acknowledgeApiError = internalMutation({ ... })
export const getApiErrorStats = internalQuery({ ... })
```

**Key Logic:**
1. Store error in database
2. Get userId from leadId or searchId
3. Broadcast real-time notification if user-fixable
4. Update search/lead status

**Estimated Time:** 2 hours

---

### 2.3 Add Webhook Endpoint

**File:** `apps/convex-backend/convex/http.ts` (modify existing)

**Add route:**
```typescript
http.route({
  path: "/webhooks/langgraph/api-error",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // 1. Validate signature & auth
    // 2. Parse payload
    // 3. Call internal.langgraph.apiErrors.recordApiError
    // 4. Return success
  })
})
```

**Security:**
- Verify `Authorization: Bearer LANGGRAPH_API_KEY`
- Validate webhook signature (X-Webhook-Signature)
- Rate limiting (use existing middleware)

**Estimated Time:** 1-2 hours

---

## Phase 3: Frontend Display

### 3.1 Create Error Banner Component

**File:** `apps/web/src/components/ApiErrorBanner.tsx` (new)

**Features:**
- Query recent unacknowledged errors
- Display with provider icon and severity
- Action button (opens provider dashboard)
- Dismiss button (acknowledges error)
- Show estimated cost if available

**Usage:**
```tsx
// In GenniApp.tsx or Dashboard.tsx
<ApiErrorBanner userId={user.id} />
```

**Estimated Time:** 2 hours

---

### 3.2 Real-time Toast Notifications

**File:** `apps/web/src/components/GenniApp.tsx` (modify)

**Add subscription:**
```tsx
useEffect(() => {
  const unsubscribe = subscribeToRealtimeBroadcasts((message) => {
    if (message.type === "api_error") {
      toast.error(message.userMessage, {
        description: message.actionRequired,
        action: message.estimatedCost ? {
          label: `Add $${message.estimatedCost}`,
          onClick: () => window.open(getProviderUrl(message.provider), '_blank')
        } : undefined,
        duration: 10000,
      });
    }
  });
  return unsubscribe;
}, []);
```

**Estimated Time:** 1 hour

---

### 3.3 Admin Dashboard Integration

**File:** `apps/web/src/components/AdminDashboard.tsx` (modify)

**Add section:**
- API Error Statistics card
- Chart showing errors by provider (last 7/30 days)
- Table of recent errors with details
- Estimated cost impact

**Query:**
```tsx
const errorStats = useQuery(api.langgraph.apiErrors.getApiErrorStats, {
  startDate: Date.now() - 7 * 24 * 60 * 60 * 1000
});
```

**Estimated Time:** 2-3 hours

---

## Phase 4: Testing & Validation

### 4.1 Unit Tests

**File:** `apps/langgraph-worker/tests/test_api_error_detector.py` (new)

**Test Cases:**
- Provider detection from various error messages
- Error type classification (401, 429, 403, etc.)
- User message generation for each provider/type
- Cost estimation accuracy

**Estimated Time:** 2 hours

---

### 4.2 Integration Tests

**Create test script:** `apps/langgraph-worker/tests/test_error_integration.py`

**Test scenarios:**
1. **Perplexity 401 (Credits Exhausted)**
   - Mock response with 401 + credit message
   - Verify webhook sent with correct data
   - Check user message accuracy

2. **OpenAI 429 (Rate Limit)**
   - Mock RateLimitError
   - Verify retry recommended
   - Check webhook delivery

3. **Tavily Auth Error**
   - Mock 401 unauthorized
   - Verify error classification
   - Check notification sent

**Estimated Time:** 3 hours

---

### 4.3 End-to-End Testing

**Manual test plan:**

1. **Setup:**
   - Deploy LangGraph worker with error handling
   - Deploy Convex backend with webhook endpoint
   - Deploy frontend with banner component

2. **Test Perplexity Credit Exhaustion:**
   ```bash
   # Remove credits from Perplexity account or use invalid key
   # Trigger research operation
   # Verify:
   - Webhook received in Convex
   - Error stored in apiErrors table
   - Real-time notification broadcast
   - Toast appears in frontend
   - Banner shows error with action
   ```

3. **Test OpenAI Rate Limit:**
   ```bash
   # Make rapid API calls to trigger 429
   # Verify same flow as above
   ```

4. **Test Error Acknowledgment:**
   ```bash
   # Click dismiss on banner
   # Verify error marked as acknowledged
   # Verify banner disappears
   ```

5. **Test Admin Dashboard:**
   ```bash
   # Generate multiple errors from different providers
   # Check admin stats are correct
   # Verify charts and tables display properly
   ```

**Estimated Time:** 4 hours

---

## Phase 5: Documentation & Deployment

### 5.1 Documentation

**Create:** `docs/LANGGRAPH_ERROR_HANDLING.md`

**Sections:**
- Overview and architecture
- Integration guide for new API calls
- Error type reference
- Troubleshooting common issues
- Monitoring and alerts setup

**Estimated Time:** 2 hours

---

### 5.2 Deployment Checklist

**Pre-deployment:**
- [ ] All unit tests passing
- [ ] Integration tests passing
- [ ] Code review completed
- [ ] Environment variables set in Railway
  - `PERPLEXITY_API_KEY` has credits
  - `OPENAI_API_KEY` is valid
  - `LANGGRAPH_API_KEY` configured
- [ ] Convex schema deployed

**Deployment sequence:**
1. Deploy Convex backend (schema + webhook)
2. Verify webhook endpoint works (curl test)
3. Deploy LangGraph worker
4. Deploy frontend
5. Monitor first few operations

**Rollback plan:**
- Disable webhook endpoint in Convex
- Revert LangGraph worker to previous version
- Errors will be logged but not broadcast

**Estimated Time:** 2 hours

---

## Total Time Estimate

| Phase | Tasks | Time |
|-------|-------|------|
| Phase 1 | Worker error detection (4 tasks) | 11-14 hours |
| Phase 2 | Convex backend (3 tasks) | 3.5-4.5 hours |
| Phase 3 | Frontend display (3 tasks) | 5-6 hours |
| Phase 4 | Testing (3 tasks) | 9 hours |
| Phase 5 | Docs & deployment (2 tasks) | 4 hours |
| **Total** | | **32.5-37.5 hours** |

**Recommended Sprint:** 5-6 working days (1 week)

---

## Priority Order (If Time-Constrained)

### Must-Have (MVP):
1. Phase 1.1-1.2: Core detection + notification (4-5 hours)
2. Phase 1.3: Perplexity integration only (2 hours)
3. Phase 2.1-2.3: Backend webhook (4 hours)
4. Phase 3.2: Real-time toasts (1 hour)
5. Phase 4.3: Manual E2E test (2 hours)

**MVP Total:** ~13 hours (2 days)

### Nice-to-Have:
- OpenAI error handling
- Banner component
- Admin dashboard
- Comprehensive testing

---

## Success Criteria

✅ **User receives clear notification when Perplexity credits exhausted**
✅ **User knows exact action to take (add $X at URL)**
✅ **Admin can monitor API error trends**
✅ **System handles all provider errors gracefully**
✅ **No user sees technical error messages (401, JSON, etc.)**
✅ **Zero webhook delivery failures in first 100 errors**

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Webhook delivery failures | Retry with exponential backoff, log failures for manual review |
| False positive detection | Strict pattern matching, fallback to generic messages |
| Performance impact | Async webhooks, don't block main operations |
| User notification fatigue | Acknowledge system, rate limit similar errors |
| Provider API changes | Regular pattern testing, generic fallbacks |

---

## Current Status: NOT STARTED

**Last Updated:** January 2025

**Blocked By:** Perplexity API credits need to be added for production testing

**Next Steps:**
1. Add credits to Perplexity account (minimum $10 recommended)
2. Verify all API keys are valid and have sufficient quotas
3. Begin Phase 1.1 implementation

---

## Implementation Notes

### Discovered During Planning

**Perplexity API Issue (January 2025):**
- Current API key `[REDACTED-API-KEY]` has $0 balance
- Both `sonar-pro` and `sonar-deep-research` models return 401 errors
- Fix: Add credits at https://sonar.perplexity.ai/settings/api
- Recommended: $10-20 initial credit + enable auto-top-up at $2 threshold

**Error Detection Patterns Validated:**
- 401 errors can indicate either credits exhausted OR invalid auth
- Need to check error message content for "credit" keywords to differentiate
- Perplexity's error messages include HTML responses from Cloudflare
- Need robust HTML stripping and content extraction

---

## Questions & Decisions

### Open Questions
- [ ] Should we implement rate limiting on error notifications to prevent spam?
- [ ] What should be the retry strategy for rate limit errors (429)?
- [ ] Should admin receive email alerts for critical API errors?
- [ ] How long should error records be retained in the database?

### Decisions Made
- ✅ Use webhook-based notification (not polling)
- ✅ Store all errors for analytics (not just user-fixable)
- ✅ Implement real-time toasts + persistent banner
- ✅ Admin dashboard shows aggregated stats
- ✅ Errors expire from real-time broadcast after 24 hours

---

## Related Documentation

- [LangGraph Worker Architecture](../README.md)
- [Convex Backend Schema](../../convex-backend/convex/schema.ts)
- [Real-time Broadcasting System](../../convex-backend/convex/realtime/README.md)
- [Webhook System](../app/utils/webhook.py)

---

## Contact

For questions about this implementation plan, contact the development team or refer to the project README.
