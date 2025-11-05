import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Search,
  Zap,
  ChevronRight,
  Clock,
  CheckCircle,
  AlertTriangle,
  TrendingUp,
  Brain,
  Users,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ResearchTierFlowProps {
  currentTier?: "tavily" | "perplexity" | "error";
  stage?: string;
  confidence?: number;
  dataPoints?: number;
  sourcesAnalyzed?: number;
  escalationReason?: string;
  className?: string;
  showProgress?: boolean;
}

export function ResearchTierFlow({
  currentTier,
  stage,
  confidence,
  dataPoints,
  sourcesAnalyzed,
  escalationReason,
  className,
  showProgress = true,
}: ResearchTierFlowProps) {
  const tiers = [
    {
      id: "tavily",
      name: "Standard",
      icon: Search,
      color: "text-blue-500",
      bg: "bg-blue-50",
      border: "border-blue-200",
      description: "Fast business context research",
      duration: "2-3s",
      features: [
        "Basic company info",
        "Industry classification",
        "Contact discovery",
      ],
    },
    {
      id: "perplexity",
      name: "Deep",
      icon: Zap,
      color: "text-amber-600",
      bg: "bg-amber-50",
      border: "border-amber-200",
      description: "Comprehensive research report",
      duration: "8-12s",
      features: [
        "Comprehensive report",
        "Strategic insights",
        "Detailed analysis",
      ],
    },
  ];

  const getCurrentTierIndex = () => {
    return tiers.findIndex((tier) => tier.id === currentTier);
  };

  const getStageProgress = () => {
    if (!stage) return 0;

    const stageProgress = {
      research_started: 10,
      tier1_tavily: 45,
      tier2_perplexity: 90,
      research_completed: 100,
      research_failed: 0,
      research_error: 0,
    };

    return stageProgress[stage as keyof typeof stageProgress] || 0;
  };

  const currentTierIndex = getCurrentTierIndex();
  const progressPercentage = getStageProgress();

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" />
          Research Intelligence Pipeline
          {currentTier && (
            <Badge
              variant="outline"
              className={cn(
                "ml-2",
                tiers.find((t) => t.id === currentTier)?.bg,
              )}
            >
              {tiers.find((t) => t.id === currentTier)?.name} Active
            </Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Progress Overview */}
        {showProgress && stage && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Research Progress</span>
              <span>{progressPercentage}%</span>
            </div>
            <Progress value={progressPercentage} className="h-2" />
            <p className="text-xs text-muted-foreground">
              {stage.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase())}
            </p>
          </div>
        )}

        {/* Tier Flow Visualization */}
        <div className="space-y-4">
          {tiers.map((tier, index) => {
            const TierIcon = tier.icon;
            const isActive = tier.id === currentTier;
            const isCompleted = currentTierIndex > index;
            const isPending = currentTierIndex < index;

            return (
              <div key={tier.id} className="relative">
                {/* Tier Card */}
                <Card
                  className={cn(
                    "transition-all duration-300",
                    isActive &&
                      cn(
                        "ring-2 ring-offset-2",
                        tier.border.replace("border-", "ring-"),
                      ),
                    isCompleted && "opacity-75",
                    isPending && "opacity-50",
                  )}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      {/* Status Indicator */}
                      <div
                        className={cn(
                          "w-10 h-10 rounded-full flex items-center justify-center transition-all",
                          isActive && cn(tier.bg, tier.color),
                          isCompleted && "bg-green-100 text-green-600",
                          isPending && "bg-gray-100 text-gray-400",
                        )}
                      >
                        {isCompleted ? (
                          <CheckCircle className="h-5 w-5" />
                        ) : isActive ? (
                          <TierIcon className="h-5 w-5 animate-pulse" />
                        ) : (
                          <TierIcon className="h-5 w-5" />
                        )}
                      </div>

                      {/* Tier Info */}
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-sm">
                            {tier.name} Research
                          </h3>
                          <Badge variant="outline" className="text-xs">
                            {tier.duration}
                          </Badge>
                          {isActive && (
                            <Badge
                              variant="secondary"
                              className="text-xs animate-pulse"
                            >
                              Processing
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">
                          {tier.description}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {tier.features.map((feature, featureIndex) => (
                            <Badge
                              key={featureIndex}
                              variant="outline"
                              className="text-xs"
                            >
                              {feature}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      {/* Metrics */}
                      {isActive &&
                        (confidence || dataPoints || sourcesAnalyzed) && (
                          <div className="text-right space-y-1">
                            {confidence && (
                              <div className="text-sm font-medium">
                                {Math.round(confidence * 100)}% confidence
                              </div>
                            )}
                            {sourcesAnalyzed && (
                              <div className="text-xs text-muted-foreground">
                                {sourcesAnalyzed} sources
                              </div>
                            )}
                            {dataPoints && (
                              <div className="text-xs text-muted-foreground">
                                {dataPoints} data points
                              </div>
                            )}
                          </div>
                        )}
                    </div>
                  </CardContent>
                </Card>

                {/* Flow Arrow */}
                {index < tiers.length - 1 && (
                  <div className="flex justify-center my-2">
                    <div
                      className={cn(
                        "w-6 h-6 rounded-full flex items-center justify-center transition-colors",
                        currentTierIndex > index
                          ? "bg-green-100 text-green-600"
                          : "bg-gray-100 text-gray-400",
                      )}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Escalation Alert */}
        {escalationReason && (
          <Alert className="border-amber-200 bg-amber-50">
            <TrendingUp className="h-4 w-4 text-amber-600" />
            <AlertDescription>
              <strong>Research Enhanced:</strong> {escalationReason}
            </AlertDescription>
          </Alert>
        )}

        {/* Research Quality Summary */}
        {(confidence || sourcesAnalyzed) && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-4 bg-muted/30 rounded-lg">
            {confidence && (
              <div className="text-center">
                <div className="text-lg font-semibold text-green-600">
                  {Math.round(confidence * 100)}%
                </div>
                <div className="text-xs text-muted-foreground">
                  Research Quality
                </div>
              </div>
            )}
            {sourcesAnalyzed && (
              <div className="text-center">
                <div className="text-lg font-semibold text-blue-600">
                  {sourcesAnalyzed}
                </div>
                <div className="text-xs text-muted-foreground">
                  Sources Analyzed
                </div>
              </div>
            )}
            {dataPoints && (
              <div className="text-center">
                <div className="text-lg font-semibold text-purple-600">
                  {dataPoints}
                </div>
                <div className="text-xs text-muted-foreground">Data Points</div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
