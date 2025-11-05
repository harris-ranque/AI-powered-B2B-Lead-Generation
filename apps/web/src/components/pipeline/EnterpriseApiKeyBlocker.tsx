import { AlertCircle, Key, CheckCircle, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface ApiKeyProvider {
  id: string;
  name: string;
  description: string;
  icon: string;
}

const REQUIRED_PROVIDERS: ApiKeyProvider[] = [
  {
    id: "openai",
    name: "OpenAI",
    description: "Required for LLM workflows and AI analysis",
    icon: "🤖",
  },
  {
    id: "google_places",
    name: "Google Places",
    description: "Required for lead discovery and location data",
    icon: "🗺️",
  },
  {
    id: "findymail",
    name: "FindyMail",
    description: "Required for email enrichment and validation",
    icon: "📧",
  },
  {
    id: "tavily",
    name: "Tavily",
    description: "Required for AI research and web search",
    icon: "🔍",
  },
  {
    id: "exa",
    name: "Exa Semantic Search",
    description: "Required for semantic enrichment and competitive intelligence",
    icon: "🧭",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    description: "Required for deep research and analysis",
    icon: "🧠",
  },
];

interface EnterpriseApiKeyBlockerProps {
  missingProviders: string[];
  onGoToSettings: () => void;
}

export function EnterpriseApiKeyBlocker({
  missingProviders,
  onGoToSettings,
}: EnterpriseApiKeyBlockerProps) {
  const missingDetails = REQUIRED_PROVIDERS.filter((provider) =>
    missingProviders.includes(provider.id)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-lg bg-black/60 animate-in fade-in duration-300">
      <Card className="w-full max-w-2xl mx-4 shadow-2xl border-2 border-red-500/20 bg-gradient-to-br from-background via-background to-red-950/10">
        <CardHeader className="space-y-4 pb-6">
          <div className="flex items-center justify-center">
            <div className="relative">
              <div className="absolute inset-0 bg-red-500/20 rounded-full blur-xl animate-pulse" />
              <div className="relative bg-red-500/10 p-4 rounded-full">
                <AlertCircle className="h-12 w-12 text-red-500" />
              </div>
            </div>
          </div>
          <div className="text-center space-y-2">
            <CardTitle className="text-3xl font-bold bg-gradient-to-r from-red-500 to-orange-500 bg-clip-text text-transparent">
              API Keys Required
            </CardTitle>
            <CardDescription className="text-base">
              Enterprise users must configure their own API keys to use the lead generation pipeline.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Key className="h-4 w-4" />
              <span>Missing API Keys ({missingDetails.length} of {REQUIRED_PROVIDERS.length})</span>
            </div>

            <div className="space-y-2">
              {REQUIRED_PROVIDERS.map((provider) => {
                const isMissing = missingProviders.includes(provider.id);
                return (
                  <div
                    key={provider.id}
                    className={`flex items-start gap-3 p-4 rounded-lg border transition-all ${
                      isMissing
                        ? "border-red-500/30 bg-red-500/5"
                        : "border-green-500/30 bg-green-500/5"
                    }`}
                  >
                    <div className="text-2xl mt-0.5">{provider.icon}</div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{provider.name}</span>
                        {isMissing ? (
                          <AlertCircle className="h-4 w-4 text-red-500" />
                        ) : (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {provider.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-3 pt-4 border-t">
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
              <div className="flex gap-3">
                <div className="text-blue-500 mt-0.5">
                  <AlertCircle className="h-5 w-5" />
                </div>
                <div className="space-y-1 text-sm">
                  <p className="font-medium text-blue-500">Why do I need to provide my own keys?</p>
                  <p className="text-muted-foreground">
                    Enterprise plans use your own API keys to ensure full control, security, and
                    unlimited usage according to your provider accounts. This also gives you direct
                    access to billing and usage metrics from each provider.
                  </p>
                </div>
              </div>
            </div>

            <Button
              onClick={onGoToSettings}
              size="lg"
              className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white font-semibold shadow-lg shadow-blue-500/20 transition-all"
            >
              <Settings className="mr-2 h-5 w-5" />
              Go to Settings to Configure API Keys
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
