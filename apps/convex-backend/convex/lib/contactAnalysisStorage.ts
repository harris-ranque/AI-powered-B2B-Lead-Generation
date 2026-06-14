const LARGE_LEAD_ANALYSIS_KEYS = [
  "comprehensive_report",
  "research_metadata",
  "raw_research",
  "raw_data",
  "citations",
  "perplexity_citations",
  "sources",
  "full_report",
] as const;

const MAX_SUMMARY_CHARS = 2000;

function trimLargeString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  if (value.length <= MAX_SUMMARY_CHARS) {
    return value;
  }
  return `${value.slice(0, MAX_SUMMARY_CHARS)}...`;
}

/**
 * Store compact per-contact analysis on leadContacts. Full research lives in companyResearch.
 */
export function slimLeadAnalysisForContactStorage(
  leadAnalysis: unknown,
): Record<string, unknown> | undefined {
  if (!leadAnalysis || typeof leadAnalysis !== "object") {
    return undefined;
  }

  const source = leadAnalysis as Record<string, unknown>;
  const slim: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (LARGE_LEAD_ANALYSIS_KEYS.includes(key as typeof LARGE_LEAD_ANALYSIS_KEYS[number])) {
      continue;
    }
    if (key === "research_summary" || key === "company_overview") {
      slim[key] = trimLargeString(value);
      continue;
    }
    slim[key] = value;
  }

  return slim;
}

export function slimContactAiAnalysisForStorage(
  aiAnalysis: {
    relevanceScore: number;
    painPoints: string[];
    valueMatches: string[];
    recommendations?: string[];
    leadAnalysis?: unknown;
    processingTime?: number;
    confidence?: number;
    researchTier?: string;
    companyData?: unknown;
    fitAssessment?: string;
    recommendedApproach?: string;
  },
): typeof aiAnalysis {
  return {
    ...aiAnalysis,
    leadAnalysis: slimLeadAnalysisForContactStorage(aiAnalysis.leadAnalysis),
  };
}
