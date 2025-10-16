# ICypeas API Integration Fix

## Problem

The ICypeas API integration was failing with `success=false` errors because the request format was incorrect.

### Root Cause

1. **Missing required fields**: The API requires `firstname` OR `lastname` to be provided, but the code was only sending `domainOrCompany`
2. **Incorrect response parsing**: The search ID is in `response.item._id`, not `response.searchId`
3. **Incorrect polling request**: The polling endpoint expects `id` field, not `searchId`
4. **Incorrect response structure**: Polling returns `items` array, not direct `emails` array

## Errors in Logs

```
[ICypeas] Search initiation failed: {
  success: false,
  message: undefined,
  domain: 'fredloya.com',
  companyName: undefined
}
```

Validation error from API:
```json
{
  "validationErrors": [{
    "field": "firstname",
    "message": "first_last_mandatory_discovery_error",
    "humanReadableMessage": "Firstname or lastname are mandatory in discovery mode"
  }],
  "success": false
}
```

## Solution

### 1. Updated Request Format

**Before (INCORRECT)**:
```typescript
const body = {
  domainOrCompany: domain,
  ...(companyName && { company: companyName }),
};
```

**After (CORRECT)**:
```typescript
const body = {
  firstname: companyName || "",  // Use company name or empty string
  lastname: "",                   // Required field
  domainOrCompany: domain
};
```

### 2. Fixed Response Parsing

**Before**:
```typescript
const jsonResponse = await response.json();
const searchId = jsonResponse.searchId; // This was undefined!
```

**After**:
```typescript
const jsonResponse = await response.json();
const searchId = jsonResponse.item?._id || jsonResponse.searchId;
const status = jsonResponse.item?.status || jsonResponse.status;
```

### 3. Fixed Polling Request

**Before**:
```typescript
body: JSON.stringify({ searchId })
```

**After**:
```typescript
body: JSON.stringify({ id: searchId })
```

### 4. Fixed Polling Response Parsing

**Before**:
```typescript
const result = await response.json();
const emails = result.emails; // This was undefined!
```

**After**:
```typescript
const rawResult = await response.json();
const item = rawResult.items?.[0];
const emails = item?.results?.emails || [];
const status = item?.status;
```

## Files Changed

1. **`apps/convex-backend/convex/leads/enrichment/types.ts`**
   - Updated `IcyPeasSearchResponse` to include `item` field and `validationErrors`
   - Updated `IcyPeasSearchResult` to include `items` array structure

2. **`apps/convex-backend/convex/leads/enrichment/icypeas.ts`**
   - Fixed `startEmailSearch()` to include `firstname` and `lastname` fields
   - Fixed search ID extraction from `item._id`
   - Fixed polling request to use `id` instead of `searchId`
   - Fixed polling response parsing to extract data from `items[0].results`

## API Documentation Reference

From https://api-doc.icypeas.com/find-emails/email-discovery/:

**Required Fields**:
- `firstname` (can be empty if lastname is set)
- `lastname` (can be empty if firstname is set)
- `domainOrCompany`

**Response Format** (email-search):
```json
{
  "success": true,
  "item": {
    "_id": "searchId123",
    "status": "NONE"
  }
}
```

**Polling Format** (bulk-single-searchs/read):

Request:
```json
{
  "id": "searchId123"
}
```

Response:
```json
{
  "success": true,
  "items": [{
    "_id": "searchId123",
    "status": "FOUND",
    "results": {
      "emails": [...],
      "phones": [...]
    }
  }]
}
```

## Testing

Run the test script to verify the fix:

```bash
ICYPEAS_API_KEY=your_key node test-icypeas-fixed.js
```

Expected output:
```
✅ FIXED IMPLEMENTATION WORKS!
   Search ID: <valid-search-id>
   Status: NONE

📊 Polling for results...
   ✅ Search completed: FOUND/NOT_FOUND
   Emails found: X
```

## Deployment

The fixes have been applied to the codebase. To deploy:

```bash
cd apps/convex-backend
npx convex dev --once --until-success
```

Note: There may be a schema validation error for old searches missing `updatedAt`. This can be fixed by either:
1. Deleting old test searches from the database
2. Running a migration to add `updatedAt` to existing searches

## Verification

After deployment, monitor the Convex logs for:
- ✅ `[ICypeas] Search response parsed: { success: true, searchId: "..." }`
- ✅ `[ICypeas] ✅ Poll completed successfully`
- ❌ No more `success: false` errors
