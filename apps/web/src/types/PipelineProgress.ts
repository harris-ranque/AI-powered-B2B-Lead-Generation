import type { PipelineStage } from "@/pipeline/types";
import { STAGE_ORDER } from "@/pipeline/config";
import type { Search } from "@/lib/types";
import type {
  BroadcastPriority,
  StatusBroadcast,
} from "@/hooks/base/useStatusBroadcastsBase";

export interface PipelineProgress {
  stageId: string;
  percentComplete: number;
  metrics: Record<string, number>;
  warnings?: string[];
  statusLabel?: string;
  health?: "ok" | "warning" | "error";
  timeline?: PipelineProgressEvent[];
}

export interface PipelineProgressEvent {
  id: string;
  timestamp: number;
  title: string;
  description?: string;
  stageId?: PipelineStage;
  priority?: BroadcastPriority;
}

const STAGE_ALIASES: Record<string, PipelineStage> = {
  source_selection: "source_selection",
  source: "source_selection",
  sourcing: "source_selection",
  discovery: "lead_discovery",
  lead_discovery: "lead_discovery",
  enrichment: "enrichment",
  research_enrichment: "enrichment",
  ai: "ai_personalization",
  analysis: "ai_personalization",
  research_analysis: "ai_personalization",
  personalization: "ai_personalization",
  review: "review_export",
  completion: "review_export",
  export: "review_export",
  review_export: "review_export",
};

const COMPLETION_HINTS = ["complete", "completed", "ready", "handoff"];
const FAILURE_HINTS = ["failed", "error", "cancelled"];

export function normalizeStageId(
  input: string | null | undefined,
  fallback: PipelineStage = "source_selection",
): PipelineStage {
  if (!input) return fallback;
  const normalized = input.toLowerCase().replace(/[^a-z_]/g, "_");
  const direct = STAGE_ALIASES[normalized];
  if (direct) return direct;
  const matched = Object.entries(STAGE_ALIASES).find(([alias]) =>
    normalized.includes(alias),
  );
  return matched ? matched[1] : fallback;
}

export function computeStagePercent(
  stage: PipelineStage,
  completed: PipelineStage[] = [],
  stageOrder: PipelineStage[] = STAGE_ORDER as PipelineStage[],
): number {
  if (stageOrder.length === 0) return 0;
  const currentIndex = stageOrder.indexOf(stage);
  const completedCount = new Set(
    completed.filter((stageId) => stageOrder.includes(stageId)),
  ).size;

  // Only count progress from completed stages, not the current stage
  // This ensures initial state shows 0% instead of 20%
  const percent = (completedCount / stageOrder.length) * 100;
  return clampPercent(percent);
}

function getNumericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function maxMetricValue(
  ...values: Array<number | null | undefined>
): number {
  let max = 0;

  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      max = Math.max(max, value);
    }
  }

  return max;
}

export function extractBroadcastMetrics(
  progressUpdates: StatusBroadcast[] = [],
): Record<string, number> {
  const metrics: Record<string, number> = {};

  for (const update of progressUpdates) {
    if (!update.data || typeof update.data !== "object") continue;

    const progress = (update.data as Record<string, unknown>).progress;
    if (!progress || typeof progress !== "object") continue;

    for (const [key, rawValue] of Object.entries(
      progress as Record<string, unknown>,
    )) {
      const value = getNumericValue(rawValue);
      if (value === null) continue;

      metrics[key] = Math.max(metrics[key] ?? 0, value);
    }
  }

  return metrics;
}

export function computeMetricsFromSearch(
  search: Search | null | undefined,
  optimisticMetrics: Record<string, number> = {},
  broadcastMetrics: Record<string, number> = {},
): Record<string, number> {
  const progressMetrics = (search?.progress ?? {}) as Record<
    string,
    number | null | undefined
  >;

  const discovered = maxMetricValue(
    progressMetrics.discovered,
    broadcastMetrics.discovered,
    optimisticMetrics.discovered,
  );
  const enriched = maxMetricValue(
    progressMetrics.enriched,
    broadcastMetrics.enriched,
    optimisticMetrics.enriched,
    search?.results?.enrichedCount,
  );
  const analyzed = maxMetricValue(
    progressMetrics.analyzed,
    broadcastMetrics.analyzed,
    optimisticMetrics.analyzed,
    search?.results?.analyzedCount,
  );
  const totalCandidates = maxMetricValue(
    progressMetrics.total,
    broadcastMetrics.total,
    optimisticMetrics.total,
    search?.results?.totalFound,
    discovered,
    enriched,
    analyzed,
  );

  const metrics: Record<string, number> = {
    discovered,
    enriched,
    analyzed,
    total: totalCandidates,
  };

  const additionalKeys = new Set<string>([
    ...Object.keys(progressMetrics),
    ...Object.keys(broadcastMetrics),
    ...Object.keys(optimisticMetrics),
  ]);

  for (const key of additionalKeys) {
    if (["discovered", "enriched", "analyzed", "total"].includes(key)) {
      continue;
    }

    const value = maxMetricValue(
      progressMetrics[key],
      broadcastMetrics[key],
      optimisticMetrics[key],
    );

    if (value > 0) {
      metrics[key] = value;
    }
  }

  if (typeof search?.researchConfidence === "number") {
    metrics.confidence = Math.round(search.researchConfidence * 100);
  }

  if (typeof search?.creditsReserved === "number") {
    metrics.creditsReserved = search.creditsReserved;
  } else if (typeof search?.creditsUsed === "number") {
    metrics.creditsReserved = search.creditsUsed;
  }

  if (typeof search?.researchSourcesAnalyzed === "number") {
    metrics.sourcesAnalyzed = search.researchSourcesAnalyzed;
  }

  return metrics;
}

export function computePercentFromMetrics(
  metrics: Record<string, number>,
  broadcastProgress?: number | null,
  searchStatus?: Search["status"],
): number {
  if (typeof broadcastProgress === "number") {
    return clampPercent(broadcastProgress);
  }

  if (searchStatus === "completed") {
    return 100;
  }

  const total = metrics.total ?? 0;
  if (total <= 0) return 0;

  const numerator = Math.max(
    metrics.analyzed ?? 0,
    metrics.enriched ?? 0,
    metrics.discovered ?? 0,
  );

  return clampPercent((numerator / total) * 100);
}

export function gatherWarnings(
  search: Search | null | undefined,
  latestBroadcast?: StatusBroadcast | null,
): string[] {
  const warnings: string[] = [];

  if (search?.status === "failed") {
    warnings.push("The search failed. Review the error details in history.");
  }

  if (search?.status === "cancelled") {
    warnings.push("The search was cancelled before completion.");
  }

  const stageText = (search?.researchStage || latestBroadcast?.message || "")
    .toString()
    .toLowerCase();
  if (FAILURE_HINTS.some((hint) => stageText.includes(hint))) {
    warnings.push("Pipeline reported an error in the research stage.");
  }

  if (
    latestBroadcast &&
    (latestBroadcast.priority === "urgent" ||
      latestBroadcast.priority === "critical")
  ) {
    warnings.push(latestBroadcast.message);
  }

  return Array.from(new Set(warnings));
}

export function deriveHealth(
  search: Search | null | undefined,
  warnings: string[],
): "ok" | "warning" | "error" {
  if (search?.status === "failed") return "error";
  if (search?.status === "cancelled") return "warning";
  if (warnings.length > 0) {
    return warnings.some((warning) => warning.toLowerCase().includes("error"))
      ? "error"
      : "warning";
  }
  return "ok";
}

export function mapBroadcastToEvent(
  broadcast: StatusBroadcast,
): PipelineProgressEvent {
  return {
    id: broadcast._id,
    timestamp: broadcast.createdAt,
    title: broadcast.title,
    description: broadcast.message,
    stageId: normalizeStageId(
      typeof broadcast.data === "object" &&
        broadcast.data &&
        "stage" in broadcast.data
        ? String((broadcast.data as Record<string, unknown>).stage)
        : undefined,
    ),
    priority: broadcast.priority,
  };
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function deriveStageFromSearch(
  search: Search | null | undefined,
  latestBroadcast?: StatusBroadcast | null,
  fallback: PipelineStage = "source_selection",
): PipelineStage {
  if (!search) {
    return latestBroadcast
      ? normalizeStageId(extractStageFromBroadcast(latestBroadcast), fallback)
      : fallback;
  }

  if (search.status === "completed") {
    return "review_export";
  }

  const researchStage = search.researchStage?.toLowerCase() ?? "";
  if (COMPLETION_HINTS.some((hint) => researchStage.includes(hint))) {
    return "review_export";
  }

  if (researchStage) {
    if (researchStage.includes("analysis") || researchStage.includes("ai")) {
      return "ai_personalization";
    }
    if (researchStage.includes("enrich")) {
      return "enrichment";
    }
    if (researchStage.includes("discover") || researchStage.includes("research")) {
      return "lead_discovery";
    }
  }

  const stageFromBroadcast = latestBroadcast
    ? normalizeStageId(extractStageFromBroadcast(latestBroadcast), fallback)
    : null;
  if (stageFromBroadcast) {
    return stageFromBroadcast;
  }

  if ((search.progress?.analyzed ?? 0) > 0) {
    return "ai_personalization";
  }
  if ((search.progress?.enriched ?? 0) > 0) {
    return "enrichment";
  }
  if ((search.progress?.discovered ?? 0) > 0) {
    return "lead_discovery";
  }

  return fallback;
}

function extractStageFromBroadcast(broadcast: StatusBroadcast | null | undefined) {
  if (!broadcast) return null;
  const raw =
    typeof broadcast?.data === "object" &&
    broadcast?.data &&
    "stage" in broadcast.data
      ? (broadcast.data as Record<string, unknown>).stage
      : null;
  if (typeof raw === "string") return raw;
  return null;
}

export function buildTimeline(
  broadcasts: StatusBroadcast[] = [],
): PipelineProgressEvent[] {
  return broadcasts
    .map(mapBroadcastToEvent)
    .sort((a, b) => b.timestamp - a.timestamp);
}
