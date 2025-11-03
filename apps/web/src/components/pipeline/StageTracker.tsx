import React from "react";
import { motion } from "framer-motion";
import {
  Bot,
  Check,
  Database,
  Download,
  Mail,
  PenTool,
  Search,
  Sparkles,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { STAGE_CONFIGS, STAGE_ORDER } from "@/pipeline/config";
import type { PipelineStage } from "@/pipeline/types";

const STAGE_ICONS = {
  Database,
  Search,
  Mail,
  Bot,
  PenTool,
  Download,
  Sparkles,
};

type Stage = PipelineStage;

type StageStatus = "completed" | "current" | "upcoming";

export interface StageTrackerProps {
  current: Stage;
  completed: Stage[];
  onStageClick?: (stage: Stage) => void;
  total?: number;
  index?: number;
  inlinePanel?: React.ReactNode;
  available?: Stage[];
}

const StageMarker: React.FC<{
  stage: Stage;
  status: StageStatus;
  onClick?: () => void;
  label: string;
  interactive: boolean;
}> = ({ stage, status, onClick, label, interactive }) => {
  const IconComponent = STAGE_ICONS[
    STAGE_CONFIGS[stage].icon as keyof typeof STAGE_ICONS
  ];

  return (
    <div className="flex min-w-[72px] flex-col items-center gap-2 text-center">
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
        onClick={onClick}
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
          "text-xs font-medium text-slate-500",
          status === "current" && "text-cyan-200",
          status === "completed" && "text-emerald-200",
        )}
      >
        {label}
      </span>
    </div>
  );
};

export function StageTracker({
  current,
  completed,
  onStageClick,
  total,
  index,
  inlinePanel,
  available,
}: StageTrackerProps) {
  const orderedStages = STAGE_ORDER as Stage[];
  const totalStages = total ?? orderedStages.length;
  const currentIndex = orderedStages.indexOf(current);
  const displayIndex = index ?? (currentIndex >= 0 ? currentIndex + 1 : 1);

  return (
    <div className="card-glass p-4 md:p-5">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="flex flex-wrap items-center gap-4 md:flex-1">
            {orderedStages.map((stage, stageIndex) => {
              const status: StageStatus = stage === current
                ? "current"
                : completed.includes(stage)
                ? "completed"
                : "upcoming";
              const isAvailable = available?.includes(stage) ?? false;
              const isInteractive = Boolean(onStageClick) &&
                (status === "completed" || status === "current" || isAvailable);

              const handleStageClick = () => {
                if (!onStageClick || !isInteractive) return;
                onStageClick(stage);
              };

              const connectorActive =
                stageIndex < currentIndex || completed.includes(stage);

              return (
                <React.Fragment key={stage}>
                  <div className="flex items-center gap-4">
                    <StageMarker
                      stage={stage}
                      status={status}
                      onClick={isInteractive ? handleStageClick : undefined}
                      label={STAGE_CONFIGS[stage].title}
                      interactive={isInteractive}
                    />
                    {stageIndex < orderedStages.length - 1 && (
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
                </React.Fragment>
              );
            })}
          </div>
          <span className="text-sm text-slate-500 md:ml-auto">
            {displayIndex} of {totalStages} stages
          </span>
        </div>
        {inlinePanel && (
          <div className="flex flex-col gap-3 md:pl-16 lg:pl-20">{inlinePanel}</div>
        )}
      </div>
    </div>
  );
}
