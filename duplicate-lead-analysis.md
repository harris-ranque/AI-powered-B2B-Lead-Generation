# Duplicate Lead Prevention Analysis - Genni Platform

## Current State Assessment

### ❌ **No Duplicate Prevention Exists**

The Genni platform currently has **no mechanisms** to prevent duplicate leads when users create overlapping searches. Each search creates independent lead records regardless of previous searches.

### ✅ **Database Infrastructure Ready**

The database schema supports duplicate prevention with the existing index:

```typescript
// schema.ts:252 - leads table
.index("by_place_id", ["placeId"])
```

## Problem Scenarios

### 1. **Cross-Search Duplicates**

```
User Search A: "restaurants downtown" (radius: 2km)
User Search B: "italian food downtown" (radius: 3km)
Result: Same restaurant appears as separate leads in both searches
```

### 2. **Geographic Overlap**

- Searches with overlapping radius boundaries
- Different keywords returning same businesses
- Re-running failed or cancelled searches

### 3. **Contact Communication Issues**

- No tracking of which contacts have been emailed
- Risk of sending duplicate emails to same person
- No identification of new vs. existing contacts at businesses

## Current Implementation Gaps

### **Lead Creation Process**

- `createLead` mutation: No duplicate checking
- `searchGoogleMaps` action: Creates all discovered places without validation
- Search orchestrator: No deduplication logic

### **Contact Management**

- No contact-level communication tracking
- No prevention of duplicate emails
- No refresh mechanism for existing locations

## Recommended Solutions

### **1. User-Scoped Duplicate Prevention**

#### Implementation Pattern

```typescript
// Check for existing lead by placeId for THIS user only
const existingLead = await ctx.db
  .query("leads")
  .withIndex("by_place_id", (q) => q.eq("placeId", placeId))
  .filter((q) => q.eq(q.field("userId"), userId)) // User-scoped check
  .first();
```

#### Business Logic

- ✅ **Allow**: Same `placeId` for different `userId` values
- ❌ **Prevent**: Same `placeId` for same `userId` across searches
- **Action**: Skip creation, optionally refresh existing lead data

### **2. Smart Location Re-Search Strategy**

#### For Existing Businesses

Instead of creating duplicates:

1. **Refresh lead data** - Update rating, reviews, business info
2. **Re-enrich contacts** - Check for new employees/contacts
3. **Update search association** - Link to new search without duplication
4. **Cost optimization** - Only charge for genuinely new discoveries

#### Implementation Approach

```typescript
if (existingLead) {
  // Update business info (rating, reviews, etc.)
  await ctx.db.patch(leadId, {
    rating: place.rating,
    reviewCount: place.user_ratings_total,
    updatedAt: Date.now(),
  });

  // Re-enrich to find NEW contacts
  await scheduleRefreshEnrichment(leadId);
} else {
  // Create new lead as normal
  await createNewLead(searchId, place);
}
```

### **3. Contact-Level Communication Tracking**

#### New Database Table

```typescript
// Add to schema.ts
contactCommunications: defineTable({
  userId: v.id("users"),
  leadId: v.id("leads"),
  contactEmail: v.string(),
  contactName: v.optional(v.string()),
  emailsSent: v.array(
    v.object({
      emailSequenceId: v.id("emailSequences"),
      sentAt: v.number(),
      type: v.string(), // "initial", "follow_up"
    }),
  ),
  status: v.union(
    v.literal("never_contacted"),
    v.literal("contacted"),
    v.literal("responded"),
    v.literal("bounced"),
    v.literal("unsubscribed"),
  ),
  lastContactedAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_user_email", ["userId", "contactEmail"])
  .index("by_lead", ["leadId"])
  .index("by_status", ["status"]);
```

#### Contact Email Prevention

```typescript
// Before sending emails - check communication history
const previouslySent = await ctx.db
  .query("contactCommunications")
  .withIndex("by_user_email", (q) =>
    q.eq("userId", userId).eq("contactEmail", email),
  )
  .first();

if (previouslySent && previouslySent.status !== "bounced") {
  // Skip this contact - already contacted
  continue;
}
```

## Implementation Priority

### **Phase 1: Basic Duplicate Prevention**

1. **Modify `createLead` mutation** - Add user-scoped duplicate check
2. **Update Google Maps search action** - Skip existing `placeId` for user
3. **User feedback** - Show "X duplicates skipped" in search results

### **Phase 2: Smart Refresh System**

1. **Lead refresh logic** - Update existing business data
2. **Re-enrichment strategy** - Find new contacts at existing locations
3. **Search association** - Link refreshed leads to new searches

### **Phase 3: Contact Communication Management**

1. **Contact tracking table** - Implement communication history
2. **Email prevention logic** - Prevent duplicate contact emails
3. **Contact lifecycle management** - Track response status

## User Experience Benefits

### **For Users**

- ✅ **Cleaner lead database** - No duplicate business records
- ✅ **Fresh contact data** - New employees discovered over time
- ✅ **Professional communication** - Never double-email contacts
- ✅ **Cost efficiency** - No duplicate enrichment charges
- ✅ **Clear search results** - "X new leads, Y refreshed locations"

### **For Platform**

- ✅ **Reduced storage costs** - No duplicate lead data
- ✅ **Better user retention** - Clean, professional experience
- ✅ **Improved metrics** - Accurate lead generation statistics
- ✅ **API efficiency** - Reduced redundant API calls

## Technical Considerations

### **Database Queries**

- User-scoped duplicate checks are efficient with existing `by_place_id` index
- Additional filtering by `userId` maintains performance
- Contact communication queries use compound indexes for speed

### **Credit System Impact**

- Only charge for genuinely new lead discoveries
- Refresh existing leads without additional discovery costs
- Re-enrichment charges only for new contacts found

### **Current System Note**

- Search orchestration is temporarily disabled (line 50-52 in mutations.ts)
- Implementation should account for when orchestration is re-enabled
- Circular dependency issues need resolution before auto-start works

## Conclusion

**Current Risk Level**: High - Users accumulating duplicate leads across overlapping searches

**Implementation Complexity**: Medium - Requires database schema additions and business logic updates

**User Impact**: High positive - Significantly improves user experience and platform professionalism

**Recommended Approach**: Implement in phases, starting with basic user-scoped duplicate prevention, then adding smart refresh and contact management features.
