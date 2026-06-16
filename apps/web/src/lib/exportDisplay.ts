export type ExportSummary = {
  exportableContacts: number;
  exportableBusinesses: number;
  fromThisSearch?: number;
  priorSearchExportable?: number;
  duplicateSkips?: number;
  linkedForReenrichment?: number;
  acceptedContacts?: number;
};

export function resolveDisplayContactCount(
  summary: ExportSummary | undefined,
  fallbackCount: number,
): number {
  if (!summary) {
    return fallbackCount;
  }
  if (summary.exportableContacts > 0) {
    return summary.exportableContacts;
  }
  if (summary.acceptedContacts != null && summary.acceptedContacts > 0) {
    return summary.acceptedContacts;
  }
  return summary.exportableContacts;
}

export function formatContactCountLabel(count: number): string {
  const formatted = count.toLocaleString();
  return count === 1 ? "1 contact" : `${formatted} contacts`;
}

export function formatExportableResultsLabel(
  summary: ExportSummary | undefined,
  fallbackCount: number,
  multiContactPipeline: boolean,
): string {
  if (multiContactPipeline && summary) {
    return formatContactCountLabel(
      resolveDisplayContactCount(summary, fallbackCount),
    );
  }

  return `${fallbackCount.toLocaleString()} leads found`;
}

export function formatExportableCountShort(
  summary: ExportSummary | undefined,
  fallbackCount: number,
  multiContactPipeline: boolean,
): string {
  if (multiContactPipeline && summary) {
    return formatContactCountLabel(
      resolveDisplayContactCount(summary, fallbackCount),
    );
  }
  return `${fallbackCount.toLocaleString()} leads`;
}
