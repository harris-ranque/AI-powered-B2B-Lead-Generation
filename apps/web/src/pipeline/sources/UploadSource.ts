import type { LeadSource, SourceParams, ValidationResult } from "../types";
import type { Lead } from "@/lib/api-client";

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
    }

    // Estimate processing cost
    const estimatedRows = Math.ceil(params.file.size / 100); // Rough estimate
    const estimatedCost = Math.min(estimatedRows * 2, 1000); // Cap at 1000 credits

    if (estimatedRows > 1000) {
      warnings.push("Large files may take longer to process");
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      estimatedCost,
    };
  },

  fetch: async (params: SourceParams): Promise<Lead[]> => {
    if (!params.file || !params.columns) {
      throw new Error("File and column mapping required");
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (event) => {
        try {
          const csvText = event.target?.result as string;
          const leads = parseCSVToLeads(csvText, params.columns!);
          resolve(leads);
        } catch (error) {
          reject(new Error("Failed to parse CSV file"));
        }
      };

      reader.onerror = () => {
        reject(new Error("Failed to read file"));
      };

      reader.readAsText(params.file);
    });
  },
};

function parseCSVToLeads(
  csvText: string,
  columnMapping: Record<string, string>,
): Lead[] {
  const lines = csvText.split("\n").filter((line) => line.trim());
  if (lines.length === 0) return [];

  const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));
  const dataLines = lines.slice(1);

  const now = Date.now();

  return dataLines
    .map((line, index) => {
      const values = line.split(",").map((v) => v.trim().replace(/"/g, ""));
      const leadData: Record<string, string> = {};

      headers.forEach((header, headerIndex) => {
        const mappedField = columnMapping[header];
        if (mappedField && values[headerIndex]) {
          leadData[mappedField] = values[headerIndex];
        }
      });

      const leadId = `upload_${index}`;
      const companyName = leadData.company_name?.trim();
      if (!companyName) {
        return null;
      }

      const normalizedEmail = leadData.email?.trim();
      const contactEmails = normalizedEmail
        ? [
            {
              email: normalizedEmail,
              type: "work",
              confidence: 0.5,
            },
          ]
        : [];

      const address = leadData.address?.trim();
      const industry = leadData.industry?.trim();

      const lead: Lead = {
        _id: leadId,
        id: leadId,
        businessName: companyName,
        company_name: companyName,
        industry: industry || null,
        category: industry || null,
        website: leadData.website?.trim() || null,
        phone: leadData.phone?.trim() || null,
        address: address || null,
        location: address
          ? {
              lat: 0,
              lng: 0,
              formattedAddress: address,
            }
          : undefined,
        contactInfo:
          contactEmails.length > 0
            ? {
                emails: contactEmails,
                contacts: [],
              }
            : undefined,
        contact_info:
          normalizedEmail || leadData.phone
            ? {
                email: normalizedEmail || undefined,
                phone: leadData.phone?.trim() || undefined,
              }
            : undefined,
        notes: leadData.description?.trim() || "",
        description: leadData.description?.trim() || null,
        enrichmentStatus: "pending",
        status: "new",
        tags: [],
        dataSource: "csv_upload",
        createdAt: now,
        updatedAt: now,
        raw_data: {
          source: "csv_upload",
        },
      } as Lead;

      return lead;
    })
    .filter((lead): lead is Lead => Boolean(lead));
}
