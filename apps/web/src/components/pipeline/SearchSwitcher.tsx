import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import type { Search } from "@/lib/types";
import type { Id } from "@genni/convex-types/dataModel";

interface SearchSwitcherProps {
  searches: Search[];
  activeSearchId: Id<"searches"> | null;
  onSelectSearch: (searchId: Id<"searches">, status: string) => void;
  onNewSearch: () => void;
}

const STATUS_DOT: Record<string, string> = {
  completed: "bg-emerald-500",
  in_progress: "bg-blue-500 animate-pulse",
  processing: "bg-blue-500 animate-pulse",
  pending: "bg-gray-400",
  failed: "bg-red-500",
  cancelled: "bg-red-500",
};

export function SearchSwitcher({
  searches,
  activeSearchId,
  onSelectSearch,
  onNewSearch,
}: SearchSwitcherProps) {
  const recent = searches
    .slice()
    .sort((a, b) => (b._creationTime ?? 0) - (a._creationTime ?? 0))
    .slice(0, 5);

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      <Button
        size="sm"
        variant={activeSearchId ? "outline" : "default"}
        className="shrink-0 gap-1.5"
        onClick={onNewSearch}
      >
        <Plus className="h-3.5 w-3.5" />
        New Search
      </Button>

      {recent.length > 0 && (
        <>
          <div className="h-6 w-px shrink-0 bg-border" />

          {recent.map((s) => {
            const isActive = s._id === activeSearchId;
            const dotClass = STATUS_DOT[s.status] ?? "bg-gray-400";
            const label =
              s.name && s.name.length > 30
                ? s.name.slice(0, 30) + "..."
                : s.name || "Untitled";

            return (
              <button
                key={s._id}
                onClick={() => onSelectSearch(s._id, s.status)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  isActive
                    ? "border-primary/50 bg-secondary ring-1 ring-primary/30 text-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                )}
              >
                <span className={cn("h-2 w-2 rounded-full", dotClass)} />
                {label}
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
