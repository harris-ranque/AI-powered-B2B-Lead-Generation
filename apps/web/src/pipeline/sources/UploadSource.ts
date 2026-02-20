import Papa from "papaparse";
import type { LeadSource, SourceParams, ValidationResult, CSVFetchResult, CSVImportStats } from "../types";
import type { Lead } from "@/lib/types";

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validates email format (RFC 5322 basic check)
 */
export function validateEmail(email: string): boolean {
  if (!email || typeof email !== "string") return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

/**
 * Validates domain format
 */
export function validateDomain(domain: string): boolean {
  if (!domain || typeof domain !== "string") return false;
  const domainRegex = /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/i;
  return domainRegex.test(domain.trim());
}

/**
 * Extracts domain from website URL
 * Examples:
 *   "https://www.example.com/path" -> "example.com"
 *   "www.example.com" -> "example.com"
 *   "example.com" -> "example.com"
 */
export function extractDomain(url?: string): string {
  if (!url) return "";

  try {
    // Add protocol if missing
    const urlWithProtocol = url.startsWith("http") ? url : `https://${url}`;
    const parsedUrl = new URL(urlWithProtocol);
    // Remove "www." prefix
    return parsedUrl.hostname.replace(/^www\./, "");
  } catch {
    // Fallback: simple string manipulation
    return url
      .replace(/^(https?:\/\/)?(www\.)?/, "")
      .split("/")[0]
      .toLowerCase() || "";
  }
}

/**
 * Sanitizes cell value to prevent CSV injection attacks
 * Escapes formula characters: =, +, -, @, \t, \r, \n, |
 * Also escapes quotes to prevent breaking CSV structure
 */
export function sanitizeCSVValue(value: string): string {
  if (!value || typeof value !== "string") return value;

  const trimmed = value.trim();
  const dangerousChars = ["=", "+", "-", "@", "\t", "\r", "\n", "|"];

  // Check if starts with dangerous character
  if (dangerousChars.some((char) => trimmed.startsWith(char))) {
    // Prepend single quote to prevent formula execution in Excel
    return `'${trimmed}`;
  }

  // Escape existing quotes by doubling them (CSV standard)
  if (trimmed.includes('"')) {
    return trimmed.replace(/"/g, '""');
  }

  return trimmed;
}

/**
 * Validates phone number format (international)
 */
export function validatePhone(phone: string): boolean {
  if (!phone || typeof phone !== "string") return false;
  const phoneRegex = /^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,9}$/;
  return phoneRegex.test(phone.replace(/\s/g, ""));
}

/**
 * Validates URL format
 */
export function validateUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  try {
    new URL(url.startsWith("http") ? url : `https://${url}`);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// CREDIT CALCULATION
// ============================================================================

export interface RowCostEstimate {
  cost: number;
  reason: string;
  skipEnrichment: boolean;
}

/**
 * Calculate credit cost for a single CSV row
 *
 * Logic:
 * - Has valid email AND contact_name → 1 credit (skip enrichment, research only)
 * - Has email but no contact_name → 2 credits (enrichment via domain from email)
 * - Has domain but no email → 2 credits (enrichment + research)
 * - No domain AND no email → 0 credits (invalid, will be skipped)
 */
export function calculateRowCost(row: Record<string, string>): RowCostEstimate {
  const contactEmail = row.contact_email || row.email;
  const contactName = row.contact_name;
  const domain = extractDomain(row.domain) || extractDomain(row.website);

  // Priority 1: Has valid email AND contact name → Skip enrichment → 1 credit
  if (contactEmail && validateEmail(contactEmail) && contactName?.trim()) {
    return {
      cost: 1,
      reason: "Has email and contact name (skip enrichment)",
      skipEnrichment: true,
    };
  }

  // Priority 2: Has email but no contact name → Need FindyMail for contact discovery
  // Extract domain from email if no explicit domain provided
  if (contactEmail && validateEmail(contactEmail)) {
    const emailDomain = contactEmail.split("@")[1] || "";
    const effectiveDomain = domain || emailDomain;
    if (effectiveDomain && validateDomain(effectiveDomain)) {
      return {
        cost: 2,
        reason: "Needs enrichment for contact discovery",
        skipEnrichment: false,
      };
    }
    // Has email but no usable domain — keep as 1 credit fallback
    return {
      cost: 1,
      reason: "Has email (skip enrichment)",
      skipEnrichment: true,
    };
  }

  // Priority 3: Has domain → Need enrichment → 2 credits
  if (domain && validateDomain(domain)) {
    return {
      cost: 2,
      reason: "Needs enrichment + research",
      skipEnrichment: false,
    };
  }

  // Priority 4: No domain AND no email → Invalid → 0 credits (skip)
  return {
    cost: 0,
    reason: "Missing domain and email",
    skipEnrichment: false,
  };
}

// ============================================================================
// ROW VALIDATION
// ============================================================================

export interface RowValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  rowData: Record<string, string>;
  costEstimate: RowCostEstimate;
}

/**
 * Validates a single CSV row
 */
export function validateRow(
  row: Record<string, string>,
  rowNumber: number,
): RowValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Sanitize all values to prevent CSV injection
  const sanitizedRow: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    sanitizedRow[key] = sanitizeCSVValue(value);
  }

  // REQUIRED: Company name
  const companyName = sanitizedRow.company_name || sanitizedRow.businessName;
  if (!companyName || companyName.trim().length === 0) {
    errors.push("Company name is required");
  }

  // CRITICAL: Must have either domain OR email
  const contactEmail = sanitizedRow.contact_email || sanitizedRow.email;
  const domain = extractDomain(sanitizedRow.domain) || extractDomain(sanitizedRow.website);

  if (!domain && !contactEmail) {
    errors.push("Must provide either domain OR email address");
  }

  // Validate email format if provided
  if (contactEmail && !validateEmail(contactEmail)) {
    errors.push(`Invalid email format: ${contactEmail}`);
  }

  // Validate domain format if provided
  if (domain && !validateDomain(domain)) {
    warnings.push(`Invalid domain format: ${domain}`);
  }

  // Validate phone if provided
  if (sanitizedRow.phone && !validatePhone(sanitizedRow.phone)) {
    warnings.push(`Invalid phone format: ${sanitizedRow.phone}`);
  }

  // Validate website URL if provided
  if (sanitizedRow.website && !validateUrl(sanitizedRow.website)) {
    warnings.push(`Invalid website URL: ${sanitizedRow.website}`);
  }

  // Calculate cost estimate
  const costEstimate = calculateRowCost(sanitizedRow);

  // Add cost validation
  if (costEstimate.cost === 0) {
    errors.push("Cannot process: missing required data for enrichment");
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    rowData: sanitizedRow,
    costEstimate,
  };
}

// ============================================================================
// MAIN UPLOAD SOURCE
// ============================================================================

export const UploadSource: LeadSource = {
  type: "csv_upload",
  name: "CSV Upload",
  description: "Import leads from your existing CSV files or CRM exports",
  icon: "Upload",
  supportsEnrichment: true,
  supportsAI: true,

  validate: (params: SourceParams): ValidationResult => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // File validation
    if (!params.file) {
      errors.push("CSV file is required");
      return { isValid: false, errors, warnings };
    }

    // File type validation
    const allowedTypes = ["text/csv", "application/csv", "text/plain"];
    const fileExtension = params.file.name.toLowerCase().split(".").pop();

    if (!allowedTypes.includes(params.file.type) && fileExtension !== "csv") {
      errors.push("File must be a CSV format");
    }

    // File size validation (10MB limit)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (params.file.size > maxSize) {
      errors.push("File size must be less than 10MB");
    }

    // Column mapping validation
    if (!params.columns || Object.keys(params.columns).length === 0) {
      errors.push("Column mapping is required");
    } else {
      const requiredFields = ["company_name"];
      const mappedFields = Object.values(params.columns);

      for (const field of requiredFields) {
        if (!mappedFields.includes(field)) {
          errors.push(`Required field '${field}' must be mapped`);
        }
      }

      // Check if at least domain OR email is mapped
      const hasDomain = mappedFields.includes("domain") || mappedFields.includes("website");
      const hasEmail = mappedFields.includes("contact_email") || mappedFields.includes("email");

      if (!hasDomain && !hasEmail) {
        errors.push("Must map either 'domain' OR 'email' field");
      }
    }

    // File size-based estimates
    const estimatedRows = Math.ceil(params.file.size / 100);

    if (estimatedRows > 5000) {
      errors.push("File exceeds maximum 5,000 rows");
    } else if (estimatedRows > 1000) {
      warnings.push("Large files may take longer to process");
    }

    // For validation, use worst-case estimate (will be refined when user clicks Start)
    // Actual cost calculation happens during parsing with calculateRowCost()
    const estimatedCost = Math.min(estimatedRows * 2, 5000);

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      estimatedCost,
      metadata: {
        estimatedRows,
        note: "Actual cost calculated after parsing (1 credit with email, 2 credits without)"
      }
    };
  },

  fetch: async (params: SourceParams): Promise<CSVFetchResult> => {
    if (!params.file || !params.columns) {
      throw new Error("File and column mapping required");
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (event) => {
        try {
          const csvText = event.target?.result as string;
          const result = parseCSVToLeads(csvText, params.columns!);
          resolve(result);
        } catch (error) {
          reject(new Error(`Failed to parse CSV file: ${error instanceof Error ? error.message : 'Unknown error'}`));
        }
      };

      reader.onerror = () => {
        reject(new Error("Failed to read file"));
      };

      reader.readAsText(params.file);
    });
  },
};

// ============================================================================
// CSV PARSING
// ============================================================================

function parseCSVToLeads(
  csvText: string,
  columnMapping: Record<string, string>,
): CSVFetchResult {
  // Parse CSV with papaparse (RFC 4180 compliant)
  const parseResult = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
    transform: (value) => value.trim(),
  });

  if (parseResult.errors.length > 0) {
    console.error("CSV parsing errors:", parseResult.errors);
  }

  const now = Date.now();
  const validLeads: Lead[] = [];
  const invalidRows: RowValidationResult[] = [];

  // Process each row
  parseResult.data.forEach((rawRow, index) => {
    // Map CSV columns to lead fields
    const leadData: Record<string, string> = {};
    for (const [csvColumn, leadField] of Object.entries(columnMapping)) {
      if (leadField !== "ignore" && rawRow[csvColumn]) {
        leadData[leadField] = rawRow[csvColumn];
      }
    }

    // Validate row
    const validation = validateRow(leadData, index + 1);

    if (!validation.isValid) {
      invalidRows.push(validation);
      return; // Skip invalid rows
    }

    // Extract domain from website if not explicitly provided
    const contactEmail = leadData.contact_email || leadData.email;
    const emailDomain = contactEmail ? contactEmail.split("@")[1] || "" : "";
    const domain = extractDomain(leadData.domain) || extractDomain(leadData.website) || emailDomain;

    // Build lead object
    const leadId = `csv_${now}_${index}`;
    const companyName = validation.rowData.company_name?.trim();

    if (!companyName) return; // Should not happen after validation

    // Generate synthetic placeId for CSV imports (required by schema)
    const safeDomain = (domain || companyName.replace(/[^a-z0-9]/gi, '_')).toLowerCase();
    const syntheticPlaceId = `csv_upload_${safeDomain}_${now}_${index}`;

    // Only populate contactEmails when skipping enrichment (has email AND contact_name)
    // Leads going through FindyMail must NOT have pre-populated emails to avoid
    // short-circuiting the enrichment pipeline
    const shouldSkipEnrichment = validation.costEstimate.skipEnrichment;
    const contactEmails = (shouldSkipEnrichment && contactEmail && validateEmail(contactEmail))
      ? [
          {
            email: contactEmail,
            type: "work" as const,
            confidence: 0.9, // High confidence for user-provided emails
          },
        ]
      : [];

    // Prepare contact person if name exists
    const contacts = leadData.contact_name
      ? [
          {
            name: leadData.contact_name,
            email: contactEmail || undefined,
            confidence: 0.9,
          },
        ]
      : [];

    const industry = validation.rowData.industry?.trim();

    const lead: Lead = {
      _id: leadId,
      id: leadId,
      businessName: companyName,
      company_name: companyName,
      industry: industry || null,
      category: industry || null,
      website: leadData.website?.trim() || (domain && validateDomain(domain) ? `https://${domain}` : null),
      phone: leadData.phone?.trim() || null,
      placeId: syntheticPlaceId,
      address: "CSV Import",
      location: {
        lat: 0,
        lng: 0,
        formattedAddress: "CSV Import",
      },
      contactInfo:
        contactEmails.length > 0 || contacts.length > 0
          ? {
              emails: contactEmails,
              contacts: contacts,
            }
          : undefined,
      contact_info:
        contactEmail || leadData.phone
          ? {
              email: contactEmail || undefined,
              phone: leadData.phone?.trim() || undefined,
            }
          : undefined,
      notes: leadData.notes?.trim() || "",
      description: null,
      enrichmentStatus: validation.costEstimate.skipEnrichment
        ? ("completed" as const) // Already has email, skip enrichment
        : ("pending" as const), // Needs enrichment
      status: "new" as const,
      tags: [],
      dataSource: "csv_upload",
      createdAt: now,
      updatedAt: now,
      raw_data: {
        source: "csv_upload",
        domain: domain || undefined,
        costEstimate: validation.costEstimate,
        skipEnrichment: validation.costEstimate.skipEnrichment,
      },
    } as Lead;

    validLeads.push(lead);
  });

  // Calculate statistics
  const leadsWithEmail = validLeads.filter(l => l.raw_data?.skipEnrichment).length;
  const leadsNeedingEnrichment = validLeads.length - leadsWithEmail;
  const actualCost = (leadsWithEmail * 1) + (leadsNeedingEnrichment * 2);

  // Log import summary
  console.log(`CSV Import Summary:
  - Total rows: ${parseResult.data.length}
  - Valid leads: ${validLeads.length}
  - Invalid rows: ${invalidRows.length}
  - With emails (1 credit): ${leadsWithEmail}
  - Need enrichment (2 credits): ${leadsNeedingEnrichment}
  - Total cost: ${actualCost} credits
  `);

  if (invalidRows.length > 0) {
    console.warn("Invalid rows:", invalidRows);
  }

  // Build stats object
  const stats: CSVImportStats = {
    totalRows: parseResult.data.length,
    validRows: validLeads.length,
    invalidRows: invalidRows.length,
    skippedRows: 0,
    leadsWithEmail,
    leadsNeedingEnrichment,
    estimatedCost: actualCost,
    actualCost,
    errorReport: invalidRows.length > 0 ? invalidRows.map((inv, index) => ({
      rowNumber: index + 2, // +2 because row 1 is headers, and index is 0-based
      companyName: inv.rowData.company_name,
      errors: inv.errors,
      warnings: inv.warnings,
      rawData: inv.rowData,
    })) : undefined,
  };

  return { leads: validLeads, stats };
}
