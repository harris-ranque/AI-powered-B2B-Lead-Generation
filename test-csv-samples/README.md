# CSV Test Samples for Genni Lead Upload System

This directory contains test CSV files for validating the CSV upload functionality.

## Test Scenarios

### Scenario 1: With Emails (1 Credit Per Lead)
**File**: `scenario1-with-emails.csv`
**Purpose**: Test leads that already have email addresses (should skip enrichment)
**Expected Cost**: 3 leads × 1 credit = **3 credits**
**Expected Behavior**:
- All 3 leads should import successfully
- `enrichmentStatus` should be set to "completed"
- `skipEnrichment` flag should be true in raw_data
- Backend should skip FindyMail API calls
- Should proceed directly to research stage

**Leads**:
1. Acme Corp (acme.com) - john@acme.com
2. TechVentures Inc (techventures.io) - jane@techventures.io
3. Local Bakery (localbakery.com) - mike@localbakery.com

---

### Scenario 2: Domain Only (2 Credits Per Lead)
**File**: `scenario2-domain-only.csv`
**Purpose**: Test leads with only domain (need FindyMail enrichment)
**Expected Cost**: 3 leads × 2 credits = **6 credits**
**Expected Behavior**:
- All 3 leads should import successfully
- `enrichmentStatus` should be set to "pending"
- `skipEnrichment` flag should be false
- Backend should call FindyMail API for email enrichment
- Should proceed through normal enrichment → research flow

**Leads**:
1. GlobalTech Solutions (globaltech.com)
2. DataCorp Analytics (datacorp.io)
3. FinTech Innovations (fintechinnovations.com)

---

### Scenario 3: Mixed Valid/Invalid (Partial Success)
**File**: `scenario3-mixed-valid-invalid.csv`
**Purpose**: Test partial success with validation errors
**Expected Valid**: 3 leads
**Expected Invalid**: 3 leads
**Expected Cost**: 1 credit + 2 credits + 2 credits = **5 credits**

**Expected Behavior**:
- Valid rows should import successfully
- Invalid rows should be skipped with error messages
- Error report should show:
  - Row 2: "Company name is required"
  - Row 3: "Must provide either domain OR email"
  - Row 5: "Company name is required" + "Must provide either domain OR email"
- CSVErrorReport component should display detailed errors

**Valid Leads**:
1. Acme Corp (acme.com) - has email (1 credit)
2. Valid Company (validcompany.com) - has email (1 credit)
3. Another Valid (anothervalid.io) - domain only (2 credits)

**Invalid Leads**:
1. Row 2: Missing company name
2. Row 3: Missing domain
3. Row 5: Missing both company name and domain/email

---

### Scenario 4: CSV Injection Protection
**File**: `scenario4-csv-injection-test.csv`
**Purpose**: Test CSV injection attack prevention
**Expected Cost**: 5 leads × 1 credit = **5 credits** (all have emails)

**Expected Behavior**:
- All formulas should be sanitized with prepended single quote
- `notes` and `description` fields starting with `=`, `+`, `-`, `@` should be escaped
- Leads should import successfully with sanitized values
- No formula execution when exporting to Excel/Sheets

**Sanitization Tests**:
1. `=1+1` → `'=1+1`
2. `+cmd|'/c calc'!A1` → `'+cmd|'/c calc'!A1`
3. `-2+3` → `'-2+3`
4. `@mention style` → `'@mention style`

---

### Scenario 5: Comprehensive Fields
**File**: `scenario5-comprehensive-fields.csv`
**Purpose**: Test all 22 field mappings
**Expected Cost**: 3 leads × 1 credit = **3 credits** (all have emails)

**Fields Tested** (22 total):
- **Required**: company_name, domain
- **Contact Info**: contact_name, contact_email, contact_title, contact_linkedin, email, phone
- **Location**: address, city, state, country, postal_code
- **Business**: website, industry, description, notes
- **Social**: linkedin, twitter, facebook

**Expected Behavior**:
- All fields should be properly mapped and stored
- Both primary email and alternate email fields should be captured
- Location data should be stored (even though geocoding returns 0,0)
- Social media links should be preserved
- All optional fields should be handled gracefully (empty or present)

---

## Usage Instructions

### Manual Testing

1. **Start Development Servers**:
   ```bash
   # Terminal 1: Frontend
   cd apps/web
   pnpm dev

   # Terminal 2: Convex Backend (DO NOT use 'deploy' - user specified develop branch only)
   cd apps/convex-backend
   npx convex dev
   ```

2. **Access CSV Upload**:
   - Navigate to http://localhost:3000
   - Create a new search
   - Select "CSV Upload" as source
   - Download the sample template (if needed)

3. **Upload Test Files**:
   - Upload each scenario file
   - Review the column mapping (should auto-detect)
   - Confirm the import
   - Verify the results

4. **Verify Results**:
   - Check lead count matches expected valid rows
   - Verify credit deduction matches expected cost
   - For Scenario 3: Check error report displays correctly
   - For Scenario 4: Verify formulas are sanitized
   - Check backend logs for enrichment skip messages

### Automated Testing (Future)

Once E2E tests are implemented:
```bash
pnpm test:e2e
```

---

## Credit Cost Reference

| Scenario | Valid Leads | Credits | Calculation |
|----------|------------|---------|-------------|
| Scenario 1 | 3 | 3 | 3 × 1 (has email) |
| Scenario 2 | 3 | 6 | 3 × 2 (needs enrichment) |
| Scenario 3 | 3 | 5 | 1+1+2 (mixed) |
| Scenario 4 | 5 | 5 | 5 × 1 (has email) |
| Scenario 5 | 3 | 3 | 3 × 1 (has email) |
| **Total** | **17** | **22** | — |

---

## Expected Backend Behavior

### With Email (Scenario 1, 4, 5)
```typescript
// asyncEnrichment.ts should log:
"⏭️  Skipping Enrichment - Lead Already Has Emails"
"✅ Lead Marked as Enriched (CSV Import)"

// Lead object:
{
  enrichmentStatus: "completed",
  enrichmentProvider: "csv_import",
  contactInfo: {
    emails: ["john@acme.com"]
  },
  raw_data: {
    source: "csv_upload",
    skipEnrichment: true,
    costEstimate: { cost: 1, reason: "Has email (skip enrichment)" }
  }
}
```

### Domain Only (Scenario 2)
```typescript
// asyncEnrichment.ts should proceed with FindyMail:
"🔍 Starting Lead Enrichment"
"📧 Attempting FindyMail Enrichment"

// Lead object:
{
  enrichmentStatus: "pending", // then "processing", then "completed"
  enrichmentProvider: "findymail",
  raw_data: {
    source: "csv_upload",
    skipEnrichment: false,
    costEstimate: { cost: 2, reason: "Needs enrichment + research" }
  }
}
```

### Invalid Rows (Scenario 3)
```typescript
// Frontend should store in window.__csvImportErrors:
[
  {
    rowNumber: 2,
    companyName: undefined,
    errors: ["Company name is required"],
    warnings: [],
    rowData: { domain: "techstart.io", ... }
  },
  // ... more errors
]

// CSVErrorReport should display with suggested fixes
```

---

## Troubleshooting

### Issue: All leads charged 2 credits
**Cause**: Email detection not working
**Fix**: Check that `contact_email` or `email` columns are properly mapped

### Issue: CSV parsing fails with quoted commas
**Cause**: Using naive string split instead of papaparse
**Fix**: Verify papaparse is installed and used in UploadSource.ts

### Issue: Formulas execute in Excel
**Cause**: CSV injection protection not working
**Fix**: Check `sanitizeCSVValue()` function in UploadSource.ts

### Issue: Backend still calls FindyMail for leads with emails
**Cause**: Enrichment skip logic not working
**Fix**: Check `asyncEnrichment.ts` for the email detection logic

---

## File Locations

**Frontend**:
- Parser: `apps/web/src/pipeline/sources/UploadSource.ts`
- Upload UI: `apps/web/src/pipeline/FileUploadArea.tsx`
- Template: `apps/web/src/components/pipeline/CSVTemplateDownload.tsx`
- Error Report: `apps/web/src/components/pipeline/CSVErrorReport.tsx`
- Source Selector: `apps/web/src/components/pipeline/SourceSelector.tsx`

**Backend**:
- Schema: `apps/convex-backend/convex/schema.ts` (csvImports table)
- Enrichment: `apps/convex-backend/convex/leads/asyncEnrichment.ts` (skip logic)
- Tracking: `apps/convex-backend/convex/leads/mutations.ts` (trackCSVImport)

**Documentation**:
- Implementation: `CSV_UPLOAD_IMPLEMENTATION_SUMMARY.md`
- Testing Guide: `CSV_UPLOAD_TESTING_GUIDE.md`
- Analysis: `CSV_UPLOAD_ANALYSIS.md`

---

## Next Steps

1. ✅ Test each scenario manually
2. ✅ Verify credit calculations
3. ✅ Check error reporting UI
4. ✅ Validate CSV injection protection
5. ✅ Confirm enrichment skip logic
6. ⏳ Deploy to staging (when ready)
7. ⏳ Write E2E tests
8. ⏳ Deploy to production (user specified to NOT deploy Convex changes yet)

---

**Last Updated**: November 24, 2025
**Implementation Status**: 100% Complete - Ready for Development Testing
