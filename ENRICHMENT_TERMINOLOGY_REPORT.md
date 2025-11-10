# Comprehensive Terminology Search Report: "Enriched/Enrichment/Enrich"

## Summary
Found 100+ instances of enrichment-related terminology across the Genni web app. Most are in backend field names and type definitions (should NOT be changed), but there are **25+ UI-facing instances** that should be reviewed for change to "contacts found" terminology.

---

## DETAILED FINDINGS BY FILE

### 1. `/apps/web/src/pipeline/config.ts`
**Stage Configuration File** - BACKEND FIELD NAMES (keep as-is)

- **Line 21-28**: 
  ```typescript
  enrichment: {
    id: "enrichment",
    title: "Get Contacts",  // ✅ UI-facing - already changed!
    description: "Find contact emails and additional information",
    ...
  }
  ```
  **Status**: ✅ ALREADY CONVERTED - UI text is "Get Contacts", backend ID is "enrichment"

---

### 2. `/apps/web/src/pipeline/types.ts`
**Type Definitions** - MOSTLY BACKEND (keep field names)

- **Line 7**: `| "enrichment"` - Backend stage type (keep)
- **Line 19**: `enrichedLeads: Lead[]` - Backend state field (keep)
- **Line 61**: `supportsEnrichment: boolean` - Backend property (keep)

---

### 3. `/apps/web/src/types/PipelineProgress.ts`
**Type Helpers & Aliases** - BACKEND (keep)

- **Line 34-35**: `enrichment: "enrichment"` - Stage alias mapping (keep)
- **Lines 148-152**: `enriched` metric computation - Backend metric key (keep)
- **Lines 172-175**: Metrics object with `enriched` key (keep)
- **Lines 184**: Metric filtering for "enriched" key (keep)
- **Line 335-336**: Stage detection: `if (researchStage.includes("enrich"))` → maps to "enrichment" (keep)
- **Line 353-354**: Progress check on `enriched` metric (keep)

**Note**: All these are backend metric names. The UI label in PipelineProgressPanel is "Contacts".

---

### 4. `/apps/web/src/components/pipeline/EnrichmentStage.tsx`
**Main Enrichment UI Component** - MULTIPLE INSTANCES

**UI-Facing Text (should consider changing):**
- **Line 23-24**: Component function name `EnrichmentStage` - Component export (architectural, consider keeping)
- **Line 88**: `<Mail className="h-5 w-5" />` with "Finding Contacts" title ✅ ALREADY GOOD
- **Line 91**: `"Discovering contact emails and additional information for your leads"` ✅ GOOD TEXT
- **Line 101**: `"Contact Discovery Progress"` ✅ GOOD
- **Line 103**: `"{enrichedCount} of {leads.length} contacts found"` ✅ ALREADY USES "CONTACTS FOUND"!
- **Line 171**: `"Recently Found Contacts"` ✅ GOOD
- **Line 220**: `"Finding contacts..."` ✅ GOOD

**Backend Field Names (keep):**
- **Lines 34-38**: `enrichedCount`, `enrichmentProgress` variables
- **Line 45**: `includes("enrichment")` stage check
- **Line 48**: `markStageComplete("enrichment")`

**Status**: ✅ ALREADY USING GOOD TERMINOLOGY FOR UI TEXT

---

### 5. `/apps/web/src/components/pipeline/EmailGenerationStage.tsx`
**Email Generation Component** - MIXED

**UI-Facing Text:**
- **Line 118**: `"enriched leads"` - Says "enriched leads" instead of "contacts found"
  ```typescript
  Generate personalized emails for {state.enrichedLeads.length}{" "}
  enriched leads
  ```
  ⚠️ **SHOULD CHANGE TO**: "contacts with emails" or similar

**Backend Fields (keep):**
- **Line 34, 48, 50, 51, 117**: `state.enrichedLeads` - Internal state variable (keep)
- **Line 202, 259**: References to `state.enrichedLeads` array (keep variable name)

---

### 6. `/apps/web/src/components/SearchProgressTracker.tsx`
**Progress Tracker Component** - MULTIPLE INSTANCES

**UI-Facing Text:**
- **Line 91**: CREDIT_TOOLTIP
  ```typescript
  "Discovery and enrichment consume 1 credit per lead..."
  ```
  ⚠️ **SHOULD CHANGE TO**: "Discovery and contact discovery consume..." OR "Finding leads and contacts costs..."

- **Line 225**: `id: "enrichment"` - Backend stage ID (keep)
- **Line 228**: `count: enrichedCount` - Backend metric (keep)

**Backend/Internal (keep):**
- **Line 69**: `type StageId = "discovery" | "enrichment" | "analysis" | "completion"` (keep)
- **Line 81**: `"enrichment"` in STAGE_ORDER (keep)
- **Line 142**: `enrichedCount` variable (keep)
- **Line 207-208**: `"enrichment"` stage comparison (keep)
- **Line 264-265**: `enrichedCount` metric tracking (keep)
- **Line 578, 582**: `"enriched"` metric label mapping (keep - backend)
- **Line 872-873**: `case "enrichment"` pattern matching (keep - backend)

---

### 7. `/apps/web/src/components/LeadSearchHistory.tsx`
**Search History Display** - MULTIPLE UI INSTANCES

**UI-Facing Text (should review):**
- **Line 181-184**: `enrichmentRate` calculation - Variable name
  ```typescript
  const enrichmentRate = ((s.results.enrichedCount || 0) / s.results.totalFound) * 100;
  ```
  ⚠️ **Consider**: Change variable to `contactsFoundRate` or `contactCoverageRate`

- **Line 274**: Text display
  ```typescript
  {enrichmentRate}% enriched • {analysisRate}%
  ```
  ⚠️ **SHOULD CHANGE TO**: `{enrichmentRate}% contacts found`

- **Line 514-517**: Display text
  ```typescript
  {enrichmentRate}%
  ({s.results?.enrichedCount || 0}/...
  ```
  ⚠️ **Context**: Shows "X% enriched (Y/Z)" - should change to "X% contacts found"

**Backend Fields (keep):**
- **Line 474**: `s.actualCosts.enrichment` - Backend cost metric (keep)

---

### 8. `/apps/web/src/components/PipelineProgressPanel.tsx`
**Pipeline Status Panel** - METRIC LABELS

**Line 60**: Metric label configuration
```typescript
const METRIC_LABELS: Record<string, ...> = {
  discovered: { label: "Found", ... },
  enriched: { label: "Contacts", ... },  // ✅ ALREADY USES "CONTACTS"!
  analyzed: { label: "Created", ... },
  ...
}
```

**Status**: ✅ ALREADY CORRECT - Backend key is "enriched" but UI label is "Contacts"

---

### 9. `/apps/web/src/components/DashboardOverview.tsx`
**Dashboard Overview** - TYPE DEFINITIONS

- **Line 84**: `enrichment: { ... }` - Backend metric category (keep)

**UI-Facing**: 
- **Line 257**: `"Set your criteria, enrich leads, and export in minutes."` 
  ⚠️ **SHOULD CHANGE TO**: "Set your criteria, find contacts, and export in minutes."

---

### 10. `/apps/web/src/components/Dashboard.tsx`
**Main Dashboard** - MULTIPLE INSTANCES

**UI-Facing Text:**
- **Line 105, 135**: `enrichmentsPercentage` - Usage metric variable (keep for now)
- **Line 112-113**: `enrichedLeads`, `enrichmentRate` - Display metrics
  ```typescript
  const leadsWithEmails = combinedLeadStats?.enrichedLeads ?? 0;
  const enrichmentRate = combinedLeadStats?.enrichmentRate ?? 0;
  ```
  ⚠️ **Context**: Used in display - should verify how they appear to users

- **Line 233**: `enriched: number` - Data field (keep)
- **Line 291**: `enriched: { label: "Enriched leads", ... }` 
  ⚠️ **SHOULD CHANGE TO**: `label: "Contacts Found"` or "Contacts with Emails"

- **Line 313-314**: Display text
  ```typescript
  ? `${enrichmentRate}% enriched`
  : "No leads enriched yet",
  ```
  ⚠️ **SHOULD CHANGE TO**: 
  - `${enrichmentRate}% contacts found`
  - "No contacts found yet"

- **Line 709**: `{enrichmentRate}% overall coverage`
  ⚠️ **SHOULD CHANGE TO**: "{enrichmentRate}% contact coverage" or "{enrichmentRate}% contacts found"

- **Line 682-683**: Chart data key (keep - backend)

---

### 11. `/apps/web/src/components/UsageMetersCard.tsx`
**Usage Metrics Display** - MULTIPLE INSTANCES

**UI-Facing:**
- **Line 20, 67, 105**: `enrichmentsPercentage` variable (backend metric)
- **Line 129-142**: Usage display
  ```typescript
  <span className={...}>
    {hasUnlimitedEnrichments ? "Unlimited" : `${enrichmentsPercentage}% used`}
  </span>
  ```
  ⚠️ **Context**: This is a usage meter - might say "Enrichments: X% used" which should change to "Contacts: X% used" or "Contact Discovery: X% used"

---

### 12. `/apps/web/src/components/pipeline/ReviewExportStage.tsx`
**Final Review/Export Stage** - MULTIPLE INSTANCES

**UI-Facing Text:**
- **Line 282-286**: Calculation
  ```typescript
  const enrichedCount = Math.max(
    search?.progress?.enriched ?? 0,
    search?.results?.enrichedCount ?? 0,
    ...
  );
  ```
  Variable name - keep for now

- **Line 295-296**: Display calculation
  ```typescript
  const enrichmentRate = discoveredCount > 0 ? (enrichedCount / discoveredCount) * 100 : 0;
  ```
  ⚠️ **Variable naming**: Could be `contactsFoundRate`

- **Line 353**: Chart metric
  ```typescript
  metric: enrichedCount,
  ```
  (keep - backend)

- **Line 425-426**: Label generation
  ```typescript
  const enrichmentRateLabel = discoveredCount > 0 ? formatPercent(enrichmentRate) : "—";
  ```
  (keep - derived from metric)

- **Line 565**: Message text
  ```typescript
  "Emails will appear here once enrichment and personalization finish."
  ```
  ⚠️ **SHOULD CHANGE TO**: "Emails will appear here once contact discovery and personalization finish."

- **Line 686, 710**: Display text
  ```typescript
  {formatNumber(enrichedCount)}  // Shows count
  {enrichmentRateLabel}          // Shows percentage
  ```
  Context: These show the number and rate - text around them should say "Contacts Found"

- **Line 1184**: Message text
  ```typescript
  "Complete enrichment and personalization to unlock lead quality"
  ```
  ⚠️ **SHOULD CHANGE TO**: "Complete contact discovery and personalization to unlock lead quality"

---

### 13. `/apps/web/src/components/settings/ProviderKeyManager.tsx`
**Provider Configuration** - DESCRIPTIONS

**UI-Facing Text:**
- **Line 33**: FindyMail description
  ```typescript
  "Required for email enrichment and contact discovery..."
  ```
  ⚠️ **SHOULD CHANGE TO**: "Required for finding contacts and email discovery..."
  OR keep "email enrichment" if that's a specific FindyMail feature

- **Line 39**: Tavily/Perplexity description
  ```typescript
  "Required for AI research and web enrichment tasks."
  ```
  ⚠️ **SHOULD CHANGE TO**: "Required for AI research and web discovery tasks."

---

### 14. `/apps/web/src/components/pipeline/EnterpriseApiKeyBlocker.tsx`
**Enterprise Requirements Message** - DESCRIPTION

**Line 28**: 
```typescript
description: "Required for email enrichment and validation"
```
⚠️ **SHOULD CHANGE TO**: "Required for finding email contacts and validation" OR keep if specific to email validation feature

---

### 15. `/apps/web/src/components/CreditManager.tsx`
**Credit Display** - FEATURE DESCRIPTION

**Line 127**: 
```typescript
"Email enrichment included"
```
⚠️ **SHOULD CHANGE TO**: "Contact email discovery included"

---

### 16. `/apps/web/src/components/AdminDashboard.tsx`
**Admin Dashboard** - PROVIDER DESCRIPTIONS

**UI-Facing:**
- **Line 247**: Provider category
  ```typescript
  "Providers that supply company intelligence and lead enrichment data."
  ```
  ⚠️ **SHOULD CHANGE TO**: "Providers that supply company intelligence and contact data."

- **Line 251**: FindyMail description
  ```typescript
  "Primary email and contact enrichment provider with batch support."
  ```
  ⚠️ **SHOULD CHANGE TO**: "Primary email and contact discovery provider with batch support."

- **Line 259**: Alternative provider description
  ```typescript
  "Fallback enrichment provider for intent data and supplemental signals."
  ```
  ⚠️ **SHOULD CHANGE TO**: "Fallback contact discovery provider for intent data and supplemental signals."

---

### 17. `/apps/web/src/components/PerformanceWorkspace.tsx`
**Performance Metrics Display** - TEXT

**UI-Facing:**
- **Line 340**: 
  ```typescript
  "Includes searches, enrichments, and exports to date."
  ```
  ⚠️ **SHOULD CHANGE TO**: "Includes searches, contact discoveries, and exports to date."

- **Line 475**: Help text
  ```typescript
  "Keep an eye on credit usage across searches and enrichment..."
  ```
  ⚠️ **SHOULD CHANGE TO**: "Keep an eye on credit usage across searches and contact discovery..."

---

### 18. `/apps/web/src/components/LeadsPage.tsx`
**Leads Display Page** - CONDITIONAL

**Line 175**: 
```typescript
{lead.enrichmentStatus === "completed" && (
```
⚠️ **CONTEXT**: This is checking a data field `enrichmentStatus`. Should verify what this means in your data model. May need to rename if user-facing.

---

### 19. `/apps/web/src/components/ActivityPanel.tsx`
**Activity/Timeline Display** - ICON SELECTION

**Line 54**:
```typescript
if (stage?.includes("enrichment")) return UserPlus;
```
✅ This is just icon selection logic - keep as-is. Text display would be handled elsewhere.

---

### 20. `/apps/web/src/components/pipeline/PipelineOrchestrator.tsx`
**Main Pipeline Orchestrator** - INTERNAL & UI

**UI-Facing:**
- **Line 476**: Instructions text
  ```typescript
  "Follow the guided workflow to discover, enrich, and generate"
  ```
  ⚠️ **SHOULD CHANGE TO**: "Follow the guided workflow to discover, find contacts, and generate"

**Backend/Internal (keep):**
- **Line 94, 142-147**: `enrichedCount`, `enrichedFromSearch`, `enrichedFromLeads` - Internal calculation variables (keep)
- **Line 302-305, 310-326, 336, 342, 373**: Various `enriched` metric computations (keep)
- **Line 423**: Display of `enrichedCount` - depends on context label

---

### 21. `/apps/web/src/components/pipeline/LeadDiscoveryStage.tsx`
**Lead Discovery Component** - INSTRUCTION TEXT

**Line 243**: Error message
```typescript
"At least one role is required for enrichment."
```
⚠️ **SHOULD CHANGE TO**: "At least one role is required to find contacts."

**Line 909**: Help text
```typescript
"Kick off this search and we'll start enriching leads immediately..."
```
⚠️ **SHOULD CHANGE TO**: "Kick off this search and we'll start finding contacts immediately..."

---

### 22. `/apps/web/src/components/__tests__/PipelineProgressPanel.test.tsx`
**Test File** - BACKEND METRIC NAMES

- **Line 53, 75, 160, 166, 174, 186, 222**: All `enriched` references are in test data setup (keep)

---

### 23. `/apps/web/src/hooks/base/useSearchesBase.ts`
**Search Hook** - INTERNAL STATE

**Line 74**: 
```typescript
progress: { discovered: 0, enriched: 0, analyzed: 0, total: 0 },
```
Backend progress tracking (keep field names)

---

## SUMMARY TABLE

### Files with UI-Facing Text that Should Change

| File | Line(s) | Current Text | Recommended Change | Priority |
|------|---------|--------------|-------------------|----------|
| EmailGenerationStage.tsx | 118 | "enriched leads" | "contacts with emails" | HIGH |
| SearchProgressTracker.tsx | 91 | "enrichment consume" | "contact discovery consume" | HIGH |
| LeadSearchHistory.tsx | 274 | "% enriched" | "% contacts found" | HIGH |
| PipelineProgressPanel.tsx | 60 | enriched metric | ✅ Already "Contacts" | - |
| DashboardOverview.tsx | 257 | "enrich leads" | "find contacts" | MEDIUM |
| Dashboard.tsx | 291, 313-314, 709 | "Enriched leads", "% enriched" | "Contacts Found", "% contacts found" | HIGH |
| ReviewExportStage.tsx | 565, 1184 | "enrichment", "enrichment and" | "contact discovery" | MEDIUM |
| ProviderKeyManager.tsx | 33, 39 | "enrichment", "web enrichment" | "contact discovery", "web discovery" | MEDIUM |
| EnterpriseApiKeyBlocker.tsx | 28 | "email enrichment" | "email contact discovery" | LOW |
| CreditManager.tsx | 127 | "Email enrichment" | "Contact email discovery" | LOW |
| AdminDashboard.tsx | 247, 251, 259 | "enrichment data/provider" | "contact data/discovery" | MEDIUM |
| PerformanceWorkspace.tsx | 340, 475 | "enrichments", "enrichment" | "contact discoveries" | MEDIUM |
| LeadDiscoveryStage.tsx | 243, 909 | "enrichment", "enriching leads" | "finding contacts" | HIGH |
| PipelineOrchestrator.tsx | 476 | "enrich" | "find contacts" | MEDIUM |

### Files with Backend Field Names (keep as-is)

- All `enriched` metric keys in:
  - pipeline/types.ts
  - types/PipelineProgress.ts
  - components using `search.progress.enriched` or similar
  - useSearchesBase.ts
  - Test files

- All `enrichment` stage IDs in:
  - pipeline/config.ts (backend ID, UI already says "Get Contacts")
  - pipeline/types.ts
  - types/PipelineProgress.ts

---

## IMPLEMENTATION NOTES

1. **Metric Keys vs Labels**: The backend uses `enriched` as the metric key (e.g., `search.progress.enriched`). This MUST stay as-is. But the UI LABEL for this metric (in PipelineProgressPanel) already says "Contacts" ✅

2. **Already Good**: 
   - EnrichmentStage.tsx UI text is already using "Finding Contacts", "Contact Discovery Progress", etc.
   - PipelineProgressPanel metric label is already "Contacts"

3. **Strategic Change Points**:
   - UI button/instruction text that says "enrich" or "enriching"
   - Tooltip/help text that mentions "enrichment process"
   - Dashboard metric labels
   - Feature descriptions in provider settings

4. **Testing Considerations**:
   - Test the `progress.enriched` metric still works after label changes
   - Verify API responses with enrichedCount field still display correctly
   - Check that stage name mappings in normalizeStageId still work

