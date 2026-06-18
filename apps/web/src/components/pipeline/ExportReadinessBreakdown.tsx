import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";

export type ExportReadinessSummary = {
  totalAccepted: number;
  exportable: number;
  awaitingEmailWriting: number;
  analysisFailed: number;
  missingTitle: number;
  incompleteResearch: number;
};

type BreakdownItem = {
  count: number;
  label: string;
};

function buildBreakdownItems(readiness: ExportReadinessSummary): BreakdownItem[] {
  return [
    {
      count: readiness.exportable,
      label: "ready for CSV export",
    },
    {
      count: readiness.awaitingEmailWriting,
      label: "awaiting email writing",
    },
    {
      count: readiness.analysisFailed,
      label: "analysis failed or skipped",
    },
    {
      count: readiness.missingTitle,
      label: "missing job title",
    },
  ].filter((item) => item.count > 0);
}

export function formatExportReadinessSentence(
  readiness: ExportReadinessSummary,
): string {
  const items = buildBreakdownItems(readiness);
  if (items.length === 0) {
    return "No accepted contacts yet.";
  }
  return items
    .map((item) => `${item.count} ${item.label}`)
    .join(" · ");
}

export function ExportReadinessBreakdown({
  readiness,
  acceptedCount,
  exportableCount,
  variant = "default",
}: {
  readiness: ExportReadinessSummary;
  acceptedCount?: number;
  exportableCount?: number;
  variant?: "default" | "compact";
}) {
  const total = acceptedCount ?? readiness.totalAccepted;
  const exportable = exportableCount ?? readiness.exportable;

  if (total === 0) {
    return null;
  }

  if (exportable >= total) {
    return null;
  }

  const items = buildBreakdownItems(readiness).filter(
    (item) => item.label !== "ready for CSV export" || variant === "compact",
  );

  if (items.length === 0) {
    return null;
  }

  const description =
    variant === "compact"
      ? formatExportReadinessSentence(readiness)
      : `${total.toLocaleString()} accepted contact${total === 1 ? "" : "s"} with email — ${formatExportReadinessSentence(readiness)}. CSV export includes contacts with a completed written email; research columns are included when available.`;

  return (
    <Alert className="border-cyan-500/30 bg-cyan-500/5">
      <Info className="h-4 w-4 text-cyan-300" />
      <AlertDescription className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Export readiness: </span>
        {description}
      </AlertDescription>
    </Alert>
  );
}
