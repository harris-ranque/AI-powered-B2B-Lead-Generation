# PostHog Analytics Integration - Implementation Guide

**Status**: 🟢 **Core Complete** - Infrastructure, user identification, and LLM analytics implemented
**Last Updated**: December 2025
**Priority**: High - Required for data-driven product decisions

---

## Table of Contents

1. [Overview](#overview)
2. [Completed Implementation](#completed-implementation)
3. [Remaining Work](#remaining-work)
4. [Testing & Validation](#testing--validation)
5. [Future Enhancements](#future-enhancements)
6. [Troubleshooting](#troubleshooting)

---

## Overview

PostHog is integrated for comprehensive product analytics, user behavior tracking, and data-driven decision making. This document outlines the current state and remaining work for complete implementation.

**Primary Goals**:
- Track complete user journey from sign-up to export
- Measure feature adoption and engagement
- Enable funnel analysis and conversion optimization
- Support A/B testing and experimentation
- Provide revenue attribution and churn analysis

---

## Completed Implementation

### ✅ Core Infrastructure (100%)

#### 1. **PostHog Provider Configuration**
**Location**: `apps/web/src/main.tsx`

```typescript
<PostHogProvider
  apiKey={import.meta.env.VITE_PUBLIC_POSTHOG_KEY}
  options={{
    api_host: posthogHost,
    // Snapshot defaults for configuration consistency
    defaults: '2025-11-30',
    // Create person profiles for identified users only (4x cheaper than 'always')
    person_profiles: 'identified_only',
    // Autocapture clicks, form submissions, etc.
    // Exception autocapture is controlled via project settings in PostHog dashboard
    autocapture: true,
    capture_pageview: true,
    capture_pageleave: true,
    persistence: 'localStorage+cookie',
    disable_session_recording: false,
    debug: import.meta.env.MODE === "development",
    respect_dnt: true,
  }}
>
  <App />
</PostHogProvider>
```

**Environment Variables** (set in Railway/local .env):
- `VITE_PUBLIC_POSTHOG_KEY`: Your PostHog project API key
- `VITE_PUBLIC_POSTHOG_HOST`: `https://us.i.posthog.com` (US cloud)

#### 2. **Centralized Analytics Hook**
**Location**: `apps/web/src/hooks/useAnalytics.ts`

**Features**:
- Type-safe event tracking with TypeScript interfaces
- Error handling to prevent tracking failures from breaking the app
- Development mode logging for debugging
- 30+ pre-built tracking methods

**Usage Example**:
```typescript
import { useAnalytics } from '@/hooks/useAnalytics';

const MyComponent = () => {
  const analytics = useAnalytics();

  const handleAction = () => {
    analytics.trackSearchCreated({
      search_id: searchId,
      source: 'google_maps',
      keywords: keywords,
      location: location,
      radius: radius,
    });
  };
};
```

#### 3. **Documentation**
**Location**: `CLAUDE.md` - PostHog Analytics Integration section

**Includes**:
- Event naming conventions
- User identification patterns
- All critical user flows
- Best practices and debugging

### ✅ User Identification (100%)

User identification happens in two places for complete coverage:

#### 1. **AuthAnalyticsProvider** (on sign-in/sign-out)
**Location**: `apps/web/src/components/providers/AuthAnalyticsProvider.tsx`

Handles initial identification when users sign in via Clerk:
```typescript
posthog.identify(
  currentUserId,
  // $set properties (updated on every identify)
  {
    email,
    name: [firstName, lastName].filter(Boolean).join(" "),
    firstName,
    lastName,
    createdAt: clerkUser.createdAt?.toISOString(),
  },
  // $set_once properties (only set if not already present)
  {
    first_seen: new Date().toISOString(),
    signup_method: clerkUser.externalAccounts?.[0]?.provider || "email",
  }
);
```

#### 2. **LeadEternityDashboard** (with Convex data)
**Location**: `apps/web/src/components/LeadEternityDashboard.tsx`

Updates user properties with Convex-specific data not available in Clerk:
```typescript
analytics.identifyUser(
  user._id,
  // $set properties - updated on every identify call
  {
    email: user.email,
    name: user.name,
    plan: user.plan || 'free',
    role: user.role || 'user',
    credits: user.credits || 0,
  },
  // $set_once properties - only set if not already present
  {
    first_seen: new Date().toISOString(),
  }
);
```

**Properties Tracked**:
- User ID, email, name
- Subscription plan (free/pro/enterprise)
- User role (user/admin)
- Current credit balance
- First seen timestamp (immutable)
- Signup method (immutable)

### ✅ Dashboard Navigation (100%)

**Location**: `apps/web/src/components/LeadEternityDashboard.tsx:359-366`

**Events Tracked**:
- `dashboard_tab_viewed` - Tab changes with full context

**Properties**:
- `tab`: Current tab name
- `from_tab`: Previous tab
- `plan`: User subscription plan
- `credits`: Current balance
- `active_searches`: Number of active searches

### ✅ Search Pipeline Events (75%)

#### Search Creation
**Location**: `apps/web/src/components/pipeline/LeadDiscoveryStage.tsx:376-384`

**Event**: `search_created`

**Properties**:
- `search_id`: Unique search identifier
- `source`: 'google_maps' | 'manual'
- `keywords`: Search keywords
- `location`: Search location
- `radius`: Search radius in miles
- `total_leads`: Requested lead count

#### Search Completion
**Location**: `apps/web/src/components/pipeline/PipelineOrchestrator.tsx:240-246`

**Event**: `search_completed`

**Properties**:
- `search_id`: Search identifier
- `total_leads`: Total leads discovered
- `enriched_count`: Leads with email enrichment
- `research_tier`: 'tavily' | 'perplexity'

#### Search Cancellation
**Location**: `apps/web/src/components/pipeline/PipelineOrchestrator.tsx:268-273`

**Event**: `search_cancelled`

**Properties**:
- `search_id`: Search identifier
- `total_leads`: Partial results
- `enriched_count`: Enriched count at cancellation

### ✅ Export/Download Events (100%)

**Location**: `apps/web/src/components/pipeline/ReviewExportStage.tsx:443-556`

**Events Tracked**:
- `export_initiated` - Export button clicked
- `export_completed` - File downloaded successfully
- `export_failed` - Export encountered error

**Properties**:
- `format`: 'csv'
- `lead_count`: Number of leads
- `has_emails`: Number of leads with emails
- `file_size_kb`: File size (completion only)

---

## Remaining Work

### 🔴 High Priority - Critical for Analytics

#### 1. Authentication Event Tracking

**Files to Modify**:
- `apps/web/src/components/auth/ClerkAuthWrapper.tsx`

**Events to Add**:
```typescript
// On successful sign up (after Clerk webhook confirms)
analytics.trackUserSignUp({
  method: 'email' | 'google' | 'github',
  plan: 'starter',
  referrer: document.referrer
});

// On successful sign in
analytics.trackUserSignIn({
  method: 'email' | 'google' | 'github'
});

// On sign out
analytics.trackUserSignOut();
```

**Implementation Notes**:
- Track sign-up method (email, OAuth provider)
- Capture referrer for attribution
- Track initial plan selection
- Add to Clerk's `onSignUpSuccess` and `onSignInSuccess` handlers

**Estimated Time**: 1-2 hours

#### 2. Credit & Billing Event Tracking

**Files to Modify**:
- `apps/web/src/hooks/useBilling.ts`
- `apps/web/src/components/CreditManager.tsx`

**Events to Add**:
```typescript
// Credit purchase flow
analytics.trackCreditPurchaseInitiated({
  amount: creditAmount,
  price: price,
  plan: user.plan
});

analytics.trackCreditPurchaseCompleted({
  amount: creditAmount,
  price: price,
  payment_method: 'stripe',
  new_balance: user.credits + creditAmount
});

analytics.trackCreditPurchaseFailed({
  amount: creditAmount,
  price: price,
  error_message: error.message
});

// Subscription changes
analytics.trackSubscriptionUpgraded({
  from_plan: currentPlan,
  to_plan: newPlan,
  billing_cycle: 'monthly' | 'annual'
});

// Low balance warning
analytics.trackCreditsDepletedWarning({
  credits: remainingCredits,
  threshold: warningThreshold
});
```

**Implementation Points**:
- Add to Stripe success/failure callbacks
- Track subscription plan changes
- Monitor low balance warnings
- Include payment method information

**Estimated Time**: 2-3 hours

#### 3. Onboarding Flow Tracking

**Files to Modify**:
- `apps/web/src/components/BusinessProfileWizard.tsx`
- `apps/web/src/components/LeadEternityDashboard.tsx` (skip detection)

**Events to Add**:
```typescript
// Wizard opened
analytics.trackOnboardingStarted({
  user_id: user._id,
  plan: user.plan
});

// Each step completed
analytics.trackOnboardingStepCompleted({
  step: stepName,
  step_number: stepIndex,
  time_spent_seconds: timeTaken
});

// Wizard completed
analytics.trackOnboardingCompleted({
  time_spent_seconds: totalTime,
  steps_completed: completedSteps.length
});

// User skipped onboarding
analytics.trackOnboardingSkipped({
  at_step: currentStep
});
```

**Implementation Points**:
- Track wizard open from localStorage check
- Monitor step progression and time spent
- Detect completion vs. skip
- Capture partial completion data

**Estimated Time**: 2-3 hours

---

### 🟡 Medium Priority - Enhanced Analytics

#### 4. Pipeline Stage Completion Events

**Files to Modify**:
- `apps/web/src/components/pipeline/EnrichmentStage.tsx`
- Pipeline stage components

**Events to Add**:
```typescript
analytics.trackPipelineStageCompleted({
  stage: 'discovery' | 'enrichment' | 'analysis',
  search_id: searchId,
  duration_seconds: stageDuration,
  leads_processed: leadCount
});
```

**Estimated Time**: 1-2 hours

#### 5. Settings & Configuration Changes

**Files to Modify**:
- `apps/web/src/components/Settings.tsx`
- `apps/web/src/components/settings/ProviderKeyManager.tsx`

**Events to Add**:
```typescript
analytics.trackSettingsUpdated({
  setting_type: 'profile' | 'api_keys' | 'preferences',
  changed_fields: ['field1', 'field2']
});
```

**Estimated Time**: 1 hour

#### 6. Help Widget & Support

**Files to Modify**:
- `apps/web/src/components/DashboardHelpWidget.tsx`

**Events to Add**:
```typescript
analytics.trackHelpWidgetOpened({
  context: currentPage,
  user_question: questionText
});
```

**Estimated Time**: 30 minutes

---

### 🟢 Low Priority - Nice to Have

#### 7. Research Tier Selection

**Track when users choose Tavily vs Perplexity research**:
```typescript
analytics.captureEvent('research_tier_selected', {
  tier: 'tavily' | 'perplexity',
  lead_count: leads.length,
  previous_tier: previousSelection
});
```

#### 8. Error Events (Beyond Auto-Capture)

**Track specific application errors**:
```typescript
analytics.trackOperationFailed({
  operation: 'search_creation',
  error_type: error.name,
  error_message: error.message,
  context: { /* relevant context */ }
});
```

#### 9. Performance Metrics

**Track critical performance indicators**:
```typescript
analytics.trackSearchPerformance({
  search_id: searchId,
  duration_ms: duration,
  lead_count: totalLeads,
  leads_per_second: rate,
  research_tier: tier
});
```

---

## Testing & Validation

### Development Testing

#### 1. Enable Debug Mode
Debug mode is automatically enabled in development (see `main.tsx`).

**Check Console**:
```
📊 PostHog Event: search_created { search_id: "...", ... }
👤 PostHog Identify: user123 { email: "...", plan: "pro" }
```

#### 2. Test Critical Flows

**Authentication Flow**:
1. Sign up with new account → Check for `user_signed_up` event
2. Sign out → Check for `user_signed_out` event
3. Sign in → Check for `user_signed_in` event

**Search Pipeline**:
1. Create search → Check for `search_created` event
2. Wait for completion → Check for `search_completed` event
3. Cancel mid-search → Check for `search_cancelled` event

**Export Flow**:
1. Click export → Check for `export_initiated` event
2. Download completes → Check for `export_completed` event
3. Trigger export error → Check for `export_failed` event

**Navigation**:
1. Switch tabs → Check for `dashboard_tab_viewed` events
2. Verify `from_tab` and `tab` properties

#### 3. Property Validation

Verify all events include:
- Required properties (no undefined/null)
- Correct data types (numbers as numbers, not strings)
- Consistent naming (snake_case)
- Meaningful values (not placeholder data)

### Production Validation

#### PostHog Dashboard Checks

**Activity Tab**:
1. Navigate to https://us.posthog.com
2. Select "Genni Lead Generation Platform" project
3. Go to Activity → Live Events
4. Verify events are flowing in real-time

**User Properties**:
1. Go to Persons → Recent persons
2. Click on a user
3. Verify properties are populated:
   - Email, name, plan, role, credits
   - First seen timestamp

**Event Volume**:
- Check daily active users (DAU)
- Verify event counts match expected traffic
- Monitor error rate in events

#### Funnel Analysis Setup

**Activation Funnel**:
1. Event: `user_signed_up`
2. Event: `onboarding_completed`
3. Event: `search_created`
4. Event: `export_completed`

**Expected Conversion Rates** (initial benchmarks):
- Sign up → Onboarding complete: 60-70%
- Onboarding → First search: 80-90%
- First search → First export: 70-80%

---

## ✅ LangGraph Worker Integration (Implemented)

### PostHog LLM Analytics

**Location**: `apps/langgraph-worker/app/utils/analytics.py`

The LangGraph worker now has full PostHog integration for tracking LLM calls and API usage.

#### LangChain Callback Handler

```python
from posthog.ai.langchain import CallbackHandler

def create_llm_callback_handler(
    distinct_id: Optional[str] = None,
    trace_id: Optional[str] = None,
    properties: Optional[Dict[str, Any]] = None,
) -> Optional[Any]:
    """
    Create PostHog LangChain callback handler for LLM analytics.
    Automatically captures: tokens, cost, latency, inputs/outputs, trace hierarchies.
    """
    return CallbackHandler(
        api_key=client.api_key,
        host=client.host,
        distinct_id=distinct_id or "langgraph-worker",
        trace_id=trace_id,
        properties=full_properties,
        privacy_mode=False,  # Full visibility for debugging
    )
```

#### API Call Tracking

All external API calls are tracked with the `APICallTracker` context manager:

```python
async with track_perplexity_sonar_call(
    company_name=company_name,
    request_id=request_id,
    domain=domain,
) as tracker:
    result = await perplexity_client.research(...)
    tracker.set_result(
        success=True,
        word_count=len(content.split()),
        citation_count=len(citations),
    )
```

**Tracked APIs**:
- `track_tavily_call()` - Tavily search API
- `track_perplexity_sonar_call()` - Perplexity Sonar Pro
- `track_perplexity_deep_research_call()` - Perplexity Deep Research
- `track_google_maps_call()` - Google Maps API
- `track_openai_call()` - Direct OpenAI calls

**Events Generated**:
- `api_{name}_started` - When call begins
- `api_{name}_completed` - Success with duration_ms, metrics
- `api_{name}_error` - Failure with error details

#### Agent LLM Tracking

Each agent (BI, Email Gen, QA) passes the callback to LLM invocations:

```python
llm_callback = state.get("llm_callback")
callbacks = [llm_callback] if llm_callback else []

result = await llm.ainvoke(
    messages,
    config={"callbacks": callbacks}  # PostHog captures tokens, cost, latency
)
```

**Automatic Metrics Captured**:
- Input/output tokens
- Cost calculation based on model pricing
- Response latency
- Full prompt and response (for debugging)
- Trace hierarchy (groups related LLM calls)

---

## Future Enhancements

### A/B Testing Research Tiers

**Experiment Setup**:
- Control group: Tavily (fast, lower cost)
- Test group: Perplexity (comprehensive, higher cost)

**Success Metrics**:
- Email relevance scores
- User export rate
- Search completion rate
- User retention

**PostHog Experiment Configuration**:
```typescript
const researchTier = posthog.getFeatureFlag('research_tier_experiment');

if (researchTier === 'perplexity') {
  // Use Perplexity for comprehensive research
} else {
  // Use Tavily for fast research
}
```

---

## Troubleshooting

### Events Not Appearing in PostHog

**Check 1: PostHog Initialization**
- Verify `VITE_PUBLIC_POSTHOG_KEY` is set correctly
- Check browser console for PostHog errors
- Confirm PostHog provider wraps entire app

**Check 2: Event Capture**
```typescript
// Verify analytics hook is being called
if (import.meta.env.MODE === 'development') {
  console.log('Analytics hook initialized:', analytics);
}
```

**Check 3: Network Requests**
- Open DevTools → Network tab
- Filter by "posthog.com"
- Verify POST requests to `/e/` endpoint
- Check for CORS or network errors

### User Identification Not Working

**Symptom**: Events appear as anonymous users in PostHog

**Solution**:
1. Check user object has valid `_id`
2. Verify `identifyUser` is called after authentication
3. Check user properties are not undefined
4. Confirm PostHog is initialized before identify call

### Events Missing Properties

**Symptom**: Properties show as undefined in PostHog

**Solution**:
1. Log properties before capture in development:
```typescript
if (import.meta.env.MODE === 'development') {
  console.log('Event properties:', properties);
}
```
2. Ensure all required data is loaded before tracking
3. Use optional chaining for nested properties
4. Provide default values for optional properties

### Development vs Production Differences

**Issue**: Events work in dev but not production

**Checks**:
1. Environment variables deployed to production
2. Content Security Policy allows PostHog
3. Ad blockers not blocking PostHog
4. HTTPS configured correctly

---

---

## Success Metrics

**After Full Implementation, Track**:

**Activation Funnel**:
- Sign up → First search → First export conversion rate
- Time to first value (sign up to first export)
- Onboarding completion rate

**Engagement Metrics**:
- Daily/Weekly/Monthly Active Users (DAU/WAU/MAU)
- Searches per user
- Average leads per search
- Export rate (searches with exports / total searches)

**Revenue Metrics**:
- Credit purchase conversion rate
- Subscription upgrade rate
- Average revenue per user (ARPU)
- Customer lifetime value (LTV)

**Product Health**:
- Search success rate
- Enrichment success rate (emails found / leads discovered)
- Time spent in each pipeline stage
- Feature adoption rates

**AI Performance** (Future):
- LLM token usage and cost per search
- Research tier quality comparison
- Agent decision quality scores
- User satisfaction correlation with AI performance

---

## Resources

**PostHog Dashboard**: https://us.posthog.com
**PostHog Docs**: https://posthog.com/docs
**LangChain Integration**: https://posthog.com/docs/libraries/langchain
**Event Naming Guide**: https://posthog.com/docs/data/events#event-naming

**Internal Documentation**:
- `CLAUDE.md` - PostHog Analytics Integration section
- `apps/web/src/hooks/useAnalytics.ts` - Centralized tracking hook
- This document - Complete implementation guide

---

## Support & Questions

For questions or issues:
1. Check this documentation first
2. Review PostHog docs for platform-specific issues
3. Check browser console for debug output
4. Review PostHog dashboard for event flow

**PostHog Integration Status**: 🟢 **Core Complete** - Frontend infrastructure, user identification, and LLM analytics implemented

**Next Milestone**: Complete onboarding flow tracking and credit/billing events for full conversion funnel visibility.
