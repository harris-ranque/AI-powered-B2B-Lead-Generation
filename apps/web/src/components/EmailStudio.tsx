import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@genni/convex-types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, Send, Edit, Copy, Trash2, Plus, Sparkles } from "lucide-react";
import type { EmailGenerationResult } from "@/lib/api-client";

export function EmailStudio() {
  const [aiGeneratedEmails, setAiGeneratedEmails] = useState<
    EmailGenerationResult[]
  >([]);

  const user = useQuery(api.users.queries.getCurrentUserData);
  const keyStatus = useQuery(api.userApiKeys.queries.getApiKeyStatus);

  const enterprisePlan = user?.plan === "enterprise";
  const usingOpenAiKey =
    enterprisePlan && Boolean(keyStatus?.configuredProviders?.includes("openai"));
  const providerBadges = (keyStatus?.configuredProviders as string[] | undefined)?.filter(
    (provider) => ["openai", "tavily", "perplexity", "google_places"].includes(provider),
  );

  const handleEmailGenerated = (result: EmailGenerationResult) => {
    setAiGeneratedEmails((prev) => [result, ...prev]);
  };

  const templates = [
    {
      id: 1,
      name: "Partnership Outreach",
      subject: "Partnership opportunity with {{company}}",
      openRate: "-", // TODO: Connect to real template performance data
      responseRate: "-",
      category: "Partnership",
    },
    {
      id: 2,
      name: "SaaS Introduction",
      subject: "Quick question about {{company}}'s workflow",
      openRate: "-", // TODO: Connect to real template performance data
      responseRate: "-",
      category: "Sales",
    },
    {
      id: 3,
      name: "Follow Up",
      subject: "Following up on our conversation",
      openRate: "-", // TODO: Connect to real template performance data
      responseRate: "-",
      category: "Follow-up",
    },
  ];

  return (
    <div className="flex h-screen">
      <div className="flex-1 p-8">
        <div className="max-w-6xl">
          <div className="mb-8">
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-4xl font-bold text-foreground mb-2">
                  Email Studio
                </h1>
                <p className="text-muted-foreground">
                  AI-powered email creation and template management for lead
                  outreach.
                </p>
                {user && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge
                      variant={usingOpenAiKey ? "secondary" : "outline"}
                      className={
                        usingOpenAiKey
                          ? "bg-emerald-500/20 text-emerald-600"
                          : "text-muted-foreground"
                      }
                    >
                      {usingOpenAiKey
                        ? "Using your OpenAI key"
                        : enterprisePlan
                          ? "OpenAI key required"
                          : "Using Genni's OpenAI key"}
                    </Badge>
                    {enterprisePlan && providerBadges?.length ? (
                      providerBadges
                        .filter((provider) => provider !== "openai")
                        .map((provider) => (
                          <Badge key={provider} variant="outline">
                            {`BYOK: ${provider.replace("_", " ")}`}
                          </Badge>
                        ))
                    ) : !enterprisePlan ? (
                      <Badge variant="outline">Credits will be applied</Badge>
                    ) : null}
                    {enterprisePlan && !usingOpenAiKey && (
                      <span className="text-xs text-destructive">
                        Add and validate your OpenAI key to start generating emails.
                      </span>
                    )}
                  </div>
                )}
              </div>
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
                <Plus className="h-4 w-4 mr-2" />
                New Template
              </Button>
            </div>
          </div>

          <Tabs defaultValue="templates" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger
                value="templates"
                className="flex items-center gap-2"
              >
                <Mail className="h-4 w-4" />
                Templates
              </TabsTrigger>
              <TabsTrigger
                value="performance"
                className="flex items-center gap-2"
              >
                <Sparkles className="h-4 w-4" />
                Performance
              </TabsTrigger>
            </TabsList>

            <TabsContent value="templates" className="mt-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Template List */}
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-4">
                    Email Templates
                  </h3>
                  <div className="space-y-4">
                    {templates.map((template) => (
                      <Card
                        key={template.id}
                        className="p-4 bg-card border-border hover:border-primary/30 transition-colors cursor-pointer"
                      >
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <h4 className="font-medium text-foreground">
                              {template.name}
                            </h4>
                            <p className="text-sm text-muted-foreground mt-1">
                              {template.subject}
                            </p>
                          </div>
                          <Badge
                            variant="secondary"
                            className="bg-primary/10 text-primary"
                          >
                            {template.category}
                          </Badge>
                        </div>

                        <div className="flex justify-between items-center">
                          <div className="flex gap-4 text-xs text-muted-foreground">
                            <span>Open: {template.openRate}</span>
                            <span>Response: {template.responseRate}</span>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-destructive"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>

                {/* Email Composer */}
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-4">
                    Compose Email
                  </h3>
                  <Card className="p-6 bg-card border-border">
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium text-foreground mb-2 block">
                          Template Name
                        </label>
                        <Input
                          placeholder="Enter template name..."
                          className="bg-input border-border"
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium text-foreground mb-2 block">
                          Subject Line
                        </label>
                        <Input
                          placeholder="Email subject..."
                          className="bg-input border-border"
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium text-foreground mb-2 block">
                          Email Body
                        </label>
                        <Textarea
                          placeholder="Hi {{firstName}},&#10;&#10;I hope this email finds you well..."
                          className="bg-input border-border min-h-[200px]"
                        />
                      </div>

                      <div className="bg-muted/20 p-3 rounded-lg">
                        <h4 className="text-sm font-medium text-foreground mb-2">
                          Available Variables:
                        </h4>
                        <div className="text-xs text-muted-foreground space-y-1">
                          <div>{"{{firstName}}"} - Lead's first name</div>
                          <div>{"{{lastName}}"} - Lead's last name</div>
                          <div>{"{{company}}"} - Company name</div>
                          <div>{"{{position}}"} - Job title</div>
                          <div>{"{{yourName}}"} - Your name</div>
                          <div>{"{{yourCompany}}"} - Your company</div>
                        </div>
                      </div>

                      <div className="flex gap-3">
                        <Button className="bg-primary hover:bg-primary/90 text-primary-foreground flex-1">
                          <Mail className="h-4 w-4 mr-2" />
                          Save Template
                        </Button>
                        <Button variant="outline" className="border-border">
                          <Send className="h-4 w-4 mr-2" />
                          Test Send
                        </Button>
                      </div>
                    </div>
                  </Card>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="performance" className="mt-6">
              {/* AI Generated Emails */}
              {aiGeneratedEmails.length > 0 && (
                <Card className="p-6 mb-6">
                  <h3 className="text-lg font-semibold text-foreground mb-4">
                    Recent AI Generated Emails
                  </h3>
                  <div className="space-y-3">
                    {aiGeneratedEmails.slice(0, 3).map((email, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-3 bg-muted/30 rounded-lg"
                      >
                        <div>
                          <div className="font-medium text-sm">
                            {email.primary_email.subject}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Relevance:{" "}
                            {(email.relevance_score * 100).toFixed(0)}% •
                            Effectiveness:{" "}
                            {(
                              email.primary_email.estimated_effectiveness * 100
                            ).toFixed(0)}
                            %
                          </div>
                        </div>
                        <Badge
                          variant="secondary"
                          className="bg-green-100 text-green-800"
                        >
                          AI Generated
                        </Badge>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Email Performance */}
              <Card className="p-6 bg-card border-border">
                <h3 className="text-lg font-semibold text-foreground mb-4">
                  Email Performance
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-primary">1,247</div>
                    <div className="text-sm text-muted-foreground">
                      Emails Sent
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-primary">34%</div>
                    <div className="text-sm text-muted-foreground">
                      Open Rate
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-primary">12%</div>
                    <div className="text-sm text-muted-foreground">
                      Response Rate
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-primary">2.8%</div>
                    <div className="text-sm text-muted-foreground">
                      Conversion Rate
                    </div>
                  </div>
                </div>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
