import React, { useMemo, useState } from "react";
import { useAuth as useClerkAuth } from "@clerk/clerk-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { usePipeline } from "@/pipeline/context";
// types not needed directly here; export uses backend
import { useQuery, useMutation } from "convex/react";
import { api } from "@genni/convex-types";
import {
  Download,
  FileText,
  Mail,
  CheckCircle,
  BarChart3,
  Calendar,
  Share,
  RefreshCw,
  Sparkles,
  Archive,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/hooks/useUser";

const EXPORT_FORMATS = [
  {
    type: "csv",
    name: "CSV Export",
    description: "Spreadsheet-friendly format for CRM import",
    icon: FileText,
    includeEmails: true,
    size: "Small",
  },
];

export function ReviewExportStage() {
  const { state, resetPipeline } = usePipeline();
  const { user } = useUser();
  const { getToken: getClerkToken } = useClerkAuth();
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [exportedFormats, setExportedFormats] = useState<string[]>([]);

  const handleExport = async (format: string) => {
    setIsExporting(true);

    try {
      if (format !== "csv") {
        throw new Error("Only CSV export is supported at this time");
      }

      if (!user?._id) throw new Error("Not authenticated");

      // Build Convex HTTP base URL (same logic as SSE)
      const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
      if (!convexUrl) throw new Error("Convex URL not configured");

      let baseUrl: string = convexUrl;
      try {
        const url = new URL(convexUrl);
        if (url.hostname.endsWith(".convex.cloud")) {
          baseUrl = convexUrl.replace(".convex.cloud", ".convex.site");
        }
      } catch {
        // use as-is
      }

      if (!getClerkToken) {
        throw new Error("Unable to access session token");
      }

      const authToken =
        (await getClerkToken({ template: "convex" })) ||
        (await getClerkToken());
      if (!authToken) {
        throw new Error("Unable to obtain session token");
      }

      const tokenResponse = await fetch(`${baseUrl}/api/exports/issue-token`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (!tokenResponse.ok) {
        throw new Error("Failed to request export token");
      }

      const tokenBody = (await tokenResponse.json()) as { token?: string };
      if (!tokenBody?.token) {
        throw new Error("Invalid export token response");
      }

      const params = new URLSearchParams();
      params.set("userId", user._id);
      params.set("token", tokenBody.token);
      if (state.searchId) params.set("searchId", state.searchId);

      const exportUrl = `${baseUrl}/api/exports/leads.csv?${params.toString()}`;

      const res = await fetch(exportUrl, { method: "GET" });

      if (!res.ok) {
        throw new Error("Export failed");
      }

      // Create download
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `leads-export-${Date.now()}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      setExportedFormats((prev) => [...prev, format]);

      toast({
        title: "Export Complete",
        description: `Successfully exported your leads as ${format.toUpperCase()}.`,
      });
    } catch (error) {
      console.error("Export error:", error);
      toast({
        title: "Export Failed",
        description: "Failed to export data. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleStartNewPipeline = () => {
    resetPipeline();
    toast({
      title: "New Pipeline Started",
      description: "Ready to discover new leads!",
    });
  };

  const totalLeads = state.leads.length;
  const enrichedLeads = state.enrichedLeads.length;
  const generatedEmails = state.generatedEmails.length;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="text-center space-y-2">
        <h3 className="text-xl font-semibold flex items-center justify-center gap-2">
          <CheckCircle className="h-5 w-5 text-green-500" />
          Pipeline Complete!
        </h3>
        <p className="text-muted-foreground">
          Review your results and export your leads and personalized emails
        </p>
      </div>

      {/* Results Summary */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">Campaign Results Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-4 gap-6">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 mx-auto rounded-full bg-blue-500/20 flex items-center justify-center">
                <BarChart3 className="h-6 w-6 text-blue-500" />
              </div>
              <div className="text-2xl font-bold">{totalLeads}</div>
              <div className="text-sm text-muted-foreground">
                Leads Discovered
              </div>
            </div>

            <div className="text-center space-y-2">
              <div className="w-12 h-12 mx-auto rounded-full bg-green-500/20 flex items-center justify-center">
                <Mail className="h-6 w-6 text-green-500" />
              </div>
              <div className="text-2xl font-bold">{enrichedLeads}</div>
              <div className="text-sm text-muted-foreground">
                Enriched with Emails
              </div>
            </div>

            <div className="text-center space-y-2">
              <div className="w-12 h-12 mx-auto rounded-full bg-purple-500/20 flex items-center justify-center">
                <Sparkles className="h-6 w-6 text-purple-500" />
              </div>
              <div className="text-2xl font-bold">{generatedEmails}</div>
              <div className="text-sm text-muted-foreground">
                Personalized Emails
              </div>
            </div>

            <div className="text-center space-y-2">
              <div className="w-12 h-12 mx-auto rounded-full bg-orange-500/20 flex items-center justify-center">
                <BarChart3 className="h-6 w-6 text-orange-500" />
              </div>
              <div className="text-2xl font-bold">
                {((enrichedLeads / totalLeads) * 100).toFixed(0)}%
              </div>
              <div className="text-sm text-muted-foreground">
                Enrichment Rate
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Export Options */}
      <Tabs defaultValue="export" className="w-full">
        <TabsList className="grid w-full grid-cols-3 glass-card">
          <TabsTrigger value="export">Export Data</TabsTrigger>
          <TabsTrigger value="send">Send Emails</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="export" className="space-y-4">
          <div className="grid md:grid-cols-3 gap-4">
            {EXPORT_FORMATS.map((format) => {
              const IconComponent = format.icon;
              const isExported = exportedFormats.includes(format.type);

              return (
                <Card
                  key={format.type}
                  className={cn(
                    "glass-card transition-all duration-300 hover-lift",
                    isExported && "border-green-500/50 bg-green-500/5",
                  )}
                >
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "p-2 rounded-lg transition-colors",
                          isExported ? "bg-green-500/20" : "bg-muted/20",
                        )}
                      >
                        <IconComponent
                          className={cn(
                            "h-5 w-5",
                            isExported
                              ? "text-green-500"
                              : "text-muted-foreground",
                          )}
                        />
                      </div>
                      <div className="flex-1">
                        <CardTitle className="text-base">
                          {format.name}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">
                          {format.description}
                        </p>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <span>File Size:</span>
                        <Badge variant="outline">{format.size}</Badge>
                      </div>

                      <div className="flex items-center justify-between text-xs">
                        <span>Includes Emails:</span>
                        <Badge
                          variant={
                            format.includeEmails ? "default" : "secondary"
                          }
                        >
                          {format.includeEmails ? "Yes" : "No"}
                        </Badge>
                      </div>

                      <Button
                        onClick={() => handleExport(format.type)}
                        disabled={isExporting || isExported}
                        className="w-full"
                        variant={isExported ? "secondary" : "default"}
                      >
                        {isExported ? (
                          <>
                            <CheckCircle className="h-3 w-3 mr-2" />
                            Downloaded
                          </>
                        ) : (
                          <>
                            <Download className="h-3 w-3 mr-2" />
                            Export {format.type.toUpperCase()}
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="send" className="space-y-4">
          <Card className="glass-card">
            <CardContent className="p-8 text-center space-y-4">
              <div className="w-16 h-16 mx-auto rounded-full bg-muted/20 flex items-center justify-center">
                <Mail className="h-8 w-8 text-muted-foreground" />
              </div>

              <div className="space-y-2">
                <h4 className="text-lg font-semibold">Email Sending</h4>
                <p className="text-muted-foreground">
                  Email campaign functionality coming soon! For now, export your
                  emails and send through your preferred platform.
                </p>
              </div>

              <Alert>
                <Calendar className="h-4 w-4" />
                <AlertDescription>
                  Connect your email provider to send campaigns directly from
                  Genni. This feature will be available in the next update.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg">Campaign Analytics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h5 className="font-medium">Quality Metrics</h5>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-sm">Enrichment Success Rate</span>
                      <span className="font-medium">
                        {((enrichedLeads / totalLeads) * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm">Avg Relevance Score</span>
                      <span className="font-medium">8.7/10</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm">Estimated Response Rate</span>
                      <span className="font-medium text-green-600">24.3%</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h5 className="font-medium">Next Steps</h5>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <div>• Export your leads and emails</div>
                    <div>• Import to your CRM or email platform</div>
                    <div>• Schedule your email sequences</div>
                    <div>• Track response rates and optimize</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Actions */}
      <div className="flex items-center justify-center gap-4">
        <Button onClick={handleStartNewPipeline} variant="outline" size="lg">
          <RefreshCw className="h-4 w-4 mr-2" />
          Start New Pipeline
        </Button>

        <Button
          onClick={() => handleExport("csv")}
          disabled={exportedFormats.includes("csv")}
          size="lg"
          className="min-w-48"
        >
          <Download className="h-4 w-4 mr-2" />
          Quick CSV Export
        </Button>
      </div>
    </div>
  );
}
