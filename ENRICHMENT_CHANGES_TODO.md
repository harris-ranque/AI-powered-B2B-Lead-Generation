# Enrichment Terminology Change TODO List

## Summary
This is a comprehensive checklist of all UI-facing text that should be changed from "enrichment/enriched/enrich" terminology to "contacts found" or equivalent.

**Total Changes Needed**: 20+ files
**Backend Fields to Preserve**: 75+ (metric keys, type names, stage IDs)

---

## HIGH PRIORITY CHANGES (User-Facing Instructions)

### 1. `/apps/web/src/components/pipeline/EmailGenerationStage.tsx`
- [ ] **Line 118**: "enriched leads" → "contacts with emails"
  ```typescript
  // Before:
  Generate personalized emails for {state.enrichedLeads.length}{" "}
  enriched leads
  
  // After:
  Generate personalized emails for {state.enrichedLeads.length}{" "}
  contacts with emails
  ```

### 2. `/apps/web/src/components/pipeline/LeadDiscoveryStage.tsx`
- [ ] **Line 243**: Error message update
  ```typescript
  // Before: "At least one role is required for enrichment."
  // After: "At least one role is required to find contacts."
  ```

- [ ] **Line 909**: Help text update
  ```typescript
  // Before: "Kick off this search and we'll start enriching leads immediately..."
  // After: "Kick off this search and we'll start finding contacts immediately..."
  ```

### 3. `/apps/web/src/components/Dashboard.tsx`
- [ ] **Line 291**: Chart label
  ```typescript
  // Before: enriched: { label: "Enriched leads", color: "hsl(var(--chart-2))" }
  // After: enriched: { label: "Contacts Found", color: "hsl(var(--chart-2))" }
  ```

- [ ] **Lines 313-314**: Display text
  ```typescript
  // Before:
  ? `${enrichmentRate}% enriched`
  : "No leads enriched yet",
  
  // After:
  ? `${enrichmentRate}% contacts found`
  : "No contacts found yet",
  ```

- [ ] **Line 709**: Coverage text
  ```typescript
  // Before: {enrichmentRate}% overall coverage
  // After: {enrichmentRate}% contact coverage
  ```

### 4. `/apps/web/src/components/SearchProgressTracker.tsx`
- [ ] **Line 91**: Credit tooltip
  ```typescript
  // Before: "Discovery and enrichment consume 1 credit per lead..."
  // After: "Discovery and contact discovery consume 1 credit per lead..."
  // OR: "Finding leads and contacts costs 1 credit per lead..."
  ```

### 5. `/apps/web/src/components/LeadSearchHistory.tsx`
- [ ] **Line 274**: Display percentage text
  ```typescript
  // Before: {enrichmentRate}% enriched • {analysisRate}%
  // After: {enrichmentRate}% contacts found • {analysisRate}%
  ```

- [ ] **Line 514-517**: Progress display
  ```typescript
  // Context: Shows something like "87% enriched (45/52)"
  // Should show: "87% contacts found (45/52)"
  // Update the label around this metric
  ```

---

## MEDIUM PRIORITY CHANGES (Dashboard & Feature Text)

### 6. `/apps/web/src/components/DashboardOverview.tsx`
- [ ] **Line 257**: Feature description
  ```typescript
  // Before: "Set your criteria, enrich leads, and export in minutes."
  // After: "Set your criteria, find contacts, and export in minutes."
  ```

### 7. `/apps/web/src/components/pipeline/ReviewExportStage.tsx`
- [ ] **Line 565**: Empty state message
  ```typescript
  // Before: "Emails will appear here once enrichment and personalization finish."
  // After: "Emails will appear here once contact discovery and personalization finish."
  ```

- [ ] **Line 1184**: Unlock message
  ```typescript
  // Before: "Complete enrichment and personalization to unlock lead quality"
  // After: "Complete contact discovery and personalization to unlock lead quality"
  ```

### 8. `/apps/web/src/components/PipelineOrchestrator.tsx`
- [ ] **Line 476**: Workflow instructions
  ```typescript
  // Before: "Follow the guided workflow to discover, enrich, and generate"
  // After: "Follow the guided workflow to discover, find contacts, and generate"
  ```

### 9. `/apps/web/src/components/settings/ProviderKeyManager.tsx`
- [ ] **Line 33**: FindyMail description
  ```typescript
  // Before: "Required for email enrichment and contact discovery..."
  // After: "Required for finding contacts and email discovery..."
  // OR: "Required for contact discovery and email validation..."
  ```

- [ ] **Line 39**: Tavily/Perplexity description
  ```typescript
  // Before: "Required for AI research and web enrichment tasks."
  // After: "Required for AI research and web discovery tasks."
  ```

### 10. `/apps/web/src/components/AdminDashboard.tsx`
- [ ] **Line 247**: Provider category description
  ```typescript
  // Before: "Providers that supply company intelligence and lead enrichment data."
  // After: "Providers that supply company intelligence and contact data."
  ```

- [ ] **Line 251**: FindyMail description
  ```typescript
  // Before: "Primary email and contact enrichment provider with batch support."
  // After: "Primary email and contact discovery provider with batch support."
  ```

- [ ] **Line 259**: Fallback provider description
  ```typescript
  // Before: "Fallback enrichment provider for intent data and supplemental signals."
  // After: "Fallback contact discovery provider for intent data and supplemental signals."
  ```

### 11. `/apps/web/src/components/PerformanceWorkspace.tsx`
- [ ] **Line 340**: Included metrics description
  ```typescript
  // Before: "Includes searches, enrichments, and exports to date."
  // After: "Includes searches, contact discoveries, and exports to date."
  ```

- [ ] **Line 475**: Credit help text
  ```typescript
  // Before: "Keep an eye on credit usage across searches and enrichment..."
  // After: "Keep an eye on credit usage across searches and contact discovery..."
  ```

---

## LOW PRIORITY CHANGES (Additional UI Text)

### 12. `/apps/web/src/components/pipeline/EnterpriseApiKeyBlocker.tsx`
- [ ] **Line 28**: Enterprise requirement description
  ```typescript
  // Before: "Required for email enrichment and validation"
  // After: "Required for email contact discovery and validation"
  // (Only if this appears to users)
  ```

### 13. `/apps/web/src/components/CreditManager.tsx`
- [ ] **Line 127**: Feature description
  ```typescript
  // Before: "Email enrichment included"
  // After: "Contact email discovery included"
  ```

### 14. `/apps/web/src/components/UsageMetersCard.tsx`
- [ ] **Lines 129-142**: Usage meter label (if visible)
  ```typescript
  // Context: Check if meter says "Enrichments: X% used"
  // Should be: "Contacts: X% used" or "Contact Discovery: X% used"
  // Note: Need to verify exact text displayed to users
  ```

---

## ALREADY GOOD (No changes needed)

- [x] **EnrichmentStage.tsx**: Already uses "Finding Contacts" and "Contact Discovery Progress"
- [x] **PipelineProgressPanel.tsx**: Metric label already says "Contacts" (line 60)
- [x] **pipeline/config.ts**: Stage title already says "Get Contacts" (line 23)

---

## BACKEND FIELDS TO PRESERVE (DO NOT CHANGE)

The following should be left unchanged as they are internal implementation details:

**Metric Keys** (must match backend):
- `search.progress.enriched`
- `search.results.enrichedCount`
- `enriched` (in metric calculations)

**Type Definitions** (must match backend schema):
- `enrichedLeads` (state variable)
- `enrichmentRate` (calculation)
- `enrichmentStatus` (data field)
- `supportsEnrichment` (property)

**Stage IDs** (must match backend):
- `"enrichment"` (pipeline stage ID)
- References in `STAGE_ALIASES`
- References in stage detection logic

**Arrays & Variables**:
- `state.enrichedLeads` (keep variable name)
- `enrichedCount` (keep variable name)

---

## TESTING CHECKLIST

After making changes, verify:

- [ ] All metric displays still show correct numbers
- [ ] Progress bars and percentages still calculate correctly
- [ ] Stage transitions still work (discovery → enrichment → analysis)
- [ ] Search results still export with all data
- [ ] Dashboard metrics still display
- [ ] Tooltips and help text appear correctly
- [ ] No console errors about metric key mismatches
- [ ] User can still navigate through all pipeline stages
- [ ] Search history shows correct progress percentages
- [ ] Credit costs still display correctly

---

## IMPLEMENTATION NOTES

### Approach
1. Use find-and-replace for text strings (e.g., "enriched leads" → "contacts with emails")
2. Be careful to only replace USER-FACING text, not variable names
3. Variable names like `enrichedCount` can stay (internal implementation)
4. Leave all backend metric keys unchanged

### Why Preserve Backend Fields
- Metric keys are read from API responses
- Stage IDs must match orchestration logic
- Database queries depend on field names
- Changing them requires migration and backend updates

### Variable Names vs Text Strings
- **Variable names**: Internal to components, don't affect users
- **Text strings**: Directly displayed to users, critical to change
- This file focuses on text strings that appear in the UI

---

## Progress Tracking

- [ ] HIGH priority changes completed
- [ ] MEDIUM priority changes completed
- [ ] LOW priority changes completed
- [ ] Testing completed
- [ ] Code review completed
- [ ] PR merged

---

## Files Modified Count
- [ ] 12 files with UI text changes
- [ ] 0 files with backend field changes (preserve everything)
- [ ] 0 type definitions to update

Total estimated effort: 2-4 hours (mostly find-and-replace with verification)
