# ICypeas Domain-Based Contact Discovery Solution

## Problem

You want to use ICypeas (cheaper) to find contacts and emails from just a domain name, without knowing specific person names.

## Solution: Use ICypeas Bulk Search with `domain-search` Task

### ICypeas API Flow for Domain Discovery

```
1. Start Bulk Search (domain-search task)
   ↓
2. Get file ID
   ↓
3. Poll for completion (check file status)
   ↓
4. Retrieve results (get contact/email data)
```

### Step 1: Initiate Domain Search

**Endpoint**: `POST https://app.icypeas.com/api/bulk-search`

**Request**:
```json
{
  "task": "domain-search",
  "name": "Lead Enrichment Batch",
  "data": [
    ["fredloya.com"],
    ["anthropic.com"],
    ["openai.com"]
  ]
}
```

**Response**:
```json
{
  "success": true,
  "status": "in_progress",
  "file": "kMnquYkBTs8kZM9ND26h"
}
```

### Step 2: Check Bulk Search Status

**Endpoint**: `POST https://app.icypeas.com/api/search-files/read`

**Request**:
```json
{
  "file": "kMnquYkBTs8kZM9ND26h"
}
```

**Response** (when complete):
```json
{
  "success": true,
  "files": [{
    "file": "kMnquYkBTs8kZM9ND26h",
    "status": "done",
    "total": 3,
    "processed": 3
  }]
}
```

### Step 3: Retrieve Individual Results

**Endpoint**: `POST https://app.icypeas.com/api/bulk-single-searchs/read`

**Request**:
```json
{
  "mode": "bulk",
  "file": "kMnquYkBTs8kZM9ND26h",
  "limit": 50
}
```

**Response**:
```json
{
  "success": true,
  "items": [
    {
      "_id": "searchId123",
      "status": "FOUND",
      "order": 0,
      "results": {
        "fullname": "John Doe",
        "firstname": "John",
        "lastname": "Doe",
        "emails": [
          {
            "email": "john@fredloya.com",
            "certainty": "SURE"
          }
        ],
        "phones": ["+1234567890"],
        "li": "https://linkedin.com/in/johndoe"
      }
    },
    {
      "_id": "searchId456",
      "status": "FOUND",
      "order": 1,
      "results": {
        "fullname": "Jane Smith",
        "emails": [...]
      }
    }
  ],
  "total": 2
}
```

## Implementation Strategy

### Current Code Issue

The current `icypeas.ts` uses the `/email-search` endpoint which requires firstname/lastname. This is **wrong for domain-based discovery**.

### Correct Approach

We need to implement a **new bulk-based domain search** flow:

1. **Batch domains** into groups (max 5000 per bulk search)
2. **Submit bulk-search** with `task: "domain-search"`
3. **Poll file status** until `status === "done"`
4. **Retrieve all results** from the bulk search
5. **Parse contacts** from the results

### Code Structure

```typescript
class IcyPeasProvider {
  async enrichBatch(domains: string[]): Promise<EnrichmentBatchResult> {
    // 1. Start bulk domain search
    const fileId = await this.startBulkDomainSearch(domains);

    // 2. Poll until complete
    await this.pollBulkSearchStatus(fileId);

    // 3. Retrieve all results
    const results = await this.getBulkSearchResults(fileId);

    // 4. Transform to our format
    return this.transformBulkResults(results, domains);
  }

  private async startBulkDomainSearch(domains: string[]): Promise<string> {
    const response = await fetch(`${ICYPEAS_BASE_URL}/bulk-search`, {
      method: "POST",
      headers: {
        "Authorization": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task: "domain-search",
        name: `Domain Enrichment ${Date.now()}`,
        data: domains.map(d => [d]) // Each domain in its own array
      }),
    });

    const result = await response.json();
    return result.file;
  }

  private async pollBulkSearchStatus(fileId: string): Promise<void> {
    // Poll /api/search-files/read until status === "done"
  }

  private async getBulkSearchResults(fileId: string): Promise<any[]> {
    // Call /api/bulk-single-searchs/read with mode: "bulk"
  }
}
```

## Key Differences from Current Implementation

| Aspect | Current (WRONG) | Correct |
|--------|-----------------|---------|
| Endpoint | `/email-search` | `/bulk-search` |
| Task Type | N/A (single search) | `domain-search` |
| Input | firstname, lastname, domain | Just domain |
| Returns | Single email for one person | Multiple contacts per domain |
| Polling | `/bulk-single-searchs/read` with `id` | `/search-files/read` then `/bulk-single-searchs/read` with `mode: "bulk"` |

## Benefits of Domain Search

✅ **No names required**: Just provide domains
✅ **Multiple contacts**: Gets all discoverable people at the domain
✅ **Bulk processing**: Efficient for batches
✅ **Cheaper**: Uses ICypeas instead of FindyMail

## Next Steps

1. Update `IcyPeasProvider` class to implement bulk domain-search flow
2. Keep the current `/email-search` implementation as a fallback for when you DO have names
3. Set `ENRICHMENT_PROVIDER=icypeas` after implementation
4. Test with real domains to verify contact discovery

## Testing Plan

```bash
# Test bulk domain search
node test-icypeas-bulk-domain.js
```

Expected result:
- Input: `["fredloya.com", "anthropic.com"]`
- Output: Multiple contacts with names, emails, phones per domain
