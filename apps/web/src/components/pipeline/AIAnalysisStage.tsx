import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { usePipeline } from '@/pipeline/context';
import { 
  Bot, 
  Brain, 
  Target, 
  TrendingUp,
  ArrowRight,
  Sparkles,
  CheckCircle,
  Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';

export function AIAnalysisStage() {
  const { state, markStageComplete, progressToNextStage } = usePipeline();
  
  // Mock analysis progress - in real implementation this would track LangGraph progress
  const analysisProgress = 75; // Would come from actual AI analysis status
  const analyzedLeads = Math.floor((state.enrichedLeads.length * analysisProgress) / 100);
  
  const handleContinue = () => {
    markStageComplete('ai_analysis');
    progressToNextStage();
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="text-center space-y-2">
        <h3 className="text-xl font-semibold flex items-center justify-center gap-2">
          <Bot className="h-5 w-5" />
          AI Analysis in Progress
        </h3>
        <p className="text-muted-foreground">
          Our 5-agent system is analyzing your leads for relevance and opportunities
        </p>
      </div>

      {/* AI Analysis Progress */}
      <Card className="glass-card">
        <CardContent className="p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h4 className="font-semibold flex items-center gap-2">
                  <Brain className="h-4 w-4" />
                  Multi-Agent Analysis
                </h4>
                <p className="text-sm text-muted-foreground">
                  {analyzedLeads} of {state.enrichedLeads.length} leads analyzed
                </p>
              </div>
              
              <Badge variant={analysisProgress === 100 ? "default" : "secondary"} className="animate-pulse">
                {analysisProgress.toFixed(0)}% Complete
              </Badge>
            </div>
            
            <Progress 
              value={analysisProgress} 
              className="h-3"
            />
          </div>
        </CardContent>
      </Card>

      {/* AI Agents Status */}
      <div className="grid md:grid-cols-5 gap-4">
        {[
          { name: 'Relevance Analyzer', icon: Target, status: 'complete', description: 'Lead relevance scoring' },
          { name: 'Pain Point Researcher', icon: Brain, status: 'complete', description: 'Identifying challenges' },
          { name: 'Value Matcher', icon: TrendingUp, status: 'active', description: 'Solution alignment' },
          { name: 'Email Writer', icon: Bot, status: 'pending', description: 'Personalization prep' },
          { name: 'Follow-up Strategist', icon: Sparkles, status: 'pending', description: 'Sequence planning' },
        ].map((agent, index) => (
          <Card key={agent.name} className="glass-card">
            <CardContent className="p-4 text-center">
              <div className={cn(
                "w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center transition-all duration-300",
                agent.status === 'complete' && "bg-green-500/20 text-green-500",
                agent.status === 'active' && "bg-primary/20 text-primary animate-neon-pulse",
                agent.status === 'pending' && "bg-muted/20 text-muted-foreground"
              )}>
                {agent.status === 'complete' ? (
                  <CheckCircle className="h-6 w-6" />
                ) : agent.status === 'active' ? (
                  <Clock className="h-6 w-6 animate-spin" />
                ) : (
                  <agent.icon className="h-6 w-6" />
                )}
              </div>
              
              <div className="space-y-1">
                <div className="text-sm font-medium">{agent.name}</div>
                <div className="text-xs text-muted-foreground">{agent.description}</div>
                
                <Badge 
                  variant={
                    agent.status === 'complete' ? 'default' : 
                    agent.status === 'active' ? 'secondary' : 'outline'
                  }
                  className="text-xs mt-2"
                >
                  {agent.status === 'complete' ? 'Complete' : 
                   agent.status === 'active' ? 'Processing' : 'Pending'}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Analysis Insights Preview */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">Analysis Insights</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="text-center space-y-2">
              <div className="text-2xl font-bold text-green-500">87%</div>
              <div className="text-sm text-muted-foreground">High Relevance Leads</div>
              <Badge variant="outline" className="text-xs">
                {Math.floor(analyzedLeads * 0.87)} leads
              </Badge>
            </div>
            
            <div className="text-center space-y-2">
              <div className="text-2xl font-bold text-blue-500">3.2</div>
              <div className="text-sm text-muted-foreground">Avg Pain Points per Lead</div>
              <Badge variant="outline" className="text-xs">
                High personalization potential
              </Badge>
            </div>
            
            <div className="text-center space-y-2">
              <div className="text-2xl font-bold text-purple-500">24%</div>
              <div className="text-sm text-muted-foreground">Estimated Response Rate</div>
              <Badge variant="outline" className="text-xs">
                Above industry average
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Analyzed Leads Preview */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">Top Analyzed Leads</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {state.enrichedLeads.slice(0, 5).map((lead, index) => (
              <div 
                key={lead.id}
                className="flex items-center gap-4 p-4 rounded-lg bg-muted/10 border border-muted/20 hover:border-primary/20 transition-all duration-300"
              >
                <div className="w-10 h-10 rounded-full bg-gradient-neon-primary/20 flex items-center justify-center">
                  <Building className="h-5 w-5 text-primary" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{lead.company_name}</div>
                  <div className="text-sm text-muted-foreground">{lead.industry || 'Industry not specified'}</div>
                  {lead.email && (
                    <div className="text-xs text-green-600 mt-1">✓ Email found</div>
                  )}
                </div>
                
                <div className="text-right">
                  <div className="text-sm font-medium text-green-600">
                    {(Math.random() * 0.3 + 0.7).toFixed(1)} relevance
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {Math.floor(Math.random() * 3 + 2)} pain points
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Continue Button */}
      {analysisProgress === 100 && (
        <div className="text-center">
          <Button
            onClick={handleContinue}
            size="lg"
            className="min-w-48"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            Generate Personalized Emails
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      )}

      {/* Processing Status */}
      {analysisProgress < 100 && (
        <div className="text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary border border-primary/20">
            <Clock className="h-4 w-4 animate-spin" />
            <span className="text-sm font-medium">
              AI analysis in progress... ({Math.floor(analysisProgress)}% complete)
            </span>
          </div>
        </div>
      )}
    </div>
  );
}