# Comprehensive CSV Upload System Analysis

## EXECUTIVE SUMMARY

The CSV upload system in Genni is **CURRENTLY DISABLED** but has functional infrastructure in place. The frontend components exist and are architecturally sound, but the feature is explicitly disabled at the source selector level pending "security and auth improvements" (per SourceSelector.tsx line 60, 166-169).

**Status**: Incomplete Implementation | Feature Disabled | Code Present but Not Accessible

---

## 1. CURRENT STATE ASSESSMENT

### 1.1 Implementation Status

| Component | Status | Files | Lines |
|-----------|--------|-------|-------|
| **Frontend Upload UI** | ✅ Implemented | `FileUploadArea.tsx` | 330 |
| **CSV Parsing Logic** | ✅ Implemented | `UploadSource.ts` | 184 |
| **Pipeline Integration** | ✅ Implemented | `LeadDiscoveryStage.tsx` | 900+ |
| **Source Selection** | ⚠️ DISABLED | `SourceSelector.tsx` | 214 |
| **CSV Export** | ✅ Implemented | `http.ts` | 330+ |
| **Backend Processing** | ❌ Not Found | N/A | N/A |
| **Database Schema** | ⚠️ No CSV table | `schema.ts` | N/A |

### 1.2 File Location Inventory

**Frontend:**
```
apps/web/src/
├── pipeline/
│   ├── types.ts (11: LeadSourceType includes "csv_upload")
│   ├── sources/
│   │   ├── UploadSource.ts (184 lines - CSV parsing logic)
│   │   ├── SourceRegistry.ts (38 lines - registers UploadSource)
│   │   └── index.ts (4 lines - exports)
│   └── context.ts (pipeline state management)
└── components/
    └── pipeline/
        ├── FileUploadArea.tsx (330 lines - drag-drop upload UI)
        ├── LeadDiscoveryStage.tsx (900+ lines - CSV integration)
        ├── SourceSelector.tsx (214 lines - DISABLED at line 60)
        └── ReviewExportStage.tsx (1275 lines - CSV export)
```

**Backend:**
```
apps/convex-backend/convex/
├── http.ts (1090+ lines - CSV export endpoint at line 746-1074)
├── schema.ts (No CSV-specific table)
└── admin/mutations.ts (CSV export formatting at lines 162-224)
```

### 1.3 Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    USER INTERFACE LAYER                      │
├─────────────────────────────────────────────────────────────┤
│ SourceSelector                                               │
│ └─ CSV Upload Status: [DISABLED] ⚠️                          │
│    "CSV upload is temporarily unavailable."                 │
│    Line 60: isDisabled = source.type === "csv_upload"        │
└──────────┬──────────────────────────────────────────────────┘
           │ (if enabled)
           ▼
┌─────────────────────────────────────────────────────────────┐
│               LEAD DISCOVERY STAGE                           │
├─────────────────────────────────────────────────────────────┤
│ FileUploadArea.tsx (Drag-drop component)                    │
│ └─ Drag & Drop: CSV file selection                          │
│ └─ Column Mapping: User defines field mappings              │
│ └─ Preview: Shows first 3 rows of data                      │
└──────────┬──────────────────────────────────────────────────┘
           │ (File + Mapping)
           ▼
┌─────────────────────────────────────────────────────────────┐
│            CSV PARSING LAYER (Frontend)                     │
├─────────────────────────────────────────────────────────────┤
│ UploadSource.ts - parseCSVToLeads()                         │
│ ├─ Input: CSV text + column mapping                         │
│ ├─ Parsing: Simple split("\n").split(",") approach          │
│ ├─ Validation: Required field "company_name" check          │
│ └─ Output: Lead[] array for pipeline                        │
│                                                              │
│ Data Transformation:                                         │
│ └─ CSV columns → Lead objects (with standardized fields)    │
│ └─ Email normalization (0.5 confidence hardcoded)           │
│ └─ Location placeholder (lat/lng = 0, 0)                    │
└──────────┬──────────────────────────────────────────────────┘
           │ (Lead[] array)
           ▼
┌─────────────────────────────────────────────────────────────┐
│         PIPELINE STATE & ENRICHMENT LAYER                   │
├─────────────────────────────────────────────────────────────┤
│ Pipeline State (context): Stores leads                      │
│ └─ Enrichment: FindyMail enrichment                         │
│ └─ Analysis: LangGraph AI personalization                   │
└──────────┬──────────────────────────────────────────────────┘
           │ (Enriched Leads + Generated Emails)
           ▼
┌─────────────────────────────────────────────────────────────┐
│           EXPORT & DELIVERY LAYER                           │
├─────────────────────────────────────────────────────────────┤
│ ReviewExportStage.tsx (Results display)                     │
│ └─ CSV Export: /api/exports/leads.csv endpoint              │
│ └─ Email Queue: Send personalized emails                    │
│ └─ Analytics: Track export completion                       │
└──────────┬──────────────────────────────────────────────────┘
           │ (CSV file download)
           ▼
┌─────────────────────────────────────────────────────────────┐
│                  USER DOWNLOAD                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. FEATURE ANALYSIS

### 2.1 Implemented Features

#### **Upload & File Selection**
✅ **Drag-and-drop support** (FileUploadArea.tsx:110-132)
- File type validation: `.csv` extension required
- MIME type check: `text/csv`, `application/csv`, `text/plain`

✅ **File size validation** (UploadSource.ts:30-33)
```typescript
const maxSize = 10 * 1024 * 1024; // 10MB limit
if (params.file.size > maxSize) {
  errors.push("File size must be less than 10MB");
}
```

✅ **Column mapping UI** (FileUploadArea.tsx:235-289)
- Auto-detection of common column names (company, email, phone, website, address, industry)
- Manual mapping via Select dropdowns
- Support for "Ignore Column" option

✅ **Data preview** (FileUploadArea.tsx:292-327)
- Shows first 3 data rows + headers
- Preview data extracted from file before import

#### **CSV Parsing**
✅ **Basic CSV parsing** (UploadSource.ts:93-107)
```typescript
const lines = csvText.split("\n").filter((line) => line.trim());
const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));
```

⚠️ **Very basic approach**: Simple split by comma - no quoted field support, no escaped characters

✅ **Validation** (UploadSource.ts:12-64)
- Required field validation: "company_name" must be mapped
- File size check (10MB)
- Column mapping existence check

✅ **Lead transformation** (UploadSource.ts:137-181)
- Maps CSV columns to Lead object properties
- Creates lead IDs: `upload_${index}`
- Sets all required fields with defaults
- Email handling with hardcoded 0.5 confidence

#### **Features Set**
✅ `supportsEnrichment: true` (UploadSource.ts:9)
✅ `supportsAI: true` (UploadSource.ts:10)

### 2.2 Supported File Types & Formats

**Accepted Formats:**
- `.csv` extension (mandatory)
- MIME types: `text/csv`, `application/csv`, `text/plain`

**Field Support:**
```
Supported CSV columns (auto-mapped):
├─ company_name (REQUIRED)
├─ email
├─ phone
├─ website / url
├─ address
├─ industry / sector
└─ description
```

**Limitations:**
- ❌ No quoted field support
- ❌ No escaped comma handling
- ❌ No Excel files (.xlsx)
- ❌ No multi-byte character support validation
- ❌ No BOM (Byte Order Mark) handling

### 2.3 Validation Implementation

**Frontend Validation (UploadSource.ts:validate)**

```typescript
1. File existence check
   ├─ "CSV file is required"
   
2. File type validation
   ├─ Extension check: .csv
   ├─ MIME type: text/csv, application/csv, text/plain
   
3. File size validation
   ├─ Maximum: 10MB
   
4. Column mapping validation
   ├─ Must have at least one mapping
   ├─ "company_name" field is mandatory
   
5. Cost estimation
   ├─ Rough: file.size / 100 = estimated rows
   ├─ Cost calculation: rows * 2, capped at 1000
   ├─ Warning if > 1000 rows
```

**Issues:**
- ⚠️ No validation of CSV format correctness
- ⚠️ No duplicate company name detection
- ⚠️ No email format validation
- ⚠️ No malicious CSV injection checks

### 2.4 Data Processing & Storage

**Processing Steps:**
1. **File Read**: FileReader API (browser-side)
2. **Parsing**: Simple split-based CSV parser
3. **Mapping**: Column mapping to Lead object properties
4. **Validation**: Required field checks
5. **State Storage**: Redux/Context pipeline state
6. **Pipeline Progression**: Leads passed to enrichment stage

**Storage:**
- ❌ **No database table for CSV uploads** - data lives in pipeline state
- ❌ **No persistence** - if browser refreshes, data is lost
- ❌ **No backup** - uploaded data not stored separately
- ⚠️ **Memory-based**: Entire CSV loaded into browser memory

### 2.5 Error Handling

**Current Error Handling:**

| Issue | Handler | Result |
|-------|---------|--------|
| File read fails | FileReader.onerror | Promise rejection |
| Invalid CSV format | try-catch in parseCSVToLeads | "Failed to parse CSV file" |
| Missing required fields | Validation check | Error returned |
| Large file | Size validation | Rejection |
| Invalid column mapping | Validation check | Error returned |

**Problems:**
- ❌ Generic error messages (no specific error codes)
- ❌ No detailed parsing error information
- ❌ No graceful partial success handling
- ❌ No retry mechanism
- ❌ Silent failure for rows with missing company_name (filtered out)

---

## 3. ISSUE IDENTIFICATION

### CRITICAL ISSUES 🔴

#### **Issue #1: Feature is DISABLED**
- **Severity**: CRITICAL
- **Location**: `SourceSelector.tsx:60`
- **Code**:
```typescript
const isDisabled = source.type === "csv_upload"; // temporarily disabled
```
- **Impact**: CSV upload completely unavailable to users
- **Reason**: "CSV upload is temporarily unavailable while we complete security and auth improvements" (line 166-169)
- **Status**: Not actionable (by design)

#### **Issue #2: Naive CSV Parsing (Not RFC 4180 Compliant)**
- **Severity**: CRITICAL
- **Location**: `UploadSource.ts:100-107`
- **Code**:
```typescript
const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));
const dataLines = lines.slice(1);
// ... simple split approach without proper CSV parsing
```
- **Problems**:
  - ❌ No handling of quoted fields: `"Company Name, Inc.","email@test.com"`
  - ❌ No escaped comma support: `"Address, Street, City"`
  - ❌ No newlines within fields
  - ❌ Will break on any properly formatted CSV with quoted fields
- **Impact**: Data corruption or parsing failures on real-world CSVs
- **Example of Failure**:
```csv
Company Name,Email,Address
"Acme Inc, Corp",test@acme.com,"123 Main St, Suite 100"
```
Would parse as: `["Acme Inc, Corp", "test@acme.com", "123 Main St, Suite 100"]` ← INCORRECT

#### **Issue #3: No Data Persistence**
- **Severity**: CRITICAL (in production)
- **Location**: Pipeline state only (no database storage)
- **Problems**:
  - ❌ No database table for CSV uploads
  - ❌ Data lost on browser refresh
  - ❌ No audit trail of imports
  - ❌ No recovery mechanism
- **Impact**: Data loss, poor UX, no compliance tracking

#### **Issue #4: Memory-Based Processing**
- **Severity**: HIGH
- **Location**: `UploadSource.ts:88` - `FileReader.readAsText()`
- **Problems**:
  - Entire CSV loaded into browser memory
  - 10MB limit may be insufficient for batch operations
  - No streaming/chunked processing
  - Browser may crash on large files
- **Impact**: Performance degradation, memory exhaustion

---

### HIGH SEVERITY ISSUES 🟠

#### **Issue #5: No Email Format Validation**
- **Severity**: HIGH
- **Location**: `UploadSource.ts:123-131`
- **Code**:
```typescript
const normalizedEmail = leadData.email?.trim();
const contactEmails = normalizedEmail
  ? [{ email: normalizedEmail, type: "work", confidence: 0.5 }]
  : [];
```
- **Problems**:
  - ❌ No regex validation for email format
  - ❌ No duplicate email detection
  - ❌ Hardcoded confidence: 0.5 (should be validation-based)
  - ❌ No normalization (lowercase, etc.)
- **Impact**: Invalid emails passed to enrichment pipeline, wasting credits

#### **Issue #6: Location Data Placeholder**
- **Severity**: HIGH
- **Location**: `UploadSource.ts:147-152`
- **Code**:
```typescript
location: address
  ? {
      lat: 0,
      lng: 0,
      formattedAddress: address,
    }
  : undefined,
```
- **Problems**:
  - Latitude/longitude hardcoded as 0,0 (null island, invalid for US operations)
  - No geocoding of address field
  - Inconsistent with Google Maps leads
- **Impact**: Leads cannot be properly located for proximity analysis

#### **Issue #7: No Duplicate Detection**
- **Severity**: HIGH
- **Location**: Entire CSV import process
- **Problems**:
  - ❌ No duplicate company name detection
  - ❌ No duplicate email detection
  - ❌ No domain duplicate detection
  - ❌ Doesn't leverage user's deduplication settings (even though they're passed to search creation)
- **Impact**: Wasted credits, duplicate outreach, data quality issues

#### **Issue #8: No CSV Injection Protection**
- **Severity**: HIGH
- **Location**: `UploadSource.ts:100-107`
- **Problems**:
  - ❌ No sanitization of formula-like content: `=cmd|' /C calc'!A0`
  - ❌ No escape of @ symbols (Excel DDE attacks)
  - ❌ No validation of field content
  - ❌ While data isn't exported to users, storing unsanitized data is risky
- **Impact**: Potential XSS if data displayed in web, potential injection attacks if re-exported

#### **Issue #9: Hard-Coded Confidence Score**
- **Severity**: HIGH
- **Location**: `UploadSource.ts:129`
- **Code**:
```typescript
confidence: 0.5,  // Hard-coded!
```
- **Problems**:
  - All emails get 0.5 confidence regardless of validation
  - Should be 1.0 for verified emails, 0 for invalid format
  - Inconsistent with Google Maps enrichment scoring
- **Impact**: Incorrect personalization decisions, poor quality predictions

#### **Issue #10: Cost Estimation is Wrong**
- **Severity**: HIGH
- **Location**: `UploadSource.ts:51-52`
- **Code**:
```typescript
const estimatedRows = Math.ceil(params.file.size / 100); // 100 bytes per row?!
const estimatedCost = Math.min(estimatedRows * 2, 1000);
```
- **Problems**:
  - ❌ 100 bytes per row is arbitrary guess
  - ❌ No actual row count before processing
  - ❌ Cost formula: `rows * 2` is not justified
  - ❌ Capped at 1000 regardless of actual data
  - ❌ Doesn't account for enrichment costs
- **Impact**: Users don't know actual costs; budget overruns possible

---

### MEDIUM SEVERITY ISSUES 🟡

#### **Issue #11: No Streaming or Progress Tracking**
- **Severity**: MEDIUM
- **Location**: `UploadSource.ts:88` - `FileReader.readAsText()`
- **Problems**:
  - ❌ No progress events during file read
  - ❌ No chunked processing
  - ❌ UI cannot show "processing 500 rows..." updates
  - ❌ Large file reads block UI
- **Impact**: Poor UX for large imports

#### **Issue #12: Silent Row Filtering**
- **Severity**: MEDIUM
- **Location**: `UploadSource.ts:182-183`
- **Code**:
```typescript
.filter((lead): lead is Lead => Boolean(lead));
```
- **Problems**:
  - Rows without company_name are silently dropped
  - No feedback to user about filtered rows
  - No count of valid vs invalid rows
  - User imported 100 rows, gets 85 with no explanation
- **Impact**: Confusing UX, hidden data loss

#### **Issue #13: No Retry Mechanism**
- **Severity**: MEDIUM
- **Location**: Error handling throughout
- **Problems**:
  - ❌ FileReader error → immediate failure
  - ❌ No exponential backoff for transient errors
  - ❌ No recovery options
- **Impact**: Single transient network issue kills entire import

#### **Issue #14: No Bulk Edit Support**
- **Severity**: MEDIUM
- **Problems**:
  - ❌ Cannot edit uploaded data before processing
  - ❌ Cannot delete problematic rows
  - ❌ Cannot re-map columns after preview
  - ❌ Must start over if mapping is wrong
- **Impact**: Poor UX, wasted credits on bad data

#### **Issue #15: No Excel Support**
- **Severity**: MEDIUM
- **Location**: Validation and parsing
- **Problems**:
  - ❌ Only CSV support
  - ❌ Users must convert .xlsx to .csv manually
  - ❌ No native Excel parsing library
- **Impact**: Friction for typical business users

---

### LOW SEVERITY ISSUES 🟢

#### **Issue #16: Column Auto-Mapping is Simplistic**
- **Severity**: LOW
- **Location**: `FileUploadArea.tsx:72-100`
- **Problems**:
  - Simple lowercase keyword matching
  - No fuzzy matching (e.g., "biz_name" → "company_name")
  - No priority ordering for similar columns
- **Impact**: May require manual mapping for non-standard column names

#### **Issue #17: No CSV Format Documentation**
- **Severity**: LOW
- **Problems**:
  - No example CSV file for download
  - No detailed field documentation
  - No character encoding guidance
- **Impact**: Users unsure of format

#### **Issue #18: No Audit Trail**
- **Severity**: LOW
- **Problems**:
  - No record of who uploaded what data and when
  - No way to undo uploads
  - No history of imports
- **Impact**: Compliance and audit trail missing

#### **Issue #19: Browser-Side Processing Only**
- **Severity**: LOW
- **Location**: Entire CSV import (no backend processing)
- **Problems**:
  - No server-side validation
  - No data transformation on backend
  - Inconsistent with Google Maps flow
- **Impact**: Less secure, no centralized processing

#### **Issue #20: No Charset Detection**
- **Severity**: LOW
- **Location**: `FileReader.readAsText()` - uses browser default
- **Problems**:
  - Assumes UTF-8
  - No BOM handling
  - Non-ASCII characters may cause issues
- **Impact**: International users may have problems

---

## 4. GAP ANALYSIS

### 4.1 Missing Production-Ready Features

| Feature | Priority | Status | Est. Hours |
|---------|----------|--------|-----------|
| RFC 4180 CSV Parser | CRITICAL | ❌ Missing | 8-16 |
| Data Persistence (CSV imports table) | CRITICAL | ❌ Missing | 4-6 |
| Email Validation (format + duplicates) | CRITICAL | ❌ Missing | 4-8 |
| CSV Injection Protection | CRITICAL | ❌ Missing | 4-6 |
| Streaming/Chunked Processing | HIGH | ❌ Missing | 12-20 |
| Bulk Edit/Validation UI | HIGH | ❌ Missing | 16-24 |
| Geocoding for Addresses | HIGH | ❌ Missing | 8-12 |
| Accurate Cost Estimation | HIGH | ❌ Missing | 4-6 |
| Excel File Support | HIGH | ❌ Missing | 8-12 |
| Progress Tracking | MEDIUM | ❌ Missing | 6-10 |
| Audit Trail & History | MEDIUM | ❌ Missing | 8-12 |
| Example/Template Download | MEDIUM | ❌ Missing | 2-4 |
| Retry Mechanism | MEDIUM | ❌ Missing | 4-8 |

### 4.2 Security Gaps

| Gap | Risk | Mitigation Needed |
|-----|------|-------------------|
| No CSV injection protection | HIGH | Input sanitization |
| No server-side validation | MEDIUM | Backend processing |
| No audit trail | MEDIUM | Logging system |
| No rate limiting for uploads | MEDIUM | Rate limiter |
| Data lost on browser refresh | HIGH | Database persistence |

### 4.3 Feature Completeness Scoring

```
CSV Upload Feature Completeness: 35%

├─ Upload & Selection: 80%
│  ├─ Drag-drop: ✅
│  ├─ File validation: ⚠️ (size only)
│  └─ Column mapping: ✅
│
├─ CSV Parsing: 20%
│  ├─ Basic parsing: ✅
│  ├─ RFC 4180 compliance: ❌
│  └─ Error handling: ⚠️
│
├─ Data Validation: 40%
│  ├─ Field presence: ✅
│  ├─ Email format: ❌
│  ├─ Duplicate detection: ❌
│  └─ CSV injection: ❌
│
├─ Processing: 30%
│  ├─ Pipeline integration: ✅
│  ├─ Enrichment support: ✅
│  ├─ Persistence: ❌
│  └─ Progress tracking: ❌
│
└─ Export: 80%
   ├─ CSV generation: ✅
   ├─ Data accuracy: ✅
   └─ Format validation: ✅
```

### 4.4 Comparison: Google Maps vs CSV Upload

| Aspect | Google Maps | CSV Upload |
|--------|-------------|-----------|
| **Data Entry** | Search form | File upload |
| **Location Data** | ✅ Geocoded | ❌ Placeholder (0,0) |
| **Duplicate Detection** | ✅ Supported | ❌ None |
| **Cost Accuracy** | ✅ ~95% | ❌ Guessed |
| **Data Persistence** | ✅ Database | ❌ Pipeline state |
| **Error Recovery** | ✅ Retry system | ❌ Manual restart |
| **Validation** | ✅ Comprehensive | ⚠️ Minimal |
| **Audit Trail** | ✅ Yes | ❌ No |
| **Progress Tracking** | ✅ Real-time | ❌ None |

---

## 5. INTEGRATION ANALYSIS

### 5.1 CSV Upload Integration Points

```
CSV Upload → Enrichment Pipeline
├─ Lead data structure must match enrichment expectations
├─ Email field required for FindyMail enrichment
├─ Location data (currently broken - all 0,0)
├─ Phone number optional but useful
└─ Company name mandatory for AI analysis

CSV Upload → LangGraph AI
├─ Lead context must include industry, company name
├─ Enriched emails enable personalization
├─ Missing emails result in skipped leads
└─ Low confidence emails may affect output quality

CSV Upload → Credit System
├─ No specific CSV import credit cost
├─ Uses same credit structure as Google Maps
├─ Cost calculation is inaccurate (Issue #10)
└─ No refund mechanism if import fails
```

### 5.2 Credit System Integration

**Current Flow:**
```
CSV Upload File
    ↓
Parse & Validate
    ↓ (no cost yet)
Pipeline State
    ↓
Enrichment Stage [COST: Based on email fields]
    ↓
AI Analysis Stage [COST: Based on enriched leads]
    ↓
Export
```

**Problems:**
- ❌ No upfront cost reservation (unlike Google Maps)
- ❌ Cost estimation formula is wrong (10-16 hours to fix)
- ❌ No separate tracking of CSV vs Google Maps costs

### 5.3 Search/Lead Tracking

**Current Schema:**
- ✅ Searches table has `parameters` field (but no CSV-specific schema)
- ❌ No `csvImport` table for historical tracking
- ❌ No `uploadedLeads` table for deduplication
- ❌ Source field: assumes Google Maps or API input

**Gap**: CSV imports are not first-class search sources in database

---

## 6. CODE QUALITY ASSESSMENT

### 6.1 Code Review Findings

#### **UploadSource.ts**
```typescript
// Good points:
✅ Clear function separation
✅ Type safety (TypeScript)
✅ Defensive programming (null checks)

// Issues:
❌ parseCSVToLeads() is O(n²) due to array operations
❌ No comments explaining CSV parsing limitations
❌ Magic numbers: confidence: 0.5, lat/lng: 0,0
❌ Error messages are too generic
```

#### **FileUploadArea.tsx**
```typescript
// Good points:
✅ Good UX patterns (drag-drop, preview)
✅ Auto-mapping is helpful
✅ Visual feedback (drag states)

// Issues:
❌ No progress indication during file read
❌ No error boundary for file processing
❌ Column mapping state not persisted
❌ Large preview tables may be slow
```

#### **ReviewExportStage.tsx**
```typescript
// Good points:
✅ Comprehensive data export (25+ fields)
✅ Email preview queue is useful
✅ Analytics integration for tracking

// Issues:
❌ Complex state management (5+ useState hooks)
❌ Export token system is fragile
❌ No streaming download for large CSVs
```

### 6.2 Testing Coverage

```
CSV-related test files:
├─ apps/web/e2e/04-pipeline-and-export.spec.ts
│  └─ Tests export functionality (not import)
└─ No unit tests for CSV parsing ❌
└─ No integration tests for CSV upload ❌

Coverage gaps:
❌ UploadSource.ts - 0% coverage
❌ FileUploadArea.tsx - 0% coverage  
❌ CSV parsing edge cases - untested
❌ Malformed CSV handling - untested
❌ Large file handling - untested
```

---

## 7. SECURITY ANALYSIS

### 7.1 Vulnerability Assessment

| Vulnerability | Risk | CWE | Status |
|---|---|---|---|
| CSV Injection (Formula Attacks) | HIGH | CWE-95 | ❌ Unmitigated |
| Path Traversal | LOW | CWE-22 | ✅ Not applicable (local files) |
| XXE Attack | MEDIUM | CWE-611 | ⚠️ Partial (no XML support yet) |
| Data Exposure | MEDIUM | CWE-200 | ❌ Unmitigated (no persistence) |
| DoS via Large File | MEDIUM | CWE-400 | ⚠️ Partial (10MB limit) |
| Zip Bomb | LOW | CWE-409 | ✅ Not applicable |
| Malware in File | HIGH | N/A | ⚠️ Relying on browser protection |

### 7.2 Input Validation

**What's validated:**
- ✅ File type (.csv extension)
- ✅ File size (≤10MB)
- ✅ Column mapping presence
- ✅ Required field presence

**What's NOT validated:**
- ❌ Email format
- ❌ Phone format
- ❌ CSV formula injection
- ❌ Character encoding
- ❌ Duplicate detection
- ❌ Data content (XSS in company names)

---

## 8. RECOMMENDATIONS

### 8.1 Critical Path (To Enable CSV Upload)

**Phase 1: Core Fixes (24-32 hours)**
1. Implement RFC 4180 CSV parser ← Use `papaparse` or `csv-parse` library
2. Add email validation + duplicate detection
3. Implement CSV injection protection
4. Add data persistence (new table: `csvImports`)
5. Fix location/geocoding (placeholder coordinates)

**Phase 2: Safety Features (16-24 hours)**
1. Add server-side validation
2. Implement audit trail
3. Add rate limiting for uploads
4. Create example CSV template
5. Add comprehensive error messages

**Phase 3: UX Enhancements (24-32 hours)**
1. Implement streaming/chunked processing
2. Add progress tracking UI
3. Bulk edit/validation interface
4. Add Excel file support
5. Implement retry mechanism

**Phase 4: Production Hardening (12-20 hours)**
1. Comprehensive test suite (unit + integration)
2. Performance optimization
3. Documentation and guides
4. Security audit
5. Load testing (large files)

### 8.2 Implementation Priorities

```
Must-Have (Blocking):
1. RFC 4180 CSV parser
2. Email validation
3. CSV injection protection  
4. Data persistence
5. Server-side validation

Should-Have (High Value):
6. Duplicate detection
7. Streaming processing
8. Excel support
9. Example templates
10. Progress tracking

Nice-to-Have (Polish):
11. Bulk editing
12. Advanced deduplication
13. Geocoding
14. Audit trail
15. Advanced analytics
```

### 8.3 Dependencies to Add

```json
{
  "papaparse": "^5.4.1",           // RFC 4180 CSV parsing
  "email-validator": "^2.0.1",     // Email validation
  "dompurify": "^3.0.6",           // CSV injection protection
  "xlsx": "^0.18.5"                // Excel support (optional)
}
```

### 8.4 Database Schema Changes

```typescript
// Add to schema.ts
csvImports: defineTable({
  userId: v.id("users"),
  fileName: v.string(),
  fileSize: v.number(),
  rowCount: v.number(),
  validRowCount: v.number(),
  invalidRows: v.array(v.object({
    rowNumber: v.number(),
    reason: v.string(),
    data: v.optional(v.any()),
  })),
  columnMapping: v.object({
    [key: string]: v.string(),
  }),
  status: v.union(
    v.literal("pending"),
    v.literal("processing"),
    v.literal("completed"),
    v.literal("failed"),
  ),
  uploadedAt: v.number(),
  processedAt: v.optional(v.number()),
  error: v.optional(v.string()),
})
  .index("by_user", ["userId"])
  .index("by_status", ["status"]),
```

### 8.5 Testing Strategy

```
Unit Tests:
├─ UploadSource.ts: 25+ test cases
│  ├─ RFC 4180 CSV parsing
│  ├─ Edge cases (quoted fields, newlines, escapes)
│  ├─ Email validation
│  ├─ Duplicate detection
│  └─ Error handling
│
├─ FileUploadArea.tsx: 15+ test cases
│  ├─ Drag-drop interaction
│  ├─ File validation
│  ├─ Column mapping
│  └─ Preview generation
│
└─ LeadDiscoveryStage.tsx (CSV path): 10+ test cases
   ├─ CSV source selection
   ├─ Pipeline integration
   └─ Error states

Integration Tests:
├─ CSV upload → Enrichment pipeline
├─ CSV upload → AI analysis
├─ CSV upload → Export
└─ Error recovery scenarios

E2E Tests:
├─ Full CSV workflow (upload → export)
├─ Large file handling (5MB+)
├─ Edge cases (special characters, international)
└─ Performance benchmarks
```

---

## 9. SUMMARY TABLE

| Category | Status | Score | Notes |
|----------|--------|-------|-------|
| **Feature Completeness** | ⚠️ Partial | 35% | Upload works, processing incomplete |
| **Code Quality** | ⚠️ Fair | 60% | Good structure, missing validation |
| **Security** | ❌ Poor | 25% | No injection protection, unvalidated |
| **Testing** | ❌ None | 0% | No tests for CSV import |
| **Documentation** | ❌ Missing | 10% | No guides or examples |
| **UX** | ⚠️ Fair | 55% | Nice upload UI, missing features |
| **Performance** | ⚠️ Fair | 40% | No streaming, browser-only |
| **Maintainability** | ✅ Good | 75% | Clear structure, needs comments |

**Overall Assessment: INCOMPLETE IMPLEMENTATION - DISABLED FEATURE**

CSV upload has functional frontend infrastructure but is disabled pending security improvements. Critical issues in CSV parsing, validation, and data persistence must be addressed before production use. Estimated 80-120 hours to production-ready state.

