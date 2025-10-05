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
    <div className={cn("rounded-xl border border-white/40 bg-white/50 backdrop-blur-md p-3 shadow-genniCard md:p-4", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/80 text-genniBlue shadow-sm">
            {icon}
          </div>
          <div className="space-y-1">
            <div className="text-sm font-semibold text-slate-800">{title}</div>
            <p className="text-xs text-slate-500 md:text-sm">{subtitle}</p>
          </div>
        </div>
        {onChange && (
          <button
            type="button"
            onClick={onChange}
            className="inline-flex items-center text-sm font-medium text-genniBlue transition-colors hover:text-genniRose focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-genniBlue focus-visible:ring-offset-2"
          >
            Change source
          </button>
        )}
      </div>
    </div>
  );
}
