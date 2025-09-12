import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePipeline } from '@/pipeline/context';
import type { PipelineStage } from '@/pipeline/types';
import { STAGE_CONFIGS, STAGE_ORDER } from '@/pipeline/config';
import { 
  CheckCircle, 
  Circle, 
  Clock, 
  ArrowRight,
  Database,
  Search,
  Mail,
  Bot,
  PenTool,
  Download
} from 'lucide-react';
import { cn } from '@/lib/utils';

const STAGE_ICONS = {
  Database,
  Search,
  Mail,
  Bot,
  PenTool,
  Download,
};

export function PipelineStepper() {
  const { state, setStage, canProgressToStage } = usePipeline();

  const getStageStatus = (stage: string) => {
    if (state.completedStages.includes(stage as PipelineStage)) return 'completed';
    if (state.currentStage === stage) return 'active';
    if (canProgressToStage(stage as PipelineStage)) return 'available';
    return 'disabled';
  };

  return (
    <Card className="glass-card overflow-hidden">
      <CardContent className="p-6">
        <div className="relative">
          {/* Progress Line */}
          <div className="absolute top-6 left-6 right-6 h-0.5 bg-border">
            <div 
              className="h-full stepper-progress-line transition-all duration-1000 ease-out glow-soft"
              style={{ 
                width: `${(Math.max(0, state.completedStages.length - 1) / (STAGE_ORDER.length - 1)) * 100}%` 
              }}
            />
          </div>

          {/* Stages */}
          <div className="relative flex justify-between">
            {STAGE_ORDER.map((stageId, index) => {
              const config = STAGE_CONFIGS[stageId];
              const status = getStageStatus(stageId);
              const IconComponent = STAGE_ICONS[config.icon as keyof typeof STAGE_ICONS];
              
              return (
                <div key={stageId} className="flex flex-col items-center">
                  {/* Stage Circle */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "relative w-12 h-12 rounded-full border-2 transition-all duration-300",
                      "hover:scale-110 hover-lift",
                      status === 'completed' && "bg-green-500/20 border-green-500 text-green-500 glow-neon-lime",
                      status === 'active' && "bg-primary/20 border-primary text-primary animate-neon-pulse",
                      status === 'available' && "bg-muted border-muted-foreground/30 text-muted-foreground hover:border-primary/50",
                      status === 'disabled' && "bg-muted/50 border-muted-foreground/20 text-muted-foreground/50 cursor-not-allowed"
                    )}
                    onClick={() => {
                      if (canProgressToStage(stageId)) {
                        setStage(stageId);
                      }
                    }}
                    disabled={!canProgressToStage(stageId)}
                  >
                    {status === 'completed' ? (
                      <CheckCircle className="h-5 w-5" />
                    ) : status === 'active' && state.isProcessing ? (
                      <Clock className="h-5 w-5 animate-spin" />
                    ) : (
                      <IconComponent className="h-5 w-5" />
                    )}
                    
                    {/* Active stage glow effect */}
                    {status === 'active' && (
                      <div className="absolute inset-0 rounded-full bg-primary/10 animate-neon-pulse-slow" />
                    )}

                    {/* Completion celebration */}
                    {status === 'completed' && (
                      <div className="absolute inset-0 rounded-full stage-complete" />
                    )}
                  </Button>

                  {/* Stage Info */}
                  <div className="mt-3 text-center max-w-24">
                    <div className={cn(
                      "text-xs font-medium transition-colors",
                      status === 'active' && "text-primary",
                      status === 'completed' && "text-green-600",
                      status === 'disabled' && "text-muted-foreground/50"
                    )}>
                      {config.title}
                    </div>
                    
                    {status === 'active' && (
                      <Badge variant="outline" className="mt-1 text-xs">
                        {config.estimatedTime}
                      </Badge>
                    )}
                    
                    {config.requiresCredits && status !== 'completed' && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Credits required
                      </div>
                    )}
                  </div>

                  {/* Connection Line to Next Stage */}
                  {index < STAGE_ORDER.length - 1 && (
                    <ArrowRight className={cn(
                      "absolute top-6 left-16 h-4 w-4 text-muted-foreground/30 transition-colors",
                      state.completedStages.includes(stageId) && "text-primary"
                    )} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Current Stage Description */}
        <div className="mt-8 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary border border-primary/20">
            <Clock className="h-4 w-4" />
            <span className="text-sm font-medium">
              {STAGE_CONFIGS[state.currentStage].description}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}