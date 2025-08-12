import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { 
  Bot, 
  Send, 
  Copy, 
  Download, 
  CheckCircle, 
  Clock, 
  AlertCircle,
  Sparkles,
  Target,
  MessageSquare,
  TrendingUp
} from "lucide-react";
import { 
  type Lead, 
  type EmailGenerationResult,
  type EmailGenerationResponse 
} from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";
import { useEmailGeneration, useCrewAIRequest } from "@/hooks/useCrewAI";
import { useProfile } from "@/hooks/useProfile";
import type { Id } from "@genni/convex-types/dataModel";

interface AIEmailGeneratorProps {
  selectedLead?: Lead;
  onEmailGenerated?: (result: EmailGenerationResult) => void;
}

export function AIEmailGenerator({ selectedLead, onEmailGenerated }: AIEmailGeneratorProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationResult, setGenerationResult] = useState<EmailGenerationResult | null>(null);
  const [currentTab, setCurrentTab] = useState("compose");
  const [currentRequestId, setCurrentRequestId] = useState<string | undefined>(undefined);
  const [emailRequirements, setEmailRequirements] = useState({
    tone: 'professional' as const,
    length: 'medium' as const,
    call_to_action: 'Schedule a 15-minute discovery call',
    include_case_study: true,
    personalization_level: 'high' as const,
    follow_up_sequence: false
  });
  
  const { toast } = useToast();
  
  // Real Convex hooks
  const { generateEmail } = useEmailGeneration();
  const { profile } = useProfile();
  const { request } = useCrewAIRequest(currentRequestId);

  // Watch for request completion
  useEffect(() => {
    if (request && request.status === 'completed' && isGenerating) {
      setIsGenerating(false);
      
      // Convert CrewAI result to the expected format
      if (request.result) {
        const result: EmailGenerationResult = {
          request_id: request._id,
          lead_analysis: {
            company_analysis: request.result.lead_analysis || 'Analysis completed',
            industry_insights: request.result.industry_insights || 'Industry analysis completed',
            qualification_factors: request.result.qualification_factors || []
          },
          relevance_score: request.result.relevance_score || 0.85,
          pain_points_identified: request.result.pain_points || [],
          value_matches: request.result.value_matches || [],
          primary_email: {
            subject: request.result.subject || 'Partnership Opportunity',
            body: request.result.email_body || request.result.body || 'Email content generated',
            personalization_notes: request.result.personalization_notes || [],
            estimated_effectiveness: request.result.effectiveness_score || 0.85
          },
          agent_results: request.result.agent_results || [],
          processing_time: request.result.processing_time || 0,
          recommendations: request.result.recommendations || []
        };
        
        setGenerationResult(result);
        onEmailGenerated?.(result);
        
        toast({
          title: "Email Generated Successfully!",
          description: `High-quality personalized email created with ${Math.round((result.relevance_score || 0.85) * 100)}% relevance score.`,
        });
      }
    } else if (request && request.status === 'failed' && isGenerating) {
      setIsGenerating(false);
      toast({
        title: "Generation Failed",
        description: request.error || "Failed to generate email. Please try again.",
        variant: "destructive",
      });
    }
  }, [request, isGenerating, onEmailGenerated, toast]);

  // Mock lead for demo if none selected
  const demoLead: Lead = {
    id: 'demo_lead_1',
    company_name: 'TechFlow Solutions',
    contact_name: 'Sarah Johnson',
    title: 'VP of Marketing',
    industry: 'SaaS',
    company_size: '50-200 employees',
    location: 'San Francisco, CA',
    description: 'Cloud-based project management and collaboration platform for distributed teams',
    website: 'https://techflowsolutions.com',
    contact_info: {
      email: 'sarah.johnson@techflowsolutions.com',
      linkedin: 'https://linkedin.com/in/sarahjohnson-marketing'
    },
    status: 'new',
    technologies: ['React', 'Node.js', 'AWS', 'MongoDB'],
    pain_points: ['Lead generation scalability', 'Email personalization at scale']
  };

  const targetLead = selectedLead || demoLead;

  const handleGenerateEmail = async () => {
    if (!profile) {
      toast({
        title: "Profile Required",
        description: "Please complete your business profile before generating emails.",
        variant: "destructive",
      });
      return;
    }

    if (!selectedLead) {
      toast({
        title: "Lead Required",
        description: "Please select a lead to generate an email for.",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    setCurrentTab("result");
    
    try {
      // Convert selectedLead to the ID format needed by Convex
      const leadId = selectedLead.id as Id<"leads">;
      
      const result = await generateEmail({
        leadId,
        requirements: {
          tone: emailRequirements.tone,
          length: emailRequirements.length,
          callToAction: emailRequirements.call_to_action,
          includeCaseStudy: emailRequirements.include_case_study,
          personalizationLevel: emailRequirements.personalization_level,
          followUpSequence: emailRequirements.follow_up_sequence,
        },
      });
      
      if (result.requestId) {
        setCurrentRequestId(result.requestId);
        toast({
          title: "AI Email Generation Started",
          description: `Request ${result.requestId} is being processed by our 5-agent system.`,
        });
      }
      
    } catch (error) {
      console.error('Email generation failed:', error);
      toast({
        title: "Generation Failed",
        description: "Failed to generate email. Please try again.",
        variant: "destructive",
      });
      setIsGenerating(false);
    }
  };


  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied to clipboard",
      description: "Email content has been copied to your clipboard.",
    });
  };

  return (
    <div className="space-y-6">
      {/* Lead Context Card */}
      <Card className="p-6 bg-gradient-to-r from-primary/5 to-purple-500/5 border-primary/20">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Target Lead</h3>
            <div className="space-y-1 text-sm">
              <div><span className="font-medium">{targetLead.company_name}</span> • {targetLead.industry}</div>
              <div>{targetLead.contact_name} • {targetLead.title}</div>
              <div className="text-muted-foreground">{targetLead.location} • {targetLead.company_size}</div>
            </div>
          </div>
          <Badge variant="secondary" className="bg-primary/10 text-primary">
            {targetLead.status}
          </Badge>
        </div>
      </Card>

      <Tabs value={currentTab} onValueChange={setCurrentTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="compose" className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            AI Compose
          </TabsTrigger>
          <TabsTrigger value="result" className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Generated Email
          </TabsTrigger>
          <TabsTrigger value="analysis" className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            AI Analysis
          </TabsTrigger>
        </TabsList>

        <TabsContent value="compose" className="space-y-6">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Email Generation Settings</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Tone</label>
                <Select value={emailRequirements.tone} onValueChange={(value: string) => 
                  setEmailRequirements(prev => ({ ...prev, tone: value }))
                }>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="professional">Professional</SelectItem>
                    <SelectItem value="casual">Casual</SelectItem>
                    <SelectItem value="friendly">Friendly</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Length</label>
                <Select value={emailRequirements.length} onValueChange={(value: string) => 
                  setEmailRequirements(prev => ({ ...prev, length: value }))
                }>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="short">Short (100-150 words)</SelectItem>
                    <SelectItem value="medium">Medium (150-250 words)</SelectItem>
                    <SelectItem value="long">Long (250+ words)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Personalization Level</label>
                <Select value={emailRequirements.personalizationLevel} onValueChange={(value: string) => 
                  setEmailRequirements(prev => ({ ...prev, personalizationLevel: value }))
                }>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="case-study"
                  checked={emailRequirements.include_case_study}
                  onChange={(e) => setEmailRequirements(prev => ({ 
                    ...prev, 
                    include_case_study: e.target.checked 
                  }))}
                  className="h-4 w-4 rounded border-border"
                />
                <label htmlFor="case-study" className="text-sm font-medium">
                  Include case study
                </label>
              </div>
            </div>

            <div className="mt-4">
              <label className="text-sm font-medium mb-2 block">Call to Action</label>
              <Input
                value={emailRequirements.call_to_action}
                onChange={(e) => setEmailRequirements(prev => ({ 
                  ...prev, 
                  call_to_action: e.target.value 
                }))}
                placeholder="What action do you want them to take?"
              />
            </div>

            <Button 
              className="w-full mt-6 bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90"
              onClick={handleGenerateEmail}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <>
                  <Clock className="h-4 w-4 mr-2 animate-spin" />
                  AI Agents Working...
                </>
              ) : (
                <>
                  <Bot className="h-4 w-4 mr-2" />
                  Generate Personalized Email
                </>
              )}
            </Button>
          </Card>
        </TabsContent>

        <TabsContent value="result" className="space-y-6">
          {isGenerating ? (
            <Card className="p-6">
              <div className="text-center space-y-4">
                <div className="flex justify-center">
                  <Bot className="h-12 w-12 text-primary animate-pulse" />
                </div>
                <h3 className="text-lg font-semibold">AI Agents Processing...</h3>
                {request ? (
                  <>
                    <p className="text-muted-foreground">
                      Status: {request.status} {request.currentStage && `• Current: ${request.currentStage}`}
                    </p>
                    <Progress value={request.progress || 0} className="w-full" />
                    {request.statusMessage && (
                      <p className="text-sm text-muted-foreground">{request.statusMessage}</p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-muted-foreground">
                      Our 5-agent system is analyzing your lead and crafting the perfect personalized email.
                    </p>
                    <Progress value={15} className="w-full" />
                  </>
                )}
              </div>
            </Card>
          ) : generationResult ? (
            <div className="space-y-4">
              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Generated Email</h3>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(generationResult.primary_email.body)}
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      Copy
                    </Button>
                    <Button variant="outline" size="sm">
                      <Send className="h-4 w-4 mr-2" />
                      Send
                    </Button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Subject Line</label>
                    <div className="mt-1 p-3 bg-muted/50 rounded-md font-medium">
                      {generationResult.primary_email.subject}
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Email Body</label>
                    <div className="mt-1 p-4 bg-muted/50 rounded-md whitespace-pre-line text-sm">
                      {generationResult.primary_email.body}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <Target className="h-4 w-4 text-green-500" />
                      <span>Relevance: {(generationResult.relevance_score * 100).toFixed(0)}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-blue-500" />
                      <span>Effectiveness: {(generationResult.primary_email.estimated_effectiveness * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                </div>
              </Card>

              <Card className="p-4">
                <h4 className="text-sm font-semibold mb-3">Personalization Elements</h4>
                <div className="flex flex-wrap gap-2">
                  {generationResult.primary_email.personalization_notes.map((note, index) => (
                    <Badge key={index} variant="secondary" className="text-xs">
                      {note}
                    </Badge>
                  ))}
                </div>
              </Card>
            </div>
          ) : (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Generate an email first to see the results here.
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>

        <TabsContent value="analysis" className="space-y-6">
          {generationResult ? (
            <div className="space-y-4">
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">AI Agent Analysis</h3>
                <div className="space-y-4">
                  {generationResult.agent_results.map((agent, index) => (
                    <div key={index} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-medium">{agent.agent_name}</h4>
                        <Badge variant="outline">
                          {(agent.confidence_score * 100).toFixed(0)}% confidence
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">{agent.role}</p>
                      <p className="text-sm">{agent.output}</p>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">Strategic Recommendations</h3>
                <ul className="space-y-2">
                  {generationResult.recommendations.map((rec, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm">
                      <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                      {rec}
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          ) : (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Generate an email first to see the AI analysis here.
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}