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

export function hasCompleteExportResearch(
  fields: ExportResearchFields,
): boolean {
  return (
    fields.fullResearchReport.trim().length > 0 &&
    fields.citations.length > 0 &&
    typeof fields.researchConfidenceScore === "number" &&
    !Number.isNaN(fields.researchConfidenceScore)
  );
}

function firstNonEmptyString(...values: Array<unknown>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

/**
 * Ensure stored companyResearch payloads include export-ready research_metadata
 * (comprehensive report, citations, confidence) under raw_data.
 */
export function enrichResearchPayloadForExport(payload: unknown): unknown {
  const record = asRecord(payload);
  if (!record) {
    return payload;
  }

  const rawData = { ...(asRecord(record.raw_data) ?? {}) };
  const existingMeta = { ...(asRecord(rawData.research_metadata) ?? {}) };
  const leadAnalysis = asRecord(record.lead_analysis) ?? asRecord(record.leadAnalysis);

  const comprehensiveReport = firstNonEmptyString(
    existingMeta.comprehensive_report,
    rawData.comprehensive_report,
    leadAnalysis?.comprehensive_report,
    (asRecord(leadAnalysis?.research_metadata)?.comprehensive_report as
      | string
      | undefined),
    record.comprehensive_report,
    record.company_overview,
    rawData.company_overview,
    rawData.research_summary,
  );

  let citations = normalizeCitations(existingMeta.citations);
  if (citations.length === 0) {
    citations = normalizeCitations(rawData.citations);
  }
  if (citations.length === 0 && leadAnalysis) {
    const leadMeta = asRecord(leadAnalysis.research_metadata);
    citations = normalizeCitations(leadMeta?.citations);
  }
  if (citations.length === 0) {
    citations = extractTavilyCitationUrls(existingMeta);
  }
  if (citations.length === 0) {
    citations = extractTavilyCitationUrls(rawData);
  }

  const confidenceScore =
    typeof existingMeta.confidence_score === "number"
      ? existingMeta.confidence_score
      : typeof rawData.confidence_score === "number"
        ? rawData.confidence_score
        : typeof record.confidence_score === "number"
          ? record.confidence_score
          : typeof leadAnalysis?.confidence_score === "number"
            ? leadAnalysis.confidence_score
            : typeof asRecord(leadAnalysis?.research_metadata)?.confidence_score ===
                "number"
              ? (asRecord(leadAnalysis?.research_metadata)?.confidence_score as number)
              : undefined;

  const researchMetadata = {
    ...existingMeta,
    ...(comprehensiveReport ? { comprehensive_report: comprehensiveReport } : {}),
    ...(citations.length > 0 ? { citations } : {}),
    ...(typeof confidenceScore === "number" ? { confidence_score: confidenceScore } : {}),
  };

  if (
    comprehensiveReport ||
    citations.length > 0 ||
    typeof confidenceScore === "number"
  ) {
    rawData.research_metadata = researchMetadata;
    if (comprehensiveReport && !rawData.comprehensive_report) {
      rawData.comprehensive_report = comprehensiveReport;
    }
  }

  return {
    ...record,
    raw_data: rawData,
    ...(comprehensiveReport && !record.company_overview
      ? { company_overview: comprehensiveReport }
      : {}),
    ...(typeof confidenceScore === "number" ? { confidence_score: confidenceScore } : {}),
  };
}

function resolveCitationsFromSources(
  ...sources: Array<unknown>
): unknown[] {
  for (const source of sources) {
    const citations = normalizeCitations(source);
    if (citations.length > 0) {
      return citations;
    }
  }
  for (const source of sources) {
    const record = asRecord(source);
    if (record) {
      const fromTavily = extractTavilyCitationUrls(record);
      if (fromTavily.length > 0) {
        return normalizeCitations(fromTavily);
      }
    }
  }
  return [];
}

/**
 * Merge LangGraph webhook research into existing people-discovery cache
 * without dropping citations or people-discovery context.
 */
export function mergeCompanyResearchPayloadForWebhook(
  existing: unknown,
  incoming: unknown,
): unknown {
  if (!existing) {
    return incoming;
  }
  if (!incoming) {
    return existing;
  }

  const existingEnriched = enrichResearchPayloadForExport(existing) as Record<
    string,
    unknown
  >;
  const incomingEnriched = enrichResearchPayloadForExport(incoming) as Record<
    string,
    unknown
  >;

  const existingRaw = { ...(asRecord(existingEnriched.raw_data) ?? {}) };
  const incomingRaw = { ...(asRecord(incomingEnriched.raw_data) ?? {}) };
  const existingMeta = { ...(asRecord(existingRaw.research_metadata) ?? {}) };
  const incomingMeta = { ...(asRecord(incomingRaw.research_metadata) ?? {}) };

  const companyOverview = firstNonEmptyString(
    incomingEnriched.company_overview,
    incomingMeta.comprehensive_report,
    incomingRaw.company_overview,
    existingEnriched.company_overview,
    existingMeta.comprehensive_report,
    existingRaw.company_overview,
  );

  const citations = resolveCitationsFromSources(
    incomingMeta.citations,
    incomingRaw.citations,
    incomingMeta,
    incomingRaw,
    existingMeta.citations,
    existingRaw.citations,
    existingMeta,
    existingRaw,
  );

  const confidenceScore =
    typeof incomingEnriched.confidence_score === "number"
      ? incomingEnriched.confidence_score
      : typeof incomingMeta.confidence_score === "number"
        ? incomingMeta.confidence_score
        : typeof existingEnriched.confidence_score === "number"
          ? existingEnriched.confidence_score
          : typeof existingMeta.confidence_score === "number"
            ? existingMeta.confidence_score
            : undefined;

  const mergedRaw: Record<string, unknown> = {
    ...existingRaw,
    ...incomingRaw,
    people_discovery:
      existingRaw.people_discovery ?? incomingRaw.people_discovery,
    people: Array.isArray(existingRaw.people)
      ? existingRaw.people
      : incomingRaw.people,
    raw: existingRaw.raw ?? incomingRaw.raw,
    research_metadata: {
      ...existingMeta,
      ...incomingMeta,
      ...(companyOverview ? { comprehensive_report: companyOverview } : {}),
      ...(citations.length > 0 ? { citations } : {}),
      ...(typeof confidenceScore === "number"
        ? { confidence_score: confidenceScore }
        : {}),
    },
  };

  if (companyOverview) {
    mergedRaw.company_overview = companyOverview;
    mergedRaw.comprehensive_report = companyOverview;
  }
  if (citations.length > 0) {
    mergedRaw.citations = citations;
  }

  return {
    ...existingEnriched,
    ...incomingEnriched,
    company_overview: companyOverview || existingEnriched.company_overview,
    ...(typeof confidenceScore === "number"
      ? { confidence_score: confidenceScore }
      : {}),
    research_tier:
      incomingEnriched.research_tier ?? existingEnriched.research_tier,
    raw_data: mergedRaw,
  };
}

function extractPeopleDiscoveryScrapedUrls(
  rawData: Record<string, unknown>,
): string[] {
  const website =
    asRecord(rawData.website) ?? asRecord(asRecord(rawData.raw)?.website);
  const scrapedUrls = website?.scraped_urls;
  if (!Array.isArray(scrapedUrls)) {
    return [];
  }

  const urls: string[] = [];
  for (const entry of scrapedUrls) {
    if (typeof entry !== "string" || !entry.trim()) {
      continue;
    }
    const url = entry.replace(/\s+\[[^\]]+\]\s*$/, "").trim();
    if (url) {
      urls.push(url);
    }
  }
  return urls;
}

export function buildPeopleDiscoveryResearchMetadata(
  companyOverview: string,
  rawData: Record<string, unknown>,
  confidenceScore: number,
  fallbackDomain?: string,
): Record<string, unknown> {
  const citationUrls = [...extractPeopleDiscoveryScrapedUrls(rawData)];

  const people = rawData.people;
  if (Array.isArray(people)) {
    for (const person of people) {
      const row = asRecord(person);
      const sourceUrl =
        typeof row?.sourceUrl === "string"
          ? row.sourceUrl
          : typeof row?.source_url === "string"
            ? row.source_url
            : "";
      if (sourceUrl.trim()) {
        citationUrls.push(sourceUrl.trim());
      }
    }
  }

  if (citationUrls.length === 0 && fallbackDomain?.trim()) {
    const domain = fallbackDomain.trim().replace(/^https?:\/\//, "");
    citationUrls.push(`https://${domain}`);
  }

  const uniqueUrls = [...new Set(citationUrls)];
  const citations = uniqueUrls.map((url) => ({
    url,
    title: "Company website",
  }));

  return {
    comprehensive_report: companyOverview,
    citations,
    confidence_score: confidenceScore,
    source: "people_discovery",
  };
}

export function resolveExportResearchFields(
  leadAnalysis: Record<string, unknown> | undefined,
  companyResearchPayload?: unknown,
): ExportResearchFields {
  const researchMetadata = findResearchMetadata(
    leadAnalysis,
    companyResearchPayload,
  );
  const payload = asRecord(companyResearchPayload);
  const rawData = asRecord(payload?.raw_data);

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
  if (!fullResearchReport && payload) {
    const overview = firstNonEmptyString(
      payload.company_overview,
      rawData?.company_overview,
    );
    if (overview) {
      fullResearchReport = overview;
    }
  }

  let citations = normalizeCitations(researchMetadata?.citations);
  if (citations.length === 0 && researchMetadata) {
    citations = extractTavilyCitationUrls(researchMetadata);
  }
  if (citations.length === 0 && rawData) {
    const scrapedUrls = extractPeopleDiscoveryScrapedUrls(rawData);
    if (scrapedUrls.length > 0) {
      citations = normalizeCitations(scrapedUrls);
    }
  }

  let researchConfidenceScore: string | number = "";
  if (typeof researchMetadata?.confidence_score === "number") {
    researchConfidenceScore = researchMetadata.confidence_score;
  } else if (typeof rawData?.confidence_score === "number") {
    researchConfidenceScore = rawData.confidence_score;
  } else if (typeof payload?.confidence_score === "number") {
    researchConfidenceScore = payload.confidence_score;
  }

  return {
    fullResearchReport,
    citations,
    researchConfidenceScore,
  };
}
