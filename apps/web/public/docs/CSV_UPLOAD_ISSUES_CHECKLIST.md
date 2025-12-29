# CSV Upload System - Issues Checklist

## Issue Severity Distribution

- 🔴 **Critical**: 4 issues (Feature disabled, Parsing, Persistence, Memory)
- 🟠 **High**: 6 issues (Validation, Geocoding, Duplicates, Injection, Confidence, Cost)
- 🟡 **Medium**: 5 issues (Progress, Filtering, Retry, Editing, Excel)
- 🟢 **Low**: 5 issues (Mapping, Docs, Audit, Processing, Charset)

---

## CRITICAL ISSUES (Must Fix Before Production)

### Issue #1: Feature is DISABLED
- **File**: `SourceSelector.tsx:60`
- **Code**: `const isDisabled = source.type === "csv_upload";`
- **Status**: Intentional - "security and auth improvements" pending
- **Action**: Remove disable flag once other issues fixed

### Issue #2: Naive CSV Parsing (Not RFC 4180 Compliant)
- **File**: `UploadSource.ts:100-107`
- **Problem**: `lines[0].split(",")` breaks on quoted fields
- **Impact**: Data corruption on real CSVs with commas in fields
- **Fix**: Use `papaparse` library (~8 hours)
- **Test Cases Needed**: 
  - [ ] Quoted fields with commas
  - [ ] Escaped quotes within quotes
  - [ ] Newlines in fields
  - [ ] Mixed quoting styles

### Issue #3: No Data Persistence
- **Files**: `schema.ts` (missing table), `UploadSource.ts` (no backend)
- **Problem**: All data lost on browser refresh
- **Impact**: Critical for production use
- **Fix**: Add `csvImports` table + backend storage (~6 hours)
- **Required Schema**:
  ```typescript
  csvImports: {
    userId, fileName, fileSize, rowCount, validRowCount,
    invalidRows[], columnMapping, status, uploadedAt, processedAt
  }
  ```

### Issue #4: Memory-Based Processing
- **File**: `UploadSource.ts:88`
- **Problem**: `FileReader.readAsText()` loads entire CSV into memory
- **Impact**: Browser crashes on large files, poor UX
- **Fix**: Implement streaming/chunked processing (~16 hours)
- **Dependencies**: Add `csv-parse` or `stream-csv` library

---

## HIGH SEVERITY ISSUES (Should Fix Before Enable)

### Issue #5: No Email Format Validation
- **File**: `UploadSource.ts:123-131`
- **Problem**: Any string accepted as email, hardcoded 0.5 confidence
- **Fix**: 
  - [ ] Add regex email validation
  - [ ] Set confidence: 1.0 for valid, 0 for invalid
  - [ ] Implement duplicate email detection
- **Effort**: 4-6 hours

### Issue #6: Location Data Hardcoded as 0,0
- **File**: `UploadSource.ts:147-152`
- **Problem**: All leads have `lat: 0, lng: 0` (null island)
- **Impact**: Inconsistent with Google Maps leads, breaks geo analysis
- **Fix Options**:
  - [ ] Require address field in CSV
  - [ ] Use Google Geocoding API (~8 hours)
  - [ ] Parse address for city/state (~10 hours)
- **Effort**: 8-12 hours

### Issue #7: No Duplicate Detection
- **Files**: Entire pipeline
- **Problem**: Same company/email can be imported multiple times
- **Impact**: Wasted credits, duplicate outreach
- **Fix**: Add deduplication logic (~8 hours)
- **Types**: Company name, Email, Domain, Phone

### Issue #8: No CSV Injection Protection
- **File**: `UploadSource.ts:100-107`
- **Problem**: No sanitization of formula-like content
- **Examples**: `=cmd|'/C calc'!A0`, `@SUM(A1:A10)`
- **Fix**: Use `dompurify` library + custom validation (~4 hours)
- **Tests**:
  - [ ] Formula injection attempts
  - [ ] DDE attacks
  - [ ] Command injection

### Issue #9: Hardcoded Email Confidence (0.5)
- **File**: `UploadSource.ts:129`
- **Problem**: All emails get 0.5 regardless of validation status
- **Impact**: Poor personalization accuracy
- **Fix**: Calculate based on validation result
  - Valid format: 1.0
  - Invalid format: 0
  - Provide: 0.7

### Issue #10: Cost Estimation is Wrong
- **File**: `UploadSource.ts:51-52`
- **Problem**: `file.size / 100 * 2` is completely arbitrary
- **Impact**: Users don't know real costs
- **Fix**: 
  - [ ] Count actual CSV rows before processing
  - [ ] Calculate cost based on enrichment needs
  - [ ] Remove artificial 1000 cap
- **Effort**: 4-6 hours

---

## MEDIUM SEVERITY ISSUES

### Issue #11: No Streaming or Progress Tracking
- **Priority**: MEDIUM-HIGH
- **Effort**: 12-20 hours
- **Impact**: Poor UX for large files (>100K rows)

### Issue #12: Silent Row Filtering
- **Priority**: MEDIUM
- **Effort**: 2-4 hours
- **Quick Fix**: Show count of filtered vs imported rows

### Issue #13: No Retry Mechanism
- **Priority**: MEDIUM
- **Effort**: 4-8 hours
- **Impact**: Single error kills entire import

### Issue #14: No Bulk Edit Support
- **Priority**: MEDIUM
- **Effort**: 16-24 hours
- **Impact**: Poor UX if column mapping wrong

### Issue #15: No Excel Support
- **Priority**: MEDIUM
- **Effort**: 8-12 hours
- **Impact**: Friction for business users
- **Libraries**: `xlsx` library (17KB)

---

## LOW SEVERITY ISSUES

- [ ] **#16**: Simplistic column auto-mapping (2-4 hours)
- [ ] **#17**: No CSV format documentation (2-4 hours)
- [ ] **#18**: No audit trail (8-12 hours)
- [ ] **#19**: Browser-only processing (4-8 hours to move backend)
- [ ] **#20**: No charset detection (2-4 hours)

---

## Testing Gaps

### Unit Tests Needed (40+ test cases)

**UploadSource.ts** (25 test cases):
- [ ] RFC 4180 parsing (5 cases)
- [ ] Email validation (5 cases)
- [ ] Duplicate detection (5 cases)
- [ ] CSV injection (5 cases)
- [ ] Error handling (5 cases)

**FileUploadArea.tsx** (15 test cases):
- [ ] Drag-drop interaction (3 cases)
- [ ] File validation (3 cases)
- [ ] Column mapping (3 cases)
- [ ] Preview generation (3 cases)
- [ ] Error states (3 cases)

**LeadDiscoveryStage.tsx** (10 test cases):
- [ ] CSV path selection
- [ ] Pipeline integration
- [ ] Error recovery
- [ ] Cost estimation

### Integration Tests (8 test cases):
- [ ] Upload → Enrichment
- [ ] Upload → AI Analysis
- [ ] Upload → Export
- [ ] Error scenarios (5 cases)

### E2E Tests (5 test cases):
- [ ] Full CSV workflow
- [ ] Large file handling
- [ ] Special characters
- [ ] International data
- [ ] Performance benchmarks

---

## Implementation Phases

### Phase 1: Core Fixes (24-32 hours) 🔴

1. **RFC 4180 CSV Parser** (8 hours)
   - [ ] Add papaparse library
   - [ ] Replace parseCSVToLeads()
   - [ ] Add error handling
   - [ ] Test with edge cases

2. **Email Validation** (4 hours)
   - [ ] Add email-validator library
   - [ ] Implement regex validation
   - [ ] Set confidence dynamically
   - [ ] Add duplicate detection

3. **CSV Injection Protection** (4 hours)
   - [ ] Add dompurify library
   - [ ] Sanitize all field content
   - [ ] Test formula injection
   - [ ] Add security tests

4. **Data Persistence** (6 hours)
   - [ ] Create csvImports table
   - [ ] Add backend mutation
   - [ ] Store upload metadata
   - [ ] Add error tracking

5. **Location Fix** (4 hours)
   - [ ] Remove 0,0 placeholders
   - [ ] Require address field or geocoding
   - [ ] Validate coordinates
   - [ ] Test with real data

### Phase 2: Safety Features (16-24 hours) 🟠

- [ ] Server-side validation (4 hours)
- [ ] Audit trail system (6 hours)
- [ ] Rate limiting (4 hours)
- [ ] Example templates (2 hours)
- [ ] Error messages (4 hours)

### Phase 3: UX Enhancements (24-32 hours) 🟡

- [ ] Streaming processing (12 hours)
- [ ] Progress tracking UI (6 hours)
- [ ] Bulk edit interface (8 hours)
- [ ] Excel support (8 hours)

### Phase 4: Production (12-20 hours)

- [ ] Unit test suite (12 hours)
- [ ] Integration tests (6 hours)
- [ ] Documentation (4 hours)
- [ ] Security audit (4 hours)

---

## Dependencies to Add

```json
{
  "papaparse": "^5.4.1",
  "email-validator": "^2.0.1",
  "dompurify": "^3.0.6",
  "xlsx": "^0.18.5"
}
```

---

## Quick Fixes (Easy Wins)

These can be done quickly while planning larger fixes:

- [ ] Remove hardcoded 0.5 email confidence (30 min)
- [ ] Add row count feedback on import (1 hour)
- [ ] Create example CSV template (1 hour)
- [ ] Add user documentation (2 hours)
- [ ] Add error boundary to FileUploadArea (1 hour)

**Total Quick Wins**: ~6 hours

---

## Re-Enable Checklist

Before removing the disabled flag in SourceSelector.tsx:

- [ ] RFC 4180 parser implemented & tested
- [ ] Email validation working
- [ ] CSV injection protection active
- [ ] Data persistence layer ready
- [ ] Server-side validation complete
- [ ] Location data handling fixed
- [ ] Cost estimation corrected
- [ ] 40+ test cases passing
- [ ] Security audit passed
- [ ] Documentation complete
- [ ] Example files provided
- [ ] Performance tested (5MB+)

---

## Estimated Timeline

- **Quick Fixes**: 1 week (6 hours)
- **Phase 1**: 1 week (24-32 hours)
- **Phase 2**: 1 week (16-24 hours)
- **Phase 3**: 1.5 weeks (24-32 hours)
- **Phase 4**: 1 week (12-20 hours)

**Total**: 5-6 weeks of concurrent development (80-120 hours)

---

## Risk Assessment

| Phase | Risk | Mitigation |
|-------|------|-----------|
| Phase 1 | Breaking existing CSV export | Comprehensive tests |
| Phase 2 | Missing validation bugs | Integration tests |
| Phase 3 | Performance regression | Load testing |
| Phase 4 | Security issues | Professional audit |

---

## Success Criteria

✅ All 20 issues resolved or mitigated
✅ 90%+ test coverage for CSV module
✅ Security audit passed
✅ User documentation complete
✅ Example templates provided
✅ Performance: <1s for 1000 rows
✅ E2E tests passing
✅ Zero critical/high vulnerabilities

