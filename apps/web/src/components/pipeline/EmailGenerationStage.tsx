import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePipeline } from "@/pipeline/context";
import type { Lead } from "@/lib/types";
import { useAction } from "convex/react";
import { api } from "@genni/convex-types";
import { useToast } from "@/hooks/use-toast";
import {
  PenTool,
  Mail,
  ArrowRight,
  Sparkles,
  Bot,
  CheckCircle,
  Eye,
  Edit,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface EmailGenerationStageProps {
  onGenerateEmail?: (lead: Lead) => void;
}

export function EmailGenerationStage({
  onGenerateEmail,
}: EmailGenerationStageProps) {
  const { state, setEmails, markStageComplete, progressToNextStage } =
    usePipeline();
  const [selectedLead, setSelectedLead] = useState(
    state.enrichedLeads[0] || null,
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateProgress, setGenerateProgress] = useState(0);
  const { toast } = useToast();

  // Use real LangGraph email generation
  const generateEmailAction = useAction(api.langgraph.actions.generateEmail);

  const handleGenerateEmails = async () => {
    setIsGenerating(true);
    setGenerateProgress(0);

    try {
      const totalLeads = state.enrichedLeads.length;
      // Kick off generation requests for each lead (backend will persist via webhook)
      for (let i = 0; i < state.enrichedLeads.length; i++) {
        const lead = state.enrichedLeads[i];
        try {
          await generateEmailAction({
            leadId: lead.id,
            emailType: "initial",
            customInstructions:
              "Generate a professional, personalized outreach email",
          });
        } catch (leadError) {
          console.error(
            `Failed to start generation for lead ${lead.id}:`,
            leadError,
          );
        }
        setGenerateProgress(Math.round(((i + 1) / totalLeads) * 100));
      }

      markStageComplete("email_generation");
      toast({
        title: "Generation Started",
        description: `Queued ${totalLeads} leads for AI-powered email generation. Results will populate automatically.`,
      });

      setTimeout(() => {
        setIsGenerating(false);
        progressToNextStage();
      }, 800);
    } catch (error) {
      console.error("Email generation failed:", error);
      setIsGenerating(false);
      toast({
        title: "Generation Failed",
        description: "Failed to start email generation. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handlePreviewEmail = (lead: Lead) => {
    setSelectedLead(lead);
    onGenerateEmail?.(lead);
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="text-center space-y-2">
        <h3 className="text-xl font-semibold flex items-center justify-center gap-2">
          <PenTool className="h-5 w-5" />
          Generate Personalized Emails
        </h3>
        <p className="text-muted-foreground">
          Create highly personalized email sequences using AI analysis insights
        </p>
      </div>

      {/* Generation Control */}
      <Card className="glass-card">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <h4 className="font-semibold flex items-center gap-2">
                <Bot className="h-4 w-4" />
                Email Generation
              </h4>
              <p className="text-sm text-muted-foreground">
                Generate personalized emails for {state.enrichedLeads.length}{" "}
                leads with contacts
              </p>
            </div>

            {state.generatedEmails.length === 0 ? (
              <Button
                onClick={handleGenerateEmails}
                disabled={isGenerating}
                size="lg"
                className="min-w-40"
              >
                {isGenerating ? (
                  <>
                    <Sparkles className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <PenTool className="h-4 w-4 mr-2" />
                    Generate All Emails
                  </>
                )}
              </Button>
            ) : (
              <Badge variant="default" className="px-3 py-1">
                <CheckCircle className="h-3 w-3 mr-1" />
                {state.generatedEmails.length} Emails Generated
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Progress or Results */}
      {isGenerating && (
        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="space-y-4 text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-primary/20 flex items-center justify-center animate-neon-pulse">
                <Bot className="h-8 w-8 text-primary" />
              </div>

              <div className="space-y-2">
                <h4 className="font-semibold">AI Agents at Work</h4>
                <p className="text-sm text-muted-foreground">
                  Creating personalized emails based on analysis insights...
                </p>
              </div>

              <div className="grid grid-cols-3 gap-4 max-w-md mx-auto">
                {[
                  "Analyzing pain points",
                  "Matching value props",
                  "Writing personalized copy",
                ].map((step, index) => (
                  <div key={step} className="text-xs text-muted-foreground">
                    <div className="w-2 h-2 rounded-full bg-primary mx-auto mb-1 animate-pulse" />
                    {step}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Generated Emails Preview */}
      {state.generatedEmails.length > 0 && (
        <Tabs defaultValue="preview" className="w-full">
          <TabsList className="grid w-full grid-cols-2 glass-card">
            <TabsTrigger value="preview">Email Preview</TabsTrigger>
            <TabsTrigger value="leads">Lead List</TabsTrigger>
          </TabsList>

          <TabsContent value="preview" className="space-y-4">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-lg">
                  Email Sequences Generated
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {state.generatedEmails.slice(0, 3).map((email, index) => {
                    const lead = state.enrichedLeads.find(
                      (l) => l.id === email.leadId,
                    );
                    return (
                      <div
                        key={index}
                        className="p-4 rounded-lg border border-border bg-muted/5"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="font-medium">
                            {lead?.company_name}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {(email.relevance_score * 100).toFixed(0)}%
                              relevance
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handlePreviewEmail(lead)}
                            >
                              <Eye className="h-3 w-3 mr-1" />
                              Preview
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="text-sm">
                            <span className="font-medium">Subject:</span>{" "}
                            {email.primary_email.subject}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {email.primary_email.body.substring(0, 100)}...
                          </div>
                          <div className="text-xs text-muted-foreground">
                            + {email.follow_up_emails.length} follow-up emails
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="leads" className="space-y-4">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-lg">
                  Leads with Generated Emails
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {state.enrichedLeads.map((lead, index) => (
                    <div
                      key={lead.id}
                      className="flex items-center gap-4 p-3 rounded-lg bg-muted/10 hover:bg-muted/20 transition-all duration-300"
                    >
                      <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{lead.company_name}</div>
                        <div className="text-sm text-muted-foreground">
                          {lead.contactInfo?.emails?.[0]?.email ||
                            "No email available"}
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <Badge variant="outline" className="text-xs">
                          Primary + 2 Follow-ups
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handlePreviewEmail(lead)}
                        >
                          <Eye className="h-3 w-3 mr-1" />
                          View
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* Continue Button */}
      {state.generatedEmails.length > 0 && (
        <div className="text-center">
          <Button onClick={progressToNextStage} size="lg" className="min-w-48">
            <CheckCircle className="h-4 w-4 mr-2" />
            Review & Export Results
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      )}
    </div>
  );
}
