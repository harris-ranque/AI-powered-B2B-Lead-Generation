import React, { useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { usePipeline } from '@/pipeline/context';
import { useLeads } from '@/hooks/useLeads';
import { 
  Mail, 
  CheckCircle, 
  Clock, 
  ArrowRight,
  Users,
  Building,
  Phone,
  Globe,
  Sparkles,
  AlertTriangle
} from 'lucide-react';
import { cn } from '@/lib/utils';

export function EnrichmentStage() {
  const { state, markStageComplete, progressToNextStage, setEnrichedLeads } = usePipeline();
  const { leads: searchLeads, isLoading } = useLeads(state.searchId!);
  
  // Use leads from context (for uploads) or from search
  const leads = useMemo(() => {
    return state.leads.length > 0 ? state.leads : (searchLeads || []);
  }, [state.leads, searchLeads]);
  
  const enrichedCount = leads.filter(lead => lead.email).length;
  const enrichmentProgress = leads.length > 0 ? (enrichedCount / leads.length) * 100 : 0;
  
  // Auto-advance when enrichment is complete
  useEffect(() => {
    if (leads.length > 0 && enrichmentProgress === 100 && !state.completedStages.includes('enrichment')) {
      setEnrichedLeads(leads);
      markStageComplete('enrichment');
    }
  }, [leads, enrichmentProgress, state.completedStages, setEnrichedLeads, markStageComplete]);

  const handleContinue = () => {
    progressToNextStage();
  };

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <Clock className="h-8 w-8 animate-spin mx-auto text-primary mb-4" />
        <p className="text-muted-foreground">Loading leads...</p>
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          No leads found. Please go back and adjust your search parameters.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="text-center space-y-2">
        <h3 className="text-xl font-semibold flex items-center justify-center gap-2">
          <Mail className="h-5 w-5" />
          Enriching Lead Data
        </h3>
        <p className="text-muted-foreground">
          Finding contact emails and additional information for your leads
        </p>
      </div>

      {/* Progress Overview */}
      <Card className="glass-card">
        <CardContent className="p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h4 className="font-semibold">Enrichment Progress</h4>
                <p className="text-sm text-muted-foreground">
                  {enrichedCount} of {leads.length} leads enriched
                </p>
              </div>
              
              <Badge variant={enrichmentProgress === 100 ? "default" : "secondary"}>
                {enrichmentProgress.toFixed(0)}% Complete
              </Badge>
            </div>
            
            <Progress 
              value={enrichmentProgress} 
              className="h-3 progress-pulse"
            />
            
            {enrichmentProgress === 100 && (
              <div className="flex items-center justify-center gap-2 text-green-600">
                <CheckCircle className="h-5 w-5" />
                <span className="font-medium">Enrichment Complete!</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Enrichment Stats */}
      <div className="grid md:grid-cols-4 gap-4">
        <Card className="glass-card">
          <CardContent className="p-4 text-center">
            <Building className="h-6 w-6 mx-auto mb-2 text-primary" />
            <div className="text-2xl font-bold">{leads.length}</div>
            <div className="text-sm text-muted-foreground">Total Leads</div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-4 text-center">
            <Mail className="h-6 w-6 mx-auto mb-2 text-green-500" />
            <div className="text-2xl font-bold">{enrichedCount}</div>
            <div className="text-sm text-muted-foreground">Emails Found</div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-4 text-center">
            <Phone className="h-6 w-6 mx-auto mb-2 text-blue-500" />
            <div className="text-2xl font-bold">
              {leads.filter(lead => lead.phone).length}
            </div>
            <div className="text-sm text-muted-foreground">Phone Numbers</div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-4 text-center">
            <Globe className="h-6 w-6 mx-auto mb-2 text-purple-500" />
            <div className="text-2xl font-bold">
              {leads.filter(lead => lead.website).length}
            </div>
            <div className="text-sm text-muted-foreground">Websites</div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Enriched Leads Preview */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">Recently Enriched Leads</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {leads.filter(lead => lead.email).slice(0, 5).map((lead, index) => (
              <div 
                key={lead.id} 
                className="flex items-center gap-4 p-3 rounded-lg bg-muted/10 transition-all duration-300 hover:bg-muted/20"
              >
                <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{lead.company_name}</div>
                  <div className="text-sm text-muted-foreground">{lead.email}</div>
                </div>
                
                <div className="flex gap-1">
                  {lead.phone && (
                    <Badge variant="outline" className="text-xs">
                      <Phone className="h-3 w-3 mr-1" />
                      Phone
                    </Badge>
                  )}
                  {lead.website && (
                    <Badge variant="outline" className="text-xs">
                      <Globe className="h-3 w-3 mr-1" />
                      Website
                    </Badge>
                  )}
                </div>
              </div>
            ))}
            
            {enrichedCount === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <Clock className="h-8 w-8 mx-auto mb-3 animate-pulse text-primary" />
                <p>Enriching lead data...</p>
                <p className="text-sm">This may take a few minutes</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Continue Button */}
      {enrichmentProgress === 100 && (
        <div className="text-center">
          <Button
            onClick={handleContinue}
            size="lg"
            className="min-w-48"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            Continue to AI Analysis
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      )}
    </div>
  );
}