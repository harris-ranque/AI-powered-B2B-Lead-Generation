/**
 * Helpers for recovering searches stuck between enrichment completion and
 * Write Emails (analyzeLeads never scheduled).
 */

/** Wait before recovery so normal workpool/enrichment handoff can run first. */
export const ANALYSIS_RECOVERY_GRACE_MS = 3 * 60 * 1000;

const TERMINAL_ENRICHMENT_STATUSES = new Set([
  "completed",
  "completed_fallback",
  "no_contacts_found",
  "failed",
]);

export function isTerminalEnrichmentStatus(
  status: string | undefined,
): boolean {
  return TERMINAL_ENRICHMENT_STATUSES.has(status ?? "pending");
}

export function isAllEnrichmentTerminal(
  leads: Array<{ enrichmentStatus?: string }>,
): boolean {
  if (leads.length === 0) {
    return false;
  }
  return leads.every((lead) => isTerminalEnrichmentStatus(lead.enrichmentStatus));
}

export function hasPendingEnrichment(
  leads: Array<{ enrichmentStatus?: string }>,
): boolean {
  return leads.some(
    (lead) =>
      lead.enrichmentStatus === "pending" ||
      lead.enrichmentStatus === "in_progress",
  );
}

/** Failed searches that timed out with analysis never started. */
export function isFailedSearchAnalysisTimeout(error?: string): boolean {
  if (!error) {
    return false;
  }
  return error.includes("leads pending analysis");
}
