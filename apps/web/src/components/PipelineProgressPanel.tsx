import { useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Database,
  Download,
  Mail,
  PenTool,
  Search,
  Sparkles,
  Timer,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { STAGE_CONFIGS } from "@/pipeline/config";
import type { PipelineStage } from "@/pipeline/types";
import { usePipelineProgress } from "@/contexts/PipelineProgressContext";
import type { PipelineProgressEvent } from "@/types/PipelineProgress";
import { formatBroadcastTime } from "@/hooks/useStatusBroadcasts";

const STAGE_ICONS = {
  Database,
  Search,
  Mail,
  Bot,
  PenTool,
  Download,
  Sparkles,
};

type StageStatus = "completed" | "current" | "upcoming";

type PipelineProgressPanelLayout = "full" | "compact";

interface PipelineProgressPanelProps {
  className?: string;
  layout?: PipelineProgressPanelLayout;
  inlinePanel?: React.ReactNode;
  showTimeline?: boolean;
  actions?: React.ReactNode;
}

// User-facing metrics only - no internal implementation details
const METRIC_LABELS: Record<string, { label: string; icon: LucideIcon; accent: string }> = {
  discovered: { label: "Found", icon: Search, accent: "text-blue-500" },
  enriched: { label: "Contacts", icon: Users, accent: "text-emerald-500" },
  analyzed: { label: "Created", icon: Bot, accent: "text-purple-500" },
  total: { label: "Total", icon: Activity, accent: "text-slate-500" },
  creditsReserved: { label: "Credits", icon: Timer, accent: "text-indigo-500" },
};

const numberFormatter = new Intl.NumberFormat();

const accessibleStageName = (stage: PipelineStage) =>
  STAGE_CONFIGS[stage]?.title ?? stage.replace(/_/g, " ");

const StageMarker = ({
  stage,
  status,
  onClick,
  interactive,
}: {
  stage: PipelineStage;
  status: StageStatus;
  onClick?: () => void;
  interactive: boolean;
}) => {
  const IconComponent = STAGE_ICONS[
    STAGE_CONFIGS[stage].icon as keyof typeof STAGE_ICONS
  ];

  return (
    <div className="flex min-w-[70px] flex-col items-center gap-2 text-center">
      <motion.button
        type="button"
        initial={false}
        animate={{
          scale: status === "current" ? 1.05 : 1,
          boxShadow:
            status === "current"
              ? "0 0 0 6px rgba(34, 197, 94, 0.14)"
              : "0 0 0 0 rgba(0,0,0,0)",
        }}
        transition={{ type: "spring", stiffness: 260, damping: 20 }}
        whileTap={{ scale: 0.96 }}
        onClick={interactive ? onClick : undefined}
        disabled={!interactive}
        className={cn(
          "relative flex h-12 w-12 items-center justify-center rounded-full border-2 bg-slate-900/80 text-sm font-semibold text-slate-300 shadow-[0_0_18px_rgba(0,255,204,0.08)] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-default",
          status === "completed" &&
            "border-emerald-400 bg-emerald-500/20 text-emerald-100",
          status === "current" && "border-cyan-400 text-cyan-200",
          status === "upcoming" && "border-slate-700 text-slate-600",
          interactive && "cursor-pointer hover:scale-[1.04]",
        )}
        aria-current={status === "current" ? "step" : undefined}
      >
        {status === "completed" ? (
          <Check className="h-5 w-5" />
        ) : (
          <IconComponent className="h-5 w-5" />
        )}
      </motion.button>
      <span
        className={cn(
          "text-xs	font-medium text-slate-500",
          status === "current" && "text-cyan-200",
          status === "completed" && "text-emerald-200",
        )}
      >
        {STAGE_CONFIGS[stage].title}
      </span>
    </div>
  );
};

function renderMetricValue(key: string, value: number) {
  if (key === "confidence") {
    return `${value}%`;
  }
  return numberFormatter.format(value);
}

function StageRail({ inlinePanel }: { inlinePanel?: React.ReactNode }) {
  const {
    stageOrder,
    currentStage,
    completedStages,
    availableStages,
    onStageSelect,
  } = usePipelineProgress();

  const currentIndex = stageOrder.indexOf(currentStage);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4 md:flex-1">
        {stageOrder.map((stage, stageIndex) => {
          const status: StageStatus =
            stage === currentStage
              ? "current"
              : completedStages.includes(stage)
                ? "completed"
                : "upcoming";
          const isAvailable = availableStages.includes(stage);
          const isInteractive = Boolean(onStageSelect) &&
            (status === "completed" || status === "current" || isAvailable);

          const connectorActive =
            stageIndex < currentIndex || completedStages.includes(stage);

          return (
            <div key={stage} className="flex items-center gap-4">
              <StageMarker
                stage={stage}
                status={status}
                onClick={() => onStageSelect?.(stage)}
                interactive={isInteractive}
              />
              {stageIndex < stageOrder.length - 1 && (
                <div
                  className={cn(
                    "h-0.5 w-10 rounded-full transition-all md:w-14",
                    connectorActive
                      ? "bg-gradient-to-r from-genniBlue via-genniIndigo to-genniRose"
                      : "bg-slate-200/60",
                  )}
                  aria-hidden="true"
                />
              )}
            </div>
          );
        })}
      </div>
      {inlinePanel && (
        <div className="flex flex-col gap-3 md:pl-16 lg:pl-20">{inlinePanel}</div>
      )}
    </div>
  );
}

function Timeline({
  events,
  emptyLabel,
}: {
  events: PipelineProgressEvent[];
  emptyLabel: string;
}) {
  if (events.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed border-slate-300/70 p-3 text-sm text-muted-foreground dark:border-slate-700/70">
        <AlertCircle className="h-4 w-4" />
        {emptyLabel}
      </div>
    );
  }

  return (
    <ScrollArea className="max-h-64">
      <ol className="space-y-3 pr-2">
        {events.slice(0, 12).map((event) => (
          <li
            key={event.id}
            className="rounded-lg border border-border/60 bg-background/80 p-3 shadow-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] uppercase">
                  {event.stageId ? accessibleStageName(event.stageId) : "Update"}
                </Badge>
                {event.priority && (
                  <Badge
                    variant={event.priority === "critical" ? "destructive" : "secondary"}
                    className="text-[10px]"
                  >
                    {event.priority}
                  </Badge>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {formatBroadcastTime(event.timestamp)}
              </span>
            </div>
            <p className="mt-2 text-sm font-medium text-foreground">
              {event.title}
            </p>
            {event.description && (
              <p className="text-xs text-muted-foreground">{event.description}</p>
            )}
          </li>
        ))}
      </ol>
    </ScrollArea>
  );
}

export function PipelineProgressPanel({
  className,
  layout = "full",
  inlinePanel,
  showTimeline = true,
  actions,
}: PipelineProgressPanelProps) {
  const {
    progress,
    isCollapsed,
    toggleCollapsed,
    currentStage,
  } = usePipelineProgress();

  const previousStageRef = useRef<string | null>(null);
  const stageName = accessibleStageName(currentStage);

  useEffect(() => {
    if (previousStageRef.current !== stageName) {
      previousStageRef.current = stageName;
    }
  }, [stageName]);

  const healthVariant = useMemo(() => {
    switch (progress.health) {
      case "error":
        return {
          label: "Attention",
          className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-200",
        };
      case "warning":
        return {
          label: "Warning",
          className:
            "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200",
        };
      default:
        return {
          label: "Healthy",
          className:
            "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200",
        };
    }
  }, [progress.health]);

  const metrics = useMemo(() => {
    // Filter to only user-facing metrics - exclude internal implementation details
    const EXCLUDED_METRICS = ['scheduledBatches', 'totalBatches', 'sourcesAnalyzed', 'confidence'];

    return Object.entries(progress.metrics)
      .filter(([key, value]) =>
        typeof value === "number" &&
        value >= 0 &&
        !EXCLUDED_METRICS.includes(key) &&
        key in METRIC_LABELS  // Only show explicitly defined user-facing metrics
      )
      .map(([key, value]) => {
        const meta = METRIC_LABELS[key];
        return {
          key,
          value,
          ...meta,
        };
      });
  }, [progress.metrics]);

  const warnings = progress.warnings ?? [];
  const showMetrics = !isCollapsed && metrics.length > 0;
  const showWarnings = !isCollapsed && warnings.length > 0;

  if (layout === "compact") {
    const StageIcon = STAGE_ICONS[
      STAGE_CONFIGS[currentStage].icon as keyof typeof STAGE_ICONS
    ];

    return (
      <Card className={cn("w-full", className)}>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <span
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-full border",
              progress.health === "error"
                ? "border-red-200 bg-red-50 text-red-600"
                : progress.health === "warning"
                  ? "border-amber-200 bg-amber-50 text-amber-600"
                  : "border-primary/30 bg-primary/5 text-primary",
            )}
            aria-hidden="true"
          >
            <StageIcon className="h-4 w-4" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold text-foreground">
                {stageName}
              </span>
              <Badge variant="secondary" className="text-[10px] uppercase">
                {progress.statusLabel ?? "Pipeline"}
              </Badge>
            </div>
            <span className="text-xs text-muted-foreground">
              {progress.percentComplete}% complete
            </span>
          </div>
          {actions}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader className="space-y-3 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-base font-semibold">
              {stageName}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {progress.percentComplete}% complete
              </span>
              {progress.statusLabel && (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-[11px] font-medium">
                  <Sparkles className="h-3 w-3 text-amber-500" />
                  {progress.statusLabel}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={cn("text-[11px]", healthVariant.className)}>
              {healthVariant.label}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2 border border-genniBlue/30 bg-gradient-to-r from-genniBlue/5 to-genniIndigo/5 hover:from-genniBlue/10 hover:to-genniIndigo/10 text-genniBlue hover:text-genniIndigo transition-all duration-200"
              onClick={toggleCollapsed}
            >
              {isCollapsed ? (
                <>
                  Expand
                  <ChevronDown className="ml-1 h-3.5 w-3.5" />
                </>
              ) : (
                <>
                  Collapse
                  <ChevronUp className="ml-1 h-3.5 w-3.5" />
                </>
              )}
            </Button>
            {actions}
          </div>
        </div>
        <div className="sr-only" aria-live="polite">
          Pipeline stage {stageName}
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pt-0">
        <StageRail inlinePanel={!isCollapsed ? inlinePanel : undefined} />

        {showMetrics && (
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Activity className="h-4 w-4" /> Live metrics
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {metrics.map((metric) => (
                <div
                  key={metric.key}
                  className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 p-3"
                >
                  <span className={cn("rounded-full bg-background p-2", metric.accent)}>
                    <metric.icon className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-lg font-semibold">
                      {renderMetricValue(metric.key, metric.value)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {metric.label}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {showWarnings && (
          <div className="space-y-2 rounded-lg border border-amber-300/70 bg-amber-50/70 p-3 text-amber-900 dark:border-amber-500/60 dark:bg-amber-950/30 dark:text-amber-200">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4" /> Pipeline warnings
            </div>
            <ul className="space-y-1 text-xs">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        {showTimeline && !isCollapsed && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Timer className="h-4 w-4" />
                Recent activity
              </div>
              <span className="text-xs text-muted-foreground">
                Showing latest {Math.min(progress.timeline?.length ?? 0, 12)} updates
              </span>
            </div>
            <Separator />
            <Timeline
              events={progress.timeline ?? []}
              emptyLabel="No recent updates from the research pipeline yet."
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
