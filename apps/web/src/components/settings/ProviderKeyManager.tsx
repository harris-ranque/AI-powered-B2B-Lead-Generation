import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@genni/convex-types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

const PROVIDERS = [
  {
    id: "openai" as const,
    name: "OpenAI",
    description: "Required for all LLM-powered workflows including email generation.",
    required: true,
  },
  {
    id: "tavily" as const,
    name: "Tavily",
    description: "Used for research and web enrichment tasks.",
    required: false,
  },
  {
    id: "perplexity" as const,
    name: "Perplexity",
    description: "Unlocks deep research mode for premium leads.",
    required: false,
  },
  {
    id: "google_places" as const,
    name: "Google Places",
    description: "Enables local business discovery and location enrichment.",
    required: false,
  },
];

const providerOrder = PROVIDERS.map((provider) => provider.id);

type ProviderId = (typeof providerOrder)[number];

interface ProviderKeyState {
  validated: boolean;
  validatedAt?: number;
  lastError?: string;
  usageCount: number;
  hasKey: boolean;
}

interface ProviderKeyManagerProps {
  plan?: string | null;
}

export function ProviderKeyManager({ plan }: ProviderKeyManagerProps) {
  const userApiKeys = useQuery(api.userApiKeys.queries.getUserApiKeys);
  const status = useQuery(api.userApiKeys.queries.getApiKeyStatus);
  const validateKey = useMutation(api.apiKeys.validateKey);

  const [keyInputs, setKeyInputs] = useState<Record<ProviderId, string>>(() => ({
    openai: "",
    tavily: "",
    perplexity: "",
    google_places: "",
  }));
  const [validating, setValidating] = useState<ProviderId | null>(null);

  useEffect(() => {
    if (!userApiKeys) {
      return;
    }

    setKeyInputs((prev) => {
      const next = { ...prev };
      for (const provider of providerOrder) {
        const entry = userApiKeys.find((key) => key.provider === provider);
        if (!entry) {
          next[provider] = "";
        }
      }
      return next;
    });
  }, [userApiKeys]);

  const providerState = useMemo(() => {
    const states: Record<ProviderId, ProviderKeyState> = {
      openai: { validated: false, usageCount: 0, hasKey: false },
      tavily: { validated: false, usageCount: 0, hasKey: false },
      perplexity: { validated: false, usageCount: 0, hasKey: false },
      google_places: { validated: false, usageCount: 0, hasKey: false },
    };

    for (const key of userApiKeys ?? []) {
      const provider = key.provider as ProviderId;
      if (!providerOrder.includes(provider)) {
        continue;
      }

      states[provider] = {
        validated: Boolean(key.validated),
        validatedAt: key.validatedAt ?? undefined,
        lastError: key.lastError ?? undefined,
        usageCount: key.usageCount ?? 0,
        hasKey: true,
      };
    }

    return states;
  }, [userApiKeys]);

  const handleInputChange = (provider: ProviderId, value: string) => {
    setKeyInputs((prev) => ({
      ...prev,
      [provider]: value,
    }));
  };

  const handleValidate = async (provider: ProviderId) => {
    const value = keyInputs[provider]?.trim();
    if (!value) {
      toast.error("Enter an API key before validating.");
      return;
    }

    setValidating(provider);
    try {
      const result = await validateKey({
        provider,
        apiKey: value,
        keyName: `${provider.toUpperCase()} key`,
      });

      if (result.valid) {
        toast.success(`${PROVIDERS.find((p) => p.id === provider)?.name || provider} key validated.`);
        setKeyInputs((prev) => ({
          ...prev,
          [provider]: "",
        }));
      } else {
        toast.error(result.error || "API key validation failed.");
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to validate API key. Please try again.";
      toast.error(message);
    } finally {
      setValidating(null);
    }
  };

  const requiresOwnKeys = plan === "enterprise";

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle>Bring Your Own Keys</CardTitle>
        <CardDescription>
          Connect your provider credentials so Genni can execute research and generation using your usage limits.
          {requiresOwnKeys && " Enterprise plans require a valid OpenAI key before running any workflows."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {PROVIDERS.map((provider) => {
          const state = providerState[provider.id];
          const isValid = state?.validated;
          const lastValidated = state?.validatedAt
            ? new Date(state.validatedAt).toLocaleString()
            : null;

          return (
            <div key={provider.id} className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-base font-semibold">{provider.name}</h4>
                    {provider.required && <Badge variant="secondary">Required</Badge>}
                    {isValid && (
                      <Badge className="bg-emerald-500 text-emerald-950 hover:bg-emerald-500/90">
                        Validated
                      </Badge>
                    )}
                    {!isValid && state?.hasKey && (
                      <Badge variant="destructive">Needs attention</Badge>
                    )}
                    {!state?.hasKey && <Badge variant="outline">Not configured</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{provider.description}</p>
                  {lastValidated && (
                    <p className="mt-1 text-xs text-muted-foreground">Last validated {lastValidated}</p>
                  )}
                  {state?.lastError && (
                    <p className="mt-1 text-xs text-destructive">{state.lastError}</p>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <Input
                  type="password"
                  placeholder={state?.hasKey ? "Key stored securely. Enter a new key to update." : "Enter API key"}
                  value={keyInputs[provider.id]}
                  onChange={(event) => handleInputChange(provider.id, event.target.value)}
                  className="md:max-w-xl"
                />
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => handleValidate(provider.id)}
                    disabled={validating === provider.id}
                  >
                    {validating === provider.id ? "Validating..." : "Validate & Save"}
                  </Button>
                  {state?.usageCount ? (
                    <span className="text-xs text-muted-foreground">
                      Used {state.usageCount} {state.usageCount === 1 ? "time" : "times"}
                    </span>
                  ) : null}
                </div>
              </div>
              <Separator />
            </div>
          );
        })}
        {status && (
          <p className="text-xs text-muted-foreground">
            Connected providers: {status.configuredProviders?.length ?? 0} / {providerOrder.length}. Missing providers:
            {" "}
            {(() => {
              const missing = (status.missingProviders as string[] | undefined)?.filter((provider): provider is ProviderId =>
                providerOrder.includes(provider as ProviderId),
              );
              return missing && missing.length
                ? missing.map((provider) => provider.replace("_", " ")).join(", ")
                : "None";
            })()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
