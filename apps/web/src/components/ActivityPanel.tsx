import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Mail,
  UserPlus,
  TrendingUp,
  Brain,
  Zap,
  Users,
  Building,
  Clock,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";
import {
  useStatusBroadcasts,
  formatBroadcastTime,
  getPriorityDisplay,
} from "@/hooks/useStatusBroadcasts";
import { useSearches } from "@/hooks/useSearches";
import { useUserLeads } from "@/hooks/useLeads";

// Fallback activities for when no real-time data is available
const fallbackActivities = [
  {
    id: "fallback-1",
    type: "search",
    icon: Search,
    title: "Ready to start searching",
    description: "Create your first lead search to see activity",
    time: "now",
    status: "info" as const,
    isHistoryEvent: false,
  },
];

interface ActivityPanelProps {
  onNavigateToHistory?: () => void;
}

export function ActivityPanel({ onNavigateToHistory }: ActivityPanelProps = {}) {
  // Get real-time data
  const { broadcasts, latestStatus } = useStatusBroadcasts();
  const { searches } = useSearches();
  const { stats } = useUserLeads();

  // Convert broadcasts to activity format
  const getActivityIcon = (type: string, stage?: string) => {
    if (stage?.includes("research")) return Brain;
    if (stage?.includes("tier1_tavily")) return Search;
    if (stage?.includes("tier2_perplexity")) return Zap;
    if (stage?.includes("discovery")) return Building;
    if (stage?.includes("enrichment")) return UserPlus;
    if (stage?.includes("analysis")) return Brain;

    switch (type) {
      case "search":
        return Search;
      case "lead":
        return Users;
      case "research":
        return Brain;
      case "email":
        return Mail;
      default:
        return TrendingUp;
    }
  };

  const getActivityStatus = (priority: number) => {
    if (priority >= 4) return "success";
    if (priority >= 3) return "warning";
    return "info";
  };

  // Create activities from real-time broadcasts
  const realtimeActivities = broadcasts.slice(0, 6).map((broadcast, index) => {
    const stage = broadcast.data?.stage || broadcast.type;
    const redirectTo =
      broadcast.data &&
      typeof broadcast.data === "object" &&
      "redirectTo" in broadcast.data
        ? (broadcast.data as Record<string, unknown>).redirectTo
        : undefined;
    const isHistoryEvent =
      stage === "email_generation_completed" || redirectTo === "search-history";
    return {
      id: broadcast._id,
      type: broadcast.type,
      icon: getActivityIcon(broadcast.type, stage),
      title: broadcast.title,
      description: broadcast.message,
      time: formatBroadcastTime(broadcast.createdAt),
      status: getActivityStatus(broadcast.priority),
      isHistoryEvent,
    };
  });

  // Use real-time activities or fallback
  const activities =
    realtimeActivities.length > 0 ? realtimeActivities : fallbackActivities;

  return (
    <div className="flex flex-col h-full space-y-6">
      {/* Sticky Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <h3 className="text-lg font-semibold">Recent Activity</h3>
        {latestStatus && (
          <Badge variant="outline" className="text-xs">
            Live
          </Badge>
        )}
      </div>

      {/* Scrollable Activity List */}
      <div className="flex-1 overflow-y-auto space-y-3 min-h-0 pr-2 -mr-2">
        {activities.map((activity) => {
          const Icon = activity.icon;
          const priorityDisplay = activity.id.startsWith("fallback")
            ? { variant: "secondary" as const, bgColor: "bg-muted/20" }
            : getPriorityDisplay(
                broadcasts.find((b) => b._id === activity.id)?.priority || 1,
              );

          return (
            <Card
              key={activity.id}
              className={`glass-card p-4 hover-accent transition-smooth ${
                activity.isHistoryEvent && onNavigateToHistory
                  ? "cursor-pointer"
                  : "cursor-default"
              }`}
              onClick={() => {
                if (activity.isHistoryEvent && onNavigateToHistory) {
                  onNavigateToHistory();
                }
              }}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`
                  w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0
                  ${
                    activity.status === "success"
                      ? "bg-green-100 text-green-600"
                      : activity.status === "warning"
                        ? "bg-amber-100 text-amber-600"
                        : "bg-blue-100 text-blue-600"
                  }
                `}
                >
                  <Icon className="h-4 w-4" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm mb-1">
                    {activity.title}
                  </div>
                  <div className="text-xs text-muted-foreground mb-2">
                    {activity.description}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {activity.time}
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Sticky Stats Section */}
      <div className="space-y-3 pt-4 border-t border-border flex-shrink-0">
        <h4 className="text-sm font-medium text-muted-foreground">
          Current Stats
        </h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="text-center">
            <div className="text-lg font-bold text-primary">
              {searches?.searches?.length || 0}
            </div>
            <div className="text-xs text-muted-foreground">Active Searches</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-primary">
              {stats?.totalLeads || 0}
            </div>
            <div className="text-xs text-muted-foreground">Total Leads</div>
          </div>
        </div>

        {/* Research Quality Indicator */}
        {searches?.searches?.some((s) => s.researchConfidence) && (
          <div className="pt-2 border-t">
            <div className="text-center">
              <div className="text-lg font-bold text-amber-600">
                {Math.round(
                  (searches.searches
                    .filter((s) => s.researchConfidence)
                    .reduce((sum, s) => sum + (s.researchConfidence || 0), 0) /
                    searches.searches.filter((s) => s.researchConfidence)
                      .length) *
                    100,
                )}
                %
              </div>
              <div className="text-xs text-muted-foreground">
                Avg Research Quality
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
