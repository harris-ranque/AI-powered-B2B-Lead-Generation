# Metro Search Feature - Implementation Plan

## Overview

Enable users to search across entire metropolitan areas by selecting predefined metros or manually building custom multi-city searches. System discovers zip codes, runs parallel sub-searches, consolidates/deduplicates results, and charges credits per location.

**Timeline**: 4-6 weeks (Full Feature)
**Credit Model**: Per-location charging
**Input Modes**: Both predefined metros AND manual multi-city selection

---

## Problem Statement

**Client Feedback (Mark Savage)**:
> "I still think there needs to be a better way to search besides 1 zip code at a time. It's quickly become a full time job running searches that way. Why couldn't we run a search by city and the tool searches one zip code for each zip code in that city, using API calls or something to narrow the google map part and then consolidates the search results."

**Current Limitation**:
- Single location + radius (max 31 miles) per search
- Large metro areas require multiple manual searches
- No automatic zip code discovery or consolidation

**Solution**: Metro Search feature that automatically handles multi-location searches with consolidated, deduplicated results.

---

## Phase 1: Foundation (Weeks 1-2)

### Week 1: Schema & Data Infrastructure

#### New Tables

**`metroDefinitions`** - Predefined Metro Area Database
```typescript
// apps/convex-backend/convex/schema.ts
metroDefinitions: defineTable({
  name: v.string(),                    // "Houston-The Woodlands-Sugar Land, TX"
  shortName: v.string(),               // "Houston Metro"
  state: v.string(),
  primaryCity: v.string(),
  includedCities: v.array(v.string()),
  includedZipCodes: v.array(v.string()),
  boundingBox: v.object({
    ne: v.object({ lat: v.number(), lng: v.number() }),
    sw: v.object({ lat: v.number(), lng: v.number() }),
  }),
  centerPoint: v.object({ lat: v.number(), lng: v.number() }),
  population: v.optional(v.number()),
  cbsaCode: v.optional(v.string()),
  isActive: v.boolean(),
  lastUpdated: v.number(),
  dataSource: v.string(),  // "simplemaps" | "census" | "manual"
})
  .index("by_short_name", ["shortName"])
  .index("by_state", ["state"])
  .index("by_active", ["isActive"])
  .searchIndex("search_metros", { searchField: "name", filterFields: ["state", "isActive"] })
```

**`metroSearches`** - Parent Metro Search Container
```typescript
metroSearches: defineTable({
  userId: v.id("users"),
  name: v.string(),

  // Metro configuration
  searchType: v.union(v.literal("predefined_metro"), v.literal("custom_multi_city")),
  metroDefinitionId: v.optional(v.id("metroDefinitions")),
  customCities: v.optional(v.array(v.object({
    name: v.string(),
    placeId: v.string(),
    state: v.string(),
    lat: v.number(),
    lng: v.number(),
  }))),

  // Resolved locations for search
  resolvedLocations: v.array(v.object({
    type: v.union(v.literal("city"), v.literal("zip")),
    name: v.string(),
    placeId: v.optional(v.string()),
    zipCode: v.optional(v.string()),
    state: v.string(),
    lat: v.number(),
    lng: v.number(),
  })),

  // Search parameters (applied to all sub-searches)
  parameters: v.object({
    keywords: v.array(v.string()),
    industries: v.optional(v.array(v.string())),
    roles: v.optional(v.array(v.string())),
    maxResultsPerLocation: v.number(),
    totalMaxResults: v.optional(v.number()),
    radius: v.number(),
    deduplication: v.optional(v.object({
      enableCrossLocationDedup: v.boolean(),
      enablePlaceNameDedup: v.optional(v.boolean()),
      enableEmailDedup: v.optional(v.boolean()),
    })),
  }),

  // Status
  status: v.union(
    v.literal("pending"),
    v.literal("resolving_locations"),
    v.literal("in_progress"),
    v.literal("processing"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("cancelled"),
  ),

  // Progress
  progress: v.object({
    locationsTotal: v.number(),
    locationsCompleted: v.number(),
    locationsInProgress: v.number(),
    locationsFailed: v.number(),
    leadsDiscovered: v.number(),
    leadsEnriched: v.number(),
    leadsAnalyzed: v.number(),
    leadsDeduped: v.number(),
  }),

  // Credits
  creditsEstimated: v.number(),
  creditsReserved: v.optional(v.number()),
  creditsUsed: v.number(),
  reservationId: v.optional(v.id("creditReservations")),

  // Results
  results: v.object({
    totalLeadsFound: v.number(),
    uniqueLeadsAfterDedup: v.number(),
    enrichedCount: v.number(),
    analyzedCount: v.number(),
    avgRelevanceScore: v.optional(v.number()),
  }),

  error: v.optional(v.string()),
  createdAt: v.number(),
  completedAt: v.optional(v.number()),
})
  .index("by_user", ["userId"])
  .index("by_status", ["status"])
  .index("by_user_status", ["userId", "status"])
```

#### Modify Existing Tables

**`searches`** - Add parent reference:
```typescript
// Add fields:
parentMetroSearchId: v.optional(v.id("metroSearches")),
locationIndex: v.optional(v.number()),
locationName: v.optional(v.string()),
isSubSearch: v.optional(v.boolean()),

// Add index:
.index("by_metro_search", ["parentMetroSearchId"])
```

**`leads`** - Add metro reference:
```typescript
// Add fields:
metroSearchId: v.optional(v.id("metroSearches")),
sourceLocation: v.optional(v.string()),
isDedupedFromMetro: v.optional(v.boolean()),

// Add index:
.index("by_metro_search", ["metroSearchId"])
```

#### Data Import Tasks
- [ ] Purchase SimpleMaps Pro database (~$50-200 one-time)
- [ ] Create import script for metro definitions
- [ ] Import ~200 major US metros with zip codes
- [ ] Set up ZIP-Codes.com API as fallback

### Week 2: Core Backend APIs

#### Create `convex/metro/mutations.ts`
```typescript
// createMetroSearch - From predefined metro
// createCustomMetroSearch - From manual cities
// cancelMetroSearch - Cancel all sub-searches
// resumeMetroSearch - Resume from checkpoint
```

#### Create `convex/metro/queries.ts`
```typescript
// getMetroDefinitions - List/search metros
// getMetroSearch - Get metro with progress
// getMetroSubSearches - Get child searches
// getMetroSearchLeads - Leads with location filter
// estimateMetroSearchCost - Cost preview
```

#### Create `convex/metro/internal.ts`
```typescript
// createSubSearch - Create child search
// updateMetroProgress - Aggregate progress
// handleSubSearchComplete - Completion callback
```

---

## Phase 2: Orchestration (Weeks 3-4)

### Week 3: Execution Pipeline

#### Create `convex/metro/actions.ts`

**`orchestrateMetroSearch`** - Main orchestrator:
```
1. Load metro search config
2. Resolve locations (if not already)
3. Reserve credits for total estimate
4. Create sub-searches (one per location)
5. Execute sub-searches (parallel, max 5 concurrent)
6. Track progress via callbacks
```

**`resolveMetroLocations`** - Location resolver:
```
For predefined metro:
  → Load from metroDefinitions table
  → Return includedZipCodes as locations

For custom cities:
  → Validate each city via Google Places
  → Optionally expand to nearby zips
  → Return validated locations
```

#### Parallel Execution Controller
```typescript
const MAX_CONCURRENT_SUBSEARCHES = 5;

async function executeSubSearches(metroSearchId, locations) {
  const queue = [...locations];
  const active = new Set();

  while (queue.length > 0 || active.size > 0) {
    // Fill up to max concurrent
    while (queue.length > 0 && active.size < MAX_CONCURRENT_SUBSEARCHES) {
      const location = queue.shift();
      const searchId = await createSubSearch(metroSearchId, location);
      active.add(searchId);

      // Start search (non-blocking)
      scheduleAction('search.actions:searchGoogleMaps', { searchId });
    }

    // Wait for any completion
    await waitForAnyCompletion(active);
  }
}
```

### Week 4: Deduplication & Completion

#### Cross-Location Deduplication
```typescript
async function deduplicateMetroResults(metroSearchId) {
  // Get all leads from all sub-searches
  const leads = await getAllMetroLeads(metroSearchId);

  // Group by dedup keys
  const byPlaceId = groupBy(leads, 'placeId');
  const byEmail = groupBy(leads, 'contactInfo.email');

  // Mark duplicates (keep first by createdAt)
  const duplicates = [];
  for (const [key, group] of Object.entries(byPlaceId)) {
    if (group.length > 1) {
      const [keep, ...remove] = sortBy(group, 'createdAt');
      duplicates.push(...remove.map(l => l._id));
    }
  }

  // Mark (don't delete) for reporting
  await markLeadsAsDuplicates(duplicates);

  return {
    totalLeads: leads.length,
    uniqueLeads: leads.length - duplicates.length,
    duplicatesRemoved: duplicates.length
  };
}
```

#### Metro Completion Action
```typescript
async function completeMetroSearch(metroSearchId) {
  // 1. Run cross-location deduplication
  const dedupResults = await deduplicateMetroResults(metroSearchId);

  // 2. Aggregate results from all sub-searches
  const results = await aggregateMetroResults(metroSearchId);

  // 3. Calculate actual credit usage
  const actualCredits = calculateActualCredits(results);

  // 4. Commit credits (refund if under estimate)
  await commitMetroCredits(metroSearchId, actualCredits);

  // 5. Update metro search status
  await updateMetroSearch(metroSearchId, {
    status: 'completed',
    results,
    creditsUsed: actualCredits,
    completedAt: Date.now(),
  });

  // 6. Send completion notification
  await notifyMetroSearchComplete(metroSearchId);
}
```

---

## Phase 3: Frontend (Weeks 5-6)

### Week 5: Core UI Components

#### Files to Create

**`apps/web/src/components/metro/MetroSearchMode.tsx`**
- Toggle between "Single Location" and "Metro Search"
- Shows mode benefits and credit differences

**`apps/web/src/components/metro/MetroSelector.tsx`**
- Searchable dropdown of ~200 US metros
- Groups by state/region
- Shows location count and estimated businesses
- Preview of included cities

**`apps/web/src/components/metro/MultiCityInput.tsx`**
- Multi-select location autocomplete
- Badge-based display (like existing roles selection)
- Max 10 cities limit
- Duplicate prevention

**`apps/web/src/components/metro/MetroCostBreakdown.tsx`**
- Per-location cost breakdown
- Total estimated credits
- Location count summary

#### Files to Modify

**`apps/web/src/components/pipeline/LeadDiscoveryStage.tsx`**
```tsx
// Add at top of form:
<MetroSearchMode
  mode={searchMode}
  onChange={setSearchMode}
/>

// Conditional rendering:
{searchMode === 'metro' ? (
  <>
    <MetroSelector onSelect={setSelectedMetro} />
    {/* OR */}
    <MultiCityInput cities={cities} onChange={setCities} />
  </>
) : (
  <LocationAutocomplete ... /> // Existing single location
)}
```

**`apps/web/src/components/ui/location-autocomplete.tsx`**
- Add `multiple?: boolean` prop
- Support multi-select mode with badges

### Week 6: Progress & Results UI

**`apps/web/src/components/metro/MetroSearchProgress.tsx`**
- Per-location progress bars
- Overall completion percentage
- Live lead count by location
- Expandable detail view

**`apps/web/src/components/metro/MetroResultsView.tsx`**
- Location filter dropdown
- Aggregated vs per-location toggle
- Deduplication indicators
- Export with location data

#### Dashboard Integration
- Add metro searches to search list
- Metro-specific status badges
- Location count indicator

---

## Credit System Integration

### Per-Location Cost Model
```typescript
// Same as single search, multiplied by locations
const CREDITS_PER_LEAD_TIER2 = 1;  // Tavily research
const CREDITS_PER_LEAD_TIER3 = 2;  // Perplexity research

function estimateMetroCost(locationCount, leadsPerLocation, tier) {
  const creditsPerLead = tier === 'tier3' ? 2 : 1;
  // Estimate 70% yield after cross-location dedup
  const estimatedLeads = locationCount * leadsPerLocation * 0.7;
  return Math.ceil(estimatedLeads * creditsPerLead);
}
```

### Reservation Strategy
- Reserve at metro search creation (2-hour expiry for long searches)
- Commit actual usage at completion
- Auto-refund if under estimate

---

## Data Source Strategy

### Primary: SimpleMaps Pro Database
- One-time purchase (~$50-200)
- ~200 major US metro definitions with zip codes
- Offline lookup, zero latency
- Import into `metroDefinitions` table

### Secondary: Google Maps Places API
- Already integrated for city validation
- Use for custom city input validation
- Leverage existing API key

### Fallback: ZIP-Codes.com API
- Real-time queries for unknown metros
- Monthly USPS updates
- Cache results locally

---

## Key Files Reference

| Component | File Path |
|-----------|-----------|
| Schema | `apps/convex-backend/convex/schema.ts` |
| Search mutations (pattern) | `apps/convex-backend/convex/search/mutations.ts` |
| Search actions (pattern) | `apps/convex-backend/convex/search/actions.ts` |
| Credit system | `apps/convex-backend/convex/credits/transactions.ts` |
| Frontend form | `apps/web/src/components/pipeline/LeadDiscoveryStage.tsx` |
| Location input | `apps/web/src/components/ui/location-autocomplete.tsx` |

---

## Success Criteria

- [ ] Metro search completion rate > 95%
- [ ] Cross-location deduplication accuracy > 99%
- [ ] Average metro search time < 10 min for 5 locations
- [ ] Users can select from 200+ predefined US metros
- [ ] Users can create custom searches with up to 10 cities
- [ ] Per-location credit charging with accurate estimates
- [ ] Real-time progress tracking per location

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Google API rate limits | Adaptive rate limiting, max 5 concurrent sub-searches |
| Long-running searches timeout | Checkpoint system, resumable searches |
| Cross-location dedup performance | Efficient indexing, batch processing |
| Users underestimate costs | Clear cost breakdown UI, confirmation dialog |
| Metro data becomes stale | Annual refresh cycle, fallback to API |

---

## User Experience Flow

### Predefined Metro Selection
```
1. User toggles to "Metro Search" mode
2. User searches/selects "Houston Metro" from dropdown
3. System shows: "15 locations, ~750 estimated leads, ~525 credits"
4. User confirms and starts search
5. Dashboard shows per-location progress bars
6. Completion shows consolidated, deduplicated results
7. Export includes location source for each lead
```

### Custom Multi-City Selection
```
1. User toggles to "Metro Search" mode
2. User switches to "Custom Cities" tab
3. User adds cities one by one (max 10):
   - "Houston, TX" [x]
   - "Sugar Land, TX" [x]
   - "The Woodlands, TX" [x]
4. System shows cost estimate per location
5. User confirms and starts search
6. Same progress/results flow as predefined
```

---

## API Cost Comparison

| Approach | Monthly Cost (1000 searches) |
|----------|------------------------------|
| Current (manual) | Same total, more user effort |
| Metro Search | Same cost, automated |
| SimpleMaps data | $0 (one-time purchase) |
| ZIP-Codes.com fallback | ~$10-50/month |

**Net Impact**: Same credit cost to users, dramatically reduced manual effort.
