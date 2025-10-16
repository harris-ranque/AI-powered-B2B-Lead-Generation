import type { LeadSource, SourceParams, ValidationResult } from "../types";
import type { Lead } from "@/lib/api-client";
import { MapPin } from "lucide-react";

export const GoogleMapsSource: LeadSource = {
  type: "google_maps",
  name: "Google Maps Search",
  description: "Discover leads from local businesses using Google Maps data",
  icon: MapPin,
  supportsEnrichment: true,
  supportsAI: true,

  validate: (params: SourceParams): ValidationResult => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields validation
    if (!params.location?.trim()) {
      errors.push("Location is required");
    }

    if (!params.industry?.trim()) {
      errors.push("Business type/industry is required");
    }

    if (params.roles) {
      const validRoles = params.roles
        .map((role) => role.trim())
        .filter((role) => role.length > 0);

      if (validRoles.length === 0) {
        errors.push("At least one target role is required for email enrichment");
      }

      if (validRoles.length > 3) {
        errors.push("You can target up to 3 roles per search");
      }
    }

    // Range validation
    if (
      params.leadsCount &&
      (params.leadsCount < 10 || params.leadsCount > 500)
    ) {
      errors.push("Leads count must be between 10 and 500");
    }

    if (params.radius && (params.radius < 1 || params.radius > 31)) {
      errors.push(
        "Search radius must be between 1 and 31 miles (Google Places API limit)",
      );
    }

    // Cost estimation (rough)
    const estimatedLeads = params.leadsCount || 50;
    const baseSearchCost = 5;
    const enrichmentCost = params.leadsCount ? estimatedLeads * 2 : 100;
    const aiCost = params.leadsCount ? estimatedLeads * 3 : 150;

    const estimatedCost =
      baseSearchCost +
      (params.includeEmails ? enrichmentCost : 0) +
      (params.aiAnalysis ? aiCost : 0);

    // Warnings for high costs
    if (estimatedCost > 200) {
      warnings.push(`High estimated cost: ${estimatedCost} credits`);
    }

    if (estimatedLeads > 200) {
      warnings.push("Large search may take several minutes to complete");
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      estimatedCost,
    };
  },

  fetch: async (params: SourceParams): Promise<Lead[]> => {
    // This will integrate with existing useGoogleMapsSearch hook
    // For now, return empty array as this will be handled by the hook
    return [];
  },
};
