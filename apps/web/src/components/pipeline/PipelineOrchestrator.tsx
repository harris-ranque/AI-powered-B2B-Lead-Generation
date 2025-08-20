import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { usePipeline } from '@/pipeline/context';
import type { Lead } from '@/lib/api-client';
import { STAGE_CONFIGS, STAGE_ORDER } from '@/pipeline/config';
import { PipelineStepper } from './PipelineStepper';
import { SourceSelector } from './SourceSelector';
import { LeadDiscoveryStage } from './LeadDiscoveryStage';
import { EnrichmentStage } from './EnrichmentStage';
import { AIAnalysisStage } from './AIAnalysisStage';
import { EmailGenerationStage } from './EmailGenerationStage';
import { ReviewExportStage } from './ReviewExportStage';
import { CheckCircle, Clock, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PipelineOrchestratorProps {
  userCredits: number;
  userPlan: 'free' | 'pro' | 'enterprise';
  onGenerateEmail?: (lead: Lead) => void;
}

export function PipelineOrchestrator({ 
  userCredits, 
  userPlan, 
  onGenerateEmail 
}: PipelineOrchestratorProps) {
  const { state, setStage } = usePipeline();
  
  const currentStageIndex = STAGE_ORDER.indexOf(state.currentStage);
  const progressPercentage = (currentStageIndex / (STAGE_ORDER.length - 1)) * 100;

  const renderStageContent = () => {
    switch (state.currentStage) {
      case 'source_selection':
        return <SourceSelector />;
      case 'lead_discovery':
        return <LeadDiscoveryStage userCredits={userCredits} userPlan={userPlan} />;
      case 'enrichment':
        return <EnrichmentStage />;
      case 'ai_analysis':
        return <AIAnalysisStage />;
      case 'email_generation':
        return <EmailGenerationStage onGenerateEmail={onGenerateEmail} />;
      case 'review_export':
        return <ReviewExportStage />;
      default:
        return <SourceSelector />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Pipeline Header */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Lead Generation Pipeline</h2>
            <p className="text-muted-foreground">
              Follow the guided workflow to discover, enrich, and generate personalized emails
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="bg-green-100 text-green-800">
              <Sparkles className="h-3 w-3 mr-1" />
              AI-Powered Pipeline
            </Badge>
            
            <div className="text-right text-sm">
              <div className="font-medium">{userCredits} Credits</div>
              <div className="text-xs text-muted-foreground capitalize">{userPlan} Plan</div>
            </div>
          </div>
        </div>

        {/* Overall Progress */}
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Pipeline Progress</span>
                  <span className="text-sm text-muted-foreground">
                    {state.completedStages.length} of {STAGE_ORDER.length} stages
                  </span>
                </div>
                <Progress 
                  value={progressPercentage} 
                  className="h-2"
                />
              </div>
              
              {state.isProcessing && (
                <div className="flex items-center gap-2 text-sm text-primary">
                  <Clock className="h-4 w-4 animate-spin" />
                  Processing...
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pipeline Stepper */}
      <PipelineStepper />

      {/* Current Stage Content */}
      <div className={cn(
        "transition-all duration-500 ease-in-out",
        state.isProcessing && "opacity-75 pointer-events-none"
      )}>
        {renderStageContent()}
      </div>

      {/* Pipeline Status */}
      <Card className="glass-card">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-3 h-3 rounded-full transition-colors",
                state.isProcessing ? "bg-yellow-500 animate-pulse" : "bg-green-500"
              )} />
              <span className="text-sm font-medium">
                {state.isProcessing ? 'Processing...' : 'Ready'}
              </span>
            </div>
            
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              {state.leads.length > 0 && (
                <span>{state.leads.length} leads discovered</span>
              )}
              {state.enrichedLeads.length > 0 && (
                <span>{state.enrichedLeads.length} leads enriched</span>
              )}
              {state.generatedEmails.length > 0 && (
                <span>{state.generatedEmails.length} emails generated</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}