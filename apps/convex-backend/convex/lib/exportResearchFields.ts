/**
 * Resolve full research report, citations, and confidence for CSV/UI export.
 * Per-contact aiAnalysis is slimmed; full payloads live in companyResearch.
 */

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function hasResearchContent(metadata: Record<string, unknown>): boolean {
  return (
    metadata.citations !== undefined ||
    metadata.comprehensive_report !== undefined ||
    metadata.langchain_tavily_result !== undefined ||
    metadata.recent_news !== undefined
  );
}

function extractTavilyCitationUrls(
  researchMetadata: Record<string, unknown>,
): string[] {
  const tavily = asRecord(researchMetadata.langchain_tavily_result);
  const results = tavily?.results;
  if (!Array.isArray(results)) {
    return [];
  }

  const urls: string[] = [];
  for (const result of results) {
    const row = asRecord(result);
    if (typeof row?.url === "string" && row.url.trim()) {
      urls.push(row.url.trim());
    }
  }
  return urls;
}

function normalizeCitations(citations: unknown): unknown[] {
  if (!Array.isArray(citations)) {
    return [];
  }
  return citations.filter((citation) => {
    if (typeof citation === "string" && citation.trim()) {
      return true;
    }
    return citation !== null && citation !== undefined && typeof citation === "object";
  });
}

function findResearchMetadata(
  leadAnalysis: Record<string, unknown> | undefined,
  companyResearchPayload: unknown,
): Record<string, unknown> | undefined {
  const fromLead = asRecord(leadAnalysis?.research_metadata);
  if (fromLead && hasResearchContent(fromLead)) {
    return fromLead;
  }

  const payload = asRecord(companyResearchPayload);
  if (!payload) {
    return fromLead;
  }

  const rawData = asRecord(payload.raw_data);
  if (rawData) {
    const nested = asRecord(rawData.research_metadata);
    if (nested && hasResearchContent(nested)) {
      return nested;
    }
    if (hasResearchContent(rawData)) {
      return rawData;
    }
  }

  const direct = asRecord(payload.research_metadata);
  if (direct && hasResearchContent(direct)) {
    return direct;
  }

  return fromLead;
}

export type ExportResearchFields = {
  fullResearchReport: string;
  citations: unknown[];
  researchConfidenceScore: string | number;
};

export function resolveExportResearchFields(
  leadAnalysis: Record<string, unknown> | undefined,
  companyResearchPayload?: unknown,
): ExportResearchFields {
  const researchMetadata = findResearchMetadata(
    leadAnalysis,
    companyResearchPayload,
  );
  const payload = asRecord(companyResearchPayload);

  let fullResearchReport = "";
  if (researchMetadata) {
    const report = researchMetadata.comprehensive_report;
    if (typeof report === "string" && report.trim()) {
      fullResearchReport = report.trim();
    }
  }
  if (!fullResearchReport && leadAnalysis) {
    const leadReport = leadAnalysis.comprehensive_report;
    if (typeof leadReport === "string" && leadReport.trim()) {
      fullResearchReport = leadReport.trim();
    }
  }

  let citations = normalizeCitations(researchMetadata?.citations);
  if (citations.length === 0 && researchMetadata) {
    citations = extractTavilyCitationUrls(researchMetadata);
  }

  let researchConfidenceScore: string | number = "";
  if (typeof researchMetadata?.confidence_score === "number") {
    researchConfidenceScore = researchMetadata.confidence_score;
  } else if (typeof payload?.confidence_score === "number") {
    researchConfidenceScore = payload.confidence_score;
  }

  return {
    fullResearchReport,
    citations,
    researchConfidenceScore,
  };
}
