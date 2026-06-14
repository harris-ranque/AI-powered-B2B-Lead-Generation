/**
 * Normalize company research payloads for LangGraph BI cache reuse.
 */

export type NormalizedCompanyResearchCache = {
  company_overview: string;
  raw_data: Record<string, unknown>;
  confidence_score: number;
  research_tier: string;
  data_points?: number;
  sources_analyzed?: number;
  escalation_reason?: string;
  deep_research_used?: boolean;
  deep_research_reason?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function firstNonEmptyString(...values: Array<unknown>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

export function isValidCompanyResearchCache(payload: unknown): boolean {
  const normalized = normalizeCompanyResearchPayload(payload);
  return normalized !== null && normalized.company_overview.length > 0;
}

export function normalizeCompanyResearchPayload(
  payload: unknown,
): NormalizedCompanyResearchCache | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  const rawData =
    asRecord(record.raw_data) ??
    asRecord(record.lead_analysis) ??
    asRecord(record.leadAnalysis) ??
    {};

  const researchMetadata = asRecord(rawData.research_metadata);

  const companyOverview = firstNonEmptyString(
    record.company_overview,
    rawData.company_overview,
    rawData.research_summary,
    rawData.comprehensive_report,
    record.comprehensive_report,
    researchMetadata?.comprehensive_report,
  );

  if (!companyOverview) {
    return null;
  }

  const confidenceScore =
    typeof record.confidence_score === "number"
      ? record.confidence_score
      : typeof rawData.confidence_score === "number"
        ? rawData.confidence_score
        : typeof researchMetadata?.confidence_score === "number"
          ? researchMetadata.confidence_score
          : 0.5;

  const researchTier = firstNonEmptyString(
    record.research_tier,
    record.researchTier,
    rawData.research_tier,
  ) || "tavily";

  return {
    company_overview: companyOverview,
    raw_data: rawData,
    confidence_score: confidenceScore,
    research_tier: researchTier,
    data_points:
      typeof record.data_points === "number" ? record.data_points : undefined,
    sources_analyzed:
      typeof record.sources_analyzed === "number"
        ? record.sources_analyzed
        : undefined,
    escalation_reason:
      typeof record.escalation_reason === "string"
        ? record.escalation_reason
        : undefined,
    deep_research_used:
      typeof record.deep_research_used === "boolean"
        ? record.deep_research_used
        : undefined,
    deep_research_reason:
      typeof record.deep_research_reason === "string"
        ? record.deep_research_reason
        : undefined,
  };
}
