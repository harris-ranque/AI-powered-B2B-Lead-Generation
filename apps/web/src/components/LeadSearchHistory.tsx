import { useMemo, useState } from "react";
import { useAuth as useClerkAuth } from "@clerk/clerk-react";
import type { Doc } from "@genni/convex-types/dataModel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useSearches } from "@/hooks/useSearches";
import { useAuth } from "@/hooks/useAuth";
import { Calendar, MapPin, Download, Loader2 } from "lucide-react";

export function LeadSearchHistory() {
  const { searches, isLoading } = useSearches();
  const { user } = useAuth();
  const { getToken: getClerkToken } = useClerkAuth();
  const { toast } = useToast();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const items = useMemo<Doc<"searches">[]>(() => searches ?? [], [searches]);

  const formatStatus = (status: string) => {
    return status
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  };

  const startCsvDownload = async (searchId: string) => {
    try {
      if (!user?._id) throw new Error("Not authenticated");

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
      params.set("searchId", searchId);

      const exportUrl = `${baseUrl}/api/exports/leads.csv?${params.toString()}`;

      setDownloadingId(searchId);
      const res = await fetch(exportUrl, { method: "GET" });
      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `leads-export-${searchId}-${Date.now()}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast({ title: "Export Complete", description: "CSV download started." });
    } catch (err) {
      console.error("CSV export error", err);
      toast({
        title: "Export Failed",
        description: "Could not download CSV. Please try again.",
        variant: "destructive",
      });
    } finally {
      setDownloadingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading search history...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          No searches yet. Run a new lead search to see history here.
        </Card>
      ) : (
        items.map((s: Doc<"searches">) => (
          <Card key={String(s._id)} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="text-base font-medium">
                    {s.name || "Lead Search"}
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {formatStatus(s.status)}
                  </Badge>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>
                      {s.createdAt
                        ? new Date(s.createdAt).toLocaleString()
                        : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5" />
                    <span>
                      {s.parameters?.location || "—"}
                      {s.parameters?.keywords?.length
                        ? ` • ${s.parameters.keywords.join(", ")}`
                        : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">
                      {s.results?.totalFound ?? 0}
                    </span>
                    <span>leads found</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => startCsvDownload(String(s._id))}
                  disabled={
                    downloadingId === String(s._id) ||
                    s.status !== "completed" ||
                    (s.results?.totalFound ?? 0) === 0
                  }
                >
                  {downloadingId === String(s._id) ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Preparing...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-2" />
                      Export CSV
                    </>
                  )}
                </Button>
              </div>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
