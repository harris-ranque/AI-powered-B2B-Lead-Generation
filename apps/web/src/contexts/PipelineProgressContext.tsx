import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type { Id } from "@genni/convex-types/dataModel";
import { useSearch } from "@/hooks/useSearches";
import { useSearchBroadcasts } from "@/hooks/useStatusBroadcasts";
import type { PipelineStage } from "@/pipeline/types";
import { STAGE_ORDER } from "@/pipeline/config";
import {
  buildTimeline,
  clampPercent,
  computeMetricsFromSearch,
  computePercentFromMetrics,
  computeStagePercent,
  deriveHealth,
  deriveStageFromSearch,
  extractBroadcastMetrics,
  gatherWarnings,
  normalizeStageId,
  type PipelineProgress,
} from "@/types/PipelineProgress";
import type { PipelineProgressEvent } from "@/types/PipelineProgress";

const COLLAPSE_STORAGE_KEY = "genni.pipelineProgress.collapsed";

interface CollapseAction {
  type: "set" | "toggle";
  value?: boolean;
}

function collapseReducer(state: boolean, action: CollapseAction): boolean {
  switch (action.type) {
    case "set":
      return Boolean(action.value);
    case "toggle":
      return !state;
    default:
      return state;
  }
}

export interface PipelineProgressProviderProps {
  children: ReactNode;
  searchId?: Id<"searches">;
  currentStage?: PipelineStage;
  completedStages?: PipelineStage[];
  availableStages?: PipelineStage[];
  stageOrder?: PipelineStage[];
  optimisticMetrics?: Record<string, number>;
  onStageAdvance?: (stage: PipelineStage) => void;
  onStageSelect?: (stage: PipelineStage) => void;
  statusLabelOverride?: string;
  onCollapseChange?: (collapsed: boolean) => void;
  collapsed?: boolean;
}

export interface PipelineProgressContextValue {
  progress: PipelineProgress;
  events: PipelineProgressEvent[];
  stageOrder: PipelineStage[];
  currentStage: PipelineStage;
  completedStages: PipelineStage[];
  availableStages: PipelineStage[];
  isCollapsed: boolean;
  setCollapsed: (value: boolean) => void;
  toggleCollapsed: () => void;
  onStageSelect?: (stage: PipelineStage) => void;
}

const PipelineProgressContext =
  createContext<PipelineProgressContextValue | null>(null);

function readInitialCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
    if (!raw) return false;
    return JSON.parse(raw) === true;
  } catch {
    return false;
  }
}

export function PipelineProgressProvider({
  children,
  searchId,
  currentStage,
  completedStages: completedStagesProp,
  availableStages: availableStagesProp,
  stageOrder: stageOrderProp,
  optimisticMetrics,
  onStageAdvance,
  onStageSelect,
  statusLabelOverride,
  onCollapseChange,
  collapsed,
}: PipelineProgressProviderProps) {
  const stageOrder = stageOrderProp ?? (STAGE_ORDER as PipelineStage[]);
  const [isCollapsed, dispatch] = useReducer(
    collapseReducer,
    false,
    readInitialCollapsed,
  );

  // Sync collapsed prop from parent to local state
  useEffect(() => {
    if (typeof collapsed === "boolean" && collapsed !== isCollapsed) {
      dispatch({ type: "set", value: collapsed });
    }
  }, [collapsed, isCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        COLLAPSE_STORAGE_KEY,
        JSON.stringify(isCollapsed),
      );
    } catch {
      // Ignore storage errors (Safari private mode, etc.)
    }
  }, [isCollapsed]);

  const { search } = useSearch(searchId);
  const {
    broadcasts,
    latestStatus,
    currentProgress,
    currentStage: broadcastStage,
    progressUpdates,
  } = useSearchBroadcasts(searchId);

  const derivedStage = useMemo(() => {
    const fallback = currentStage ?? stageOrder[0];
    const stageFromSearch = deriveStageFromSearch(search, latestStatus, fallback);
    if (broadcastStage) {
      return normalizeStageId(broadcastStage, stageFromSearch);
    }
    return stageFromSearch;
  }, [broadcastStage, currentStage, latestStatus, search, stageOrder]);

  useEffect(() => {
    if (!onStageAdvance || !currentStage) return;
    const currentIndex = stageOrder.indexOf(currentStage);
    const derivedIndex = stageOrder.indexOf(derivedStage);
    if (derivedIndex > currentIndex && derivedIndex !== -1) {
      onStageAdvance(derivedStage);
    }
  }, [currentStage, derivedStage, onStageAdvance, stageOrder]);

  const completedStages = useMemo(() => {
    const base = new Set(completedStagesProp ?? []);
    const derivedIndex = stageOrder.indexOf(derivedStage);
    stageOrder.forEach((stage, index) => {
      if (index < derivedIndex) {
        base.add(stage);
      }
    });
    return Array.from(base);
  }, [completedStagesProp, derivedStage, stageOrder]);

  const availableStages = useMemo(() => {
    if (availableStagesProp?.length) return availableStagesProp;
    return stageOrder;
  }, [availableStagesProp, stageOrder]);

  const broadcastMetrics = useMemo(
    () => extractBroadcastMetrics(progressUpdates),
    [progressUpdates],
  );

  const metrics = useMemo(
    () => computeMetricsFromSearch(search, optimisticMetrics, broadcastMetrics),
    [broadcastMetrics, optimisticMetrics, search],
  );

  const metricPercent = computePercentFromMetrics(
    metrics,
    currentProgress,
    search?.status,
  );
  const stagePercent = computeStagePercent(
    derivedStage,
    completedStages,
    stageOrder,
  );
  const percentComplete = Math.max(metricPercent, stagePercent);

  const warnings = useMemo(
    () => gatherWarnings(search, latestStatus),
    [latestStatus, search],
  );

  const health = useMemo(
    () => deriveHealth(search, warnings),
    [search, warnings],
  );

  const events = useMemo(() => buildTimeline(broadcasts), [broadcasts]);

  const statusLabel = useMemo(() => {
    if (statusLabelOverride) return statusLabelOverride;
    if (latestStatus?.title) return latestStatus.title;
    if (latestStatus?.message) return latestStatus.message;
    if (search?.status) {
      return search.status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return undefined;
  }, [latestStatus, search?.status, statusLabelOverride]);

  const progress: PipelineProgress = useMemo(
    () => ({
      stageId: derivedStage,
      percentComplete: clampPercent(percentComplete),
      metrics,
      warnings: warnings.length ? warnings : undefined,
      statusLabel,
      health,
      timeline: events,
    }),
    [derivedStage, percentComplete, metrics, warnings, statusLabel, health, events],
  );

  const setCollapsed = useCallback(
    (value: boolean) => dispatch({ type: "set", value }),
    [],
  );

  const toggleCollapsed = useCallback(
    () => dispatch({ type: "toggle" }),
    [],
  );

  const value = useMemo<PipelineProgressContextValue>(
    () => ({
      progress,
      events,
      stageOrder,
      currentStage: derivedStage,
      completedStages,
      availableStages,
      isCollapsed,
      setCollapsed,
      toggleCollapsed,
      onStageSelect,
    }),
    [
      availableStages,
      completedStages,
      derivedStage,
      events,
      isCollapsed,
      onStageSelect,
      progress,
      setCollapsed,
      stageOrder,
      toggleCollapsed,
    ],
  );

  useEffect(() => {
    // Only notify parent if isCollapsed differs from the collapsed prop
    // This prevents circular updates: if they match, the change came from parent sync
    if (typeof collapsed === "boolean" && isCollapsed !== collapsed) {
      onCollapseChange?.(isCollapsed);
    }
  }, [isCollapsed, collapsed, onCollapseChange]);

  return (
    <PipelineProgressContext.Provider value={value}>
      {children}
    </PipelineProgressContext.Provider>
  );
}

export function usePipelineProgress() {
  const context = useContext(PipelineProgressContext);
  if (!context) {
    throw new Error(
      "usePipelineProgress must be used within a PipelineProgressProvider",
    );
  }
  return context;
}
