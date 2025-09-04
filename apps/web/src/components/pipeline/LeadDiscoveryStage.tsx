import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { usePipeline } from '@/pipeline/context';
import { SourceRegistry } from '@/pipeline/sources/SourceRegistry';
import { FileUploadArea } from './FileUploadArea';
import { useSearches, useGoogleMapsSearch } from '@/hooks/useSearches';
import { 
  Search, 
  MapPin, 
  Building, 
  Users, 
  ArrowRight,
  Sparkles,
  CreditCard,
  AlertTriangle,
  Upload,
  FileText,
  Mail
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface LeadDiscoveryStageProps {
  userCredits: number;
  userPlan: 'free' | 'pro' | 'enterprise';
}

export function LeadDiscoveryStage({ userCredits, userPlan }: LeadDiscoveryStageProps) {
  const { state, setSearchId, setLeads, markStageComplete, progressToNextStage, setProcessing } = usePipeline();
  const { createSearch } = useSearches();
  const { searchGoogleMaps } = useGoogleMapsSearch();
  const { toast } = useToast();

  // Google Maps form state
  const [location, setLocation] = useState('');
  const [industry, setIndustry] = useState('');
  const [leadsCount, setLeadsCount] = useState([50]);
  const [radius, setRadius] = useState([25]);
  const [employeeRange, setEmployeeRange] = useState([10, 1000]);
  const [includeEmails, setIncludeEmails] = useState(true);
  const [aiAnalysis, setAiAnalysis] = useState(true);

  // Upload form state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});

  const selectedSource = SourceRegistry.getSource(state.selectedSource!);
  
  const validateAndEstimateCost = () => {
    if (!selectedSource) return { isValid: false, estimatedCost: 0 };

    if (state.selectedSource === 'google_maps') {
      const params = {
        location,
        industry,
        leadsCount: leadsCount[0],
        radius: radius[0],
        minEmployees: employeeRange[0],
        maxEmployees: employeeRange[1],
        includeEmails,
        aiAnalysis,
      };
      return selectedSource.validate(params);
    } else if (state.selectedSource === 'csv_upload') {
      const params = {
        file: uploadFile,
        columns: columnMapping,
      };
      return selectedSource.validate(params);
    }

    return { isValid: false, estimatedCost: 0 };
  };

  const validation = validateAndEstimateCost();

  const handleStartDiscovery = async () => {
    if (!validation.isValid) return;

    setProcessing(true);

    try {
      if (state.selectedSource === 'google_maps') {
        // Create search using existing Convex integration with auto-start
        const searchResult = await createSearch({
          name: `${industry} in ${location}`,
          parameters: {
            location,
            maxResults: leadsCount[0],
            radius: radius[0],
            keywords: [industry],
            filters: {
              minEmployees: employeeRange[0],
              maxEmployees: employeeRange[1],
            }
          },
          autoStart: true // This will trigger the orchestrator automatically
        });
        
        if (searchResult) {
          setSearchId(searchResult.searchId);
          markStageComplete('lead_discovery');
          
          toast({
            title: "Search Started",
            description: `Discovering ${leadsCount[0]} leads in ${location}...`,
          });
          
          // Auto-progress after a short delay for visual feedback
          setTimeout(() => {
            progressToNextStage();
          }, 1000);
        }
      } else if (state.selectedSource === 'csv_upload' && uploadFile) {
        // Handle CSV upload
        const leads = await selectedSource!.fetch({ file: uploadFile, columns: columnMapping });
        setLeads(leads);
        markStageComplete('lead_discovery');
        
        toast({
          title: "Leads Imported",
          description: `Successfully imported ${leads.length} leads from CSV.`,
        });
        
        setTimeout(() => {
          progressToNextStage();
        }, 1000);
      }
    } catch (error) {
      toast({
        title: "Discovery Failed",
        description: "Failed to start lead discovery. Please try again.",
        variant: "destructive",
      });
    } finally {
      setProcessing(false);
    }
  };

  if (!selectedSource) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Please select a data source first.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="text-center space-y-2">
        <h3 className="text-xl font-semibold flex items-center justify-center gap-2">
          <selectedSource.icon className="h-5 w-5" />
          {selectedSource.name} Discovery
        </h3>
        <p className="text-muted-foreground">
          {selectedSource.description}
        </p>
      </div>

      {/* Source-specific form */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">Configure Your Search</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {state.selectedSource === 'google_maps' && (
            <>
              {/* Location & Industry */}
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Location
                  </Label>
                  <Input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="e.g., San Francisco, Austin TX, 90210"
                    className="transition-neo"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Building className="h-4 w-4" />
                    Business Type
                  </Label>
                  <Input
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    placeholder="e.g., SaaS companies, Marketing agencies"
                    className="transition-neo"
                  />
                </div>
              </div>

              {/* Advanced Options */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Number of Leads: {leadsCount[0]}</Label>
                  <Slider
                    value={leadsCount}
                    onValueChange={setLeadsCount}
                    max={500}
                    min={10}
                    step={10}
                    className="transition-neo"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>10</span>
                    <span>500</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Search Radius: {radius[0]} miles</Label>
                  <Slider
                    value={radius}
                    onValueChange={setRadius}
                    max={100}
                    min={1}
                    step={5}
                    className="transition-neo"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>1 mile</span>
                    <span>100 miles</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Employee Count: {employeeRange[0]} - {employeeRange[1]}</Label>
                  <Slider
                    value={employeeRange}
                    onValueChange={setEmployeeRange}
                    max={10000}
                    min={1}
                    step={10}
                    className="transition-neo"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>1</span>
                    <span>10,000+</span>
                  </div>
                </div>
              </div>

              {/* Processing Options */}
              <div className="space-y-4 p-4 rounded-lg bg-muted/20">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label className="flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      Email Enrichment
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Find contact emails for discovered leads
                    </p>
                  </div>
                  <Switch
                    checked={includeEmails}
                    onCheckedChange={setIncludeEmails}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4" />
                      AI Analysis
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Analyze leads for relevance and pain points
                    </p>
                  </div>
                  <Switch
                    checked={aiAnalysis}
                    onCheckedChange={setAiAnalysis}
                  />
                </div>
              </div>
            </>
          )}

          {state.selectedSource === 'csv_upload' && (
            <FileUploadArea 
              onFileSelect={setUploadFile}
              onColumnMapping={setColumnMapping}
              selectedFile={uploadFile}
              columnMapping={columnMapping}
            />
          )}
        </CardContent>
      </Card>

      {/* Validation & Cost */}
      {validation.errors.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-1">
              {validation.errors.map((error, index) => (
                <div key={index}>{error}</div>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {validation.warnings.length > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-1">
              {validation.warnings.map((warning, index) => (
                <div key={index}>{warning}</div>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Cost Summary & Action */}
      <Card className="glass-card">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4" />
                <span className="font-medium">Estimated Cost</span>
                {validation.estimatedCost && (
                  <Badge variant="secondary">
                    {validation.estimatedCost} credits
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                You have {userCredits} credits available
              </p>
            </div>

            <Button
              onClick={handleStartDiscovery}
              disabled={!validation.isValid || state.isProcessing || (validation.estimatedCost || 0) > userCredits}
              className="min-w-40"
              size="lg"
            >
              {state.isProcessing ? (
                <>
                  <Search className="h-4 w-4 mr-2 animate-spin" />
                  Discovering...
                </>
              ) : (
                <>
                  <Search className="h-4 w-4 mr-2" />
                  Start Discovery
                  <ArrowRight className="h-4 w-4 ml-2" />
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}