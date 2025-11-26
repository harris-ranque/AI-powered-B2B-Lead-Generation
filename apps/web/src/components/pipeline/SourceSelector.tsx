import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { usePipeline } from "@/pipeline/context";
import type { LeadSourceType } from "@/pipeline/types";
import { SourceRegistry } from "@/pipeline/sources/SourceRegistry";
import {
  MapPin,
  Upload,
  Database,
  ArrowRight,
  Sparkles,
  CheckCircle,
  Info,
  Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";

const SOURCE_ICONS = {
  MapPin,
  Upload,
  Database,
};

export function SourceSelector() {
  const { state, setSource, markStageComplete, progressToNextStage } =
    usePipeline();
  const [hoveredSource, setHoveredSource] = useState<string | null>(null);

  const availableSources = SourceRegistry.getAvailableSources();

  const handleSourceSelect = (sourceType: LeadSourceType) => {
    setSource(sourceType);
    markStageComplete("source_selection");

    // Small delay for visual feedback, then progress
    setTimeout(() => {
      progressToNextStage();
    }, 500);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <h3 className="text-xl font-semibold">Choose Your Data Source</h3>
        <p className="text-muted-foreground">
          Select how you want to find leads for your campaign
        </p>
      </div>

      {/* Source Options */}
      <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
        {availableSources.map((source) => {
          const IconComponent = source.type === "google_maps" ? MapPin : Upload;
          const isSelected = state.selectedSource === source.type;
          const isHovered = hoveredSource === source.type;
          const isDisabled = false; // CSV upload is now enabled!

          return (
            <Card
              key={source.type}
              className={cn(
                "glass-card cursor-pointer transition-all duration-300 hover-lift",
                "border-2 relative overflow-hidden",
                isSelected && "border-primary glow-neon-lime",
                isHovered && !isSelected && !isDisabled && "border-primary/50",
                isDisabled && "opacity-50 blur-[1px] cursor-not-allowed",
              )}
              onMouseEnter={() => setHoveredSource(source.type)}
              onMouseLeave={() => setHoveredSource(null)}
              onClick={() => {
                if (isDisabled) return;
                if (!isSelected) handleSourceSelect(source.type);
              }}
            >
              {/* Selection indicator */}
              {isSelected && (
                <div className="absolute top-3 right-3">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                </div>
              )}

              {/* Animated background */}
              <div
                className={cn(
                  "absolute inset-0 opacity-0 transition-opacity duration-300",
                  isHovered && "opacity-5",
                  isSelected && "opacity-10",
                )}
              >
                <div className="w-full h-full bg-gradient-neon-primary" />
              </div>

              <CardHeader className="relative">
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "p-3 rounded-xl transition-all duration-300",
                      isSelected && "bg-primary/20 glow-soft",
                      !isSelected && "bg-muted/20",
                    )}
                  >
                    <IconComponent
                      className={cn(
                        "h-6 w-6 transition-colors",
                        isSelected && "text-primary",
                        !isSelected && "text-muted-foreground",
                      )}
                    />
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg">{source.name}</CardTitle>
                      {isDisabled && (
                        <Badge variant="secondary" className="text-[10px]">
                          Disabled
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {isDisabled
                        ? "CSV upload is temporarily unavailable."
                        : source.description}
                    </p>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="relative">
                <div className="space-y-4">
                  {/* Features */}
                  <div className="flex flex-wrap gap-2">
                    {source.supportsEnrichment && (
                      <Badge variant="outline" className="text-xs">
                        <Mail className="h-3 w-3 mr-1" />
                        Email Enrichment
                      </Badge>
                    )}
                    {source.supportsAI && (
                      <Badge variant="outline" className="text-xs">
                        <Sparkles className="h-3 w-3 mr-1" />
                        AI Analysis
                      </Badge>
                    )}
                  </div>

                  {/* Source-specific information */}
                  {source.type === "google_maps" && (
                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertDescription className="text-xs">
                        Discover local businesses using Google Maps data.
                        Perfect for location-based outreach.
                      </AlertDescription>
                    </Alert>
                  )}

                  {source.type === "csv_upload" && (
                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertDescription className="text-xs">
                        Import your existing leads. Provide emails to save credits
                        (skips enrichment), or provide domains for full enrichment.
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* Selection Button */}
                  {!isSelected && (
                    <Button
                      className="w-full mt-4"
                      variant={isHovered && !isDisabled ? "default" : "outline"}
                      onClick={() =>
                        !isDisabled && handleSourceSelect(source.type)
                      }
                      disabled={isDisabled}
                    >
                      {isDisabled ? "Disabled" : `Select ${source.name}`}
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  )}

                  {isSelected && (
                    <Button
                      className="w-full mt-4"
                      variant="default"
                      onClick={progressToNextStage}
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Continue to Lead Discovery
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Help Text */}
      <div className="text-center text-sm text-muted-foreground max-w-2xl mx-auto">
        Choose your preferred method to find leads. Google Maps is great for
        discovering new local businesses, while CSV upload lets you work with
        your existing prospect lists.
      </div>
    </div>
  );
}
