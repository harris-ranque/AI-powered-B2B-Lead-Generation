import React from "react";

import { cn } from "@/lib/utils";

interface SourceInlinePanelProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onChange?: () => void;
  className?: string;
}

export function SourceInlinePanel({
  icon,
  title,
  subtitle,
  onChange,
  className,
}: SourceInlinePanelProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-800/60 bg-slate-900/70 p-3 shadow-[0_18px_48px_-28px_rgba(0,255,204,0.25)] md:p-4",
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-cyan-500/40 bg-slate-900/60 text-cyan-200 shadow-[0_0_18px_rgba(0,255,204,0.18)]">
            {icon}
          </div>
          <div className="space-y-1">
            <div className="text-sm font-semibold text-slate-100">{title}</div>
            <p className="text-xs text-slate-400 md:text-sm">{subtitle}</p>
          </div>
        </div>
        {onChange && (
          <button
            type="button"
            onClick={onChange}
            className="inline-flex items-center text-sm font-medium text-cyan-200 transition-colors hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          >
            Change source
          </button>
        )}
      </div>
    </div>
  );
}
