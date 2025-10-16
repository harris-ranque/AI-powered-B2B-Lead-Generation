import React from "react";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";

interface EstimatedCostCardProps {
  estimatedCredits: number;
  availableCredits: number;
  afterBalance: number;
  onStart?: () => void;
  disabled?: boolean;
  isProcessing?: boolean;
  className?: string;
}

export function EstimatedCostCard({
  estimatedCredits,
  availableCredits,
  afterBalance,
  onStart,
  disabled,
  isProcessing,
  className,
}: EstimatedCostCardProps) {
  const isActionDisabled = disabled || !onStart;

  return (
    <div className={cn("card-glass p-4 md:p-5", className)}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600">Estimated Cost</span>
            <span className="rounded-full bg-gradient-to-r from-genniBlue via-genniIndigo to-genniRose px-2.5 py-1 text-sm font-medium text-white shadow-[0_0_20px_rgba(16,185,129,0.3)]">
              {estimatedCredits} credits
            </span>
          </div>
          <button
            type="button"
            onClick={onStart}
            disabled={isActionDisabled}
            className={cn(
              "btn-primary-gradient min-w-[180px] justify-center",
              isProcessing && "brightness-105",
            )}
          >
            <Search className={cn("h-4 w-4", isProcessing && "animate-spin")} />
            {isProcessing ? "Discovering..." : "Start Discovery"}
          </button>
        </div>
        <p className="text-sm text-slate-500">
          You have <span className="font-medium text-slate-700">{availableCredits}</span> credits available.
        </p>
        <div>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            After search: {afterBalance} credits
          </span>
        </div>
      </div>
    </div>
  );
}
