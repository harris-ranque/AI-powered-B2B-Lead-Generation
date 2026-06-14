export type ExportSummary = {
  exportableContacts: number;
  exportableBusinesses: number;
  fromThisSearch?: number;
  priorSearchExportable?: number;
  duplicateSkips?: number;
};

export function formatExportableResultsLabel(
  summary: ExportSummary | undefined,
  fallbackCount: number,
  multiContactPipeline: boolean,
): string {
  if (multiContactPipeline && summary) {
    const contacts = summary.exportableContacts.toLocaleString();
    const businesses = summary.exportableBusinesses.toLocaleString();
    const fromThisSearch = summary.fromThisSearch ?? summary.exportableContacts;
    const priorSearchExportable = summary.priorSearchExportable ?? 0;

    if (summary.exportableContacts === 0) {
      if ((summary.duplicateSkips ?? 0) > 0) {
        return "0 new contacts (businesses already in your account)";
      }
      return "0 exportable contacts";
    }

    if (fromThisSearch === 0 && priorSearchExportable > 0) {
      return `${contacts} exportable contacts · ${businesses} businesses (from prior searches)`;
    }

    if (priorSearchExportable > 0 && fromThisSearch > 0) {
      return `${contacts} exportable contacts · ${businesses} businesses (${fromThisSearch.toLocaleString()} new)`;
    }

    return `${contacts} exportable contacts · ${businesses} businesses`;
  }

  return `${fallbackCount.toLocaleString()} leads found`;
}

export function formatExportableCountShort(
  summary: ExportSummary | undefined,
  fallbackCount: number,
  multiContactPipeline: boolean,
): string {
  if (multiContactPipeline && summary) {
    const priorSearchExportable = summary.priorSearchExportable ?? 0;
    const fromThisSearch = summary.fromThisSearch ?? summary.exportableContacts;
    if (fromThisSearch === 0 && priorSearchExportable > 0) {
      return `${summary.exportableContacts.toLocaleString()} contacts (prior)`;
    }
    return `${summary.exportableContacts.toLocaleString()} contacts`;
  }
  return `${fallbackCount.toLocaleString()} leads`;
}
