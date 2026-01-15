import { useState, useEffect } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
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
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert";
import { toast } from "sonner";
import { Send, RefreshCw, Key, Loader2, AlertCircle, ExternalLink, CheckCircle2 } from "lucide-react";

/**
 * Parse error messages and provide user-friendly guidance
 */
function parseInstantlyError(errorMessage: string): {
  message: string;
  action?: {
    label: string;
    href: string;
  };
} {
  const messageLower = errorMessage.toLowerCase();

  if (messageLower.includes("invalid") && messageLower.includes("api key")) {
    return {
      message: "Your API key appears to be invalid. Make sure you're using an API V2 key from Instantly.",
      action: {
        label: "Get API V2 Key",
        href: "https://app.instantly.ai/app/settings/integrations",
      },
    };
  }

  if (messageLower.includes("permission") || messageLower.includes("scope")) {
    return {
      message: "Your API key doesn't have the required permissions. Create a new key with 'accounts:read' scope.",
      action: {
        label: "Manage API Keys",
        href: "https://app.instantly.ai/app/settings/integrations",
      },
    };
  }

  if (messageLower.includes("rate limit")) {
    return {
      message: "Rate limit exceeded. Please wait a few minutes and try again.",
    };
  }

  if (messageLower.includes("timeout") || messageLower.includes("network")) {
    return {
      message: "Connection issue. Please check your internet and try again.",
    };
  }

  if (messageLower.includes("no valid")) {
    return {
      message: "No Instantly API key found. Please add your API V2 key below.",
    };
  }

  return {
    message: errorMessage,
  };
}

interface InstantlyAccount {
  id: string;
  email: string;
  displayName?: string;
  status?: string;
}

interface InstantlySettingsData {
  _id: string;
  autoPushEnabled: boolean;
  defaultSenderEmail?: string;
  defaultSenderAccountId?: string;
  cachedAccounts?: InstantlyAccount[];
  cachedAccountsAt?: number;
}

export function InstantlySettings() {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [isFetchingAccounts, setIsFetchingAccounts] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Queries
  const userApiKeys = useQuery(api.userApiKeys.queries.getUserApiKeys);
  const instantlySettings = useQuery(api.instantly.queries.getSettings) as InstantlySettingsData | null | undefined;

  // Actions & Mutations
  const validateKey = useAction(api.apiKeys.validateKey);
  const fetchSenderAccounts = useAction(api.instantly.actions.fetchSenderAccounts);
  const updateInstantlySettings = useMutation(api.instantly.mutations.updateSettings);

  // Local state for settings form
  const [autoPushEnabled, setAutoPushEnabled] = useState(false);
  const [selectedSenderEmail, setSelectedSenderEmail] = useState<string>("");

  // Find existing Instantly key
  const instantlyKey = userApiKeys?.find((key) => key.provider === "instantly");
  const hasValidKey = instantlyKey?.validated;

  // Get cached accounts
  const cachedAccounts = instantlySettings?.cachedAccounts || [];
  const accountsCachedAt = instantlySettings?.cachedAccountsAt;

  // Update local state when settings load
  useEffect(() => {
    if (instantlySettings) {
      setAutoPushEnabled(instantlySettings.autoPushEnabled ?? false);
      setSelectedSenderEmail(instantlySettings.defaultSenderEmail ?? "");
    }
  }, [instantlySettings]);

  const handleValidateKey = async () => {
    const value = apiKeyInput.trim();
    if (!value) {
      toast.error("Please enter an API key", {
        description: "Get your API V2 key from Instantly Settings → Integrations.",
      });
      return;
    }

    // Basic format validation
    if (value.length < 20) {
      toast.error("API key seems too short", {
        description: "Instantly API V2 keys are typically longer. Make sure you copied the full key.",
      });
      return;
    }

    setIsValidating(true);
    try {
      const result = await validateKey({
        provider: "instantly",
        apiKey: value,
        keyName: "Instantly API Key",
      });

      if (result.valid) {
        toast.success("Instantly API key validated and saved!", {
          description: "Fetching your sender accounts...",
        });
        setApiKeyInput("");
        // Auto-fetch accounts after successful validation
        handleFetchAccounts();
      } else {
        const errorMessage = result.error || "Invalid API key";
        const parsed = parseInstantlyError(errorMessage);

        toast.error("API key validation failed", {
          description: parsed.message,
          duration: 8000,
          action: parsed.action ? {
            label: parsed.action.label,
            onClick: () => window.open(parsed.action!.href, "_blank"),
          } : undefined,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to validate API key";
      const parsed = parseInstantlyError(errorMessage);

      toast.error("Validation failed", {
        description: parsed.message,
        duration: 8000,
        action: parsed.action ? {
          label: parsed.action.label,
          onClick: () => window.open(parsed.action!.href, "_blank"),
        } : undefined,
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleFetchAccounts = async () => {
    if (!hasValidKey) {
      toast.error("Please add a valid Instantly API key first", {
        description: "Enter your API V2 key above and click 'Validate & Save'.",
      });
      return;
    }

    setIsFetchingAccounts(true);
    try {
      const accounts = await fetchSenderAccounts({});
      if (accounts.length === 0) {
        toast.info("No sender accounts found", {
          description: "Add email accounts in your Instantly workspace, then refresh.",
          action: {
            label: "Open Instantly",
            onClick: () => window.open("https://app.instantly.ai/app/accounts", "_blank"),
          },
        });
      } else {
        toast.success(`Found ${accounts.length} sender account${accounts.length === 1 ? "" : "s"}`, {
          description: "You can now push leads to Instantly campaigns.",
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to fetch accounts";
      const parsed = parseInstantlyError(errorMessage);

      toast.error("Failed to fetch accounts", {
        description: parsed.message,
        duration: 8000,
        action: parsed.action ? {
          label: parsed.action.label,
          onClick: () => window.open(parsed.action!.href, "_blank"),
        } : undefined,
      });
    } finally {
      setIsFetchingAccounts(false);
    }
  };

  const handleSaveSettings = async () => {
    if (autoPushEnabled && !selectedSenderEmail) {
      toast.error("Please select a sender email to enable auto-push");
      return;
    }

    setIsSavingSettings(true);
    try {
      await updateInstantlySettings({
        autoPushEnabled,
        defaultSenderEmail: selectedSenderEmail || undefined,
        defaultSenderAccountId: cachedAccounts.find(a => a.email === selectedSenderEmail)?.id,
      });
      toast.success("Instantly settings saved!");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save settings";
      toast.error(message);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const formatCacheTime = (timestamp?: number) => {
    if (!timestamp) return null;
    return new Date(timestamp).toLocaleString();
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center gap-3">
          <Send className="h-5 w-5 text-primary" />
          <div>
            <CardTitle>Instantly Integration</CardTitle>
            <CardDescription>
              Connect your Instantly account to automatically push AI-generated email sequences to campaigns.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* API Key Section */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-sm font-semibold">API Key</h4>
            {hasValidKey ? (
              <Badge className="bg-emerald-500 text-emerald-950 hover:bg-emerald-500/90">
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Connected
              </Badge>
            ) : (
              <Badge variant="outline">Not configured</Badge>
            )}
          </div>

          <div className="text-sm text-muted-foreground space-y-1">
            <p>
              Get your <strong>API V2</strong> key from{" "}
              <a
                href="https://app.instantly.ai/app/settings/integrations"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                Instantly Settings → Integrations
                <ExternalLink className="h-3 w-3" />
              </a>
            </p>
            <p className="text-xs">
              <strong>Required scopes:</strong> campaigns:create, leads:create, accounts:read (or all:all)
            </p>
          </div>

          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <Input
              type="password"
              placeholder={hasValidKey ? "Key saved. Enter a new key to update." : "Enter your Instantly API V2 key"}
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              className="md:max-w-md"
              onKeyDown={(e) => {
                if (e.key === "Enter" && apiKeyInput.trim()) {
                  handleValidateKey();
                }
              }}
            />
            <Button
              onClick={handleValidateKey}
              disabled={isValidating || !apiKeyInput.trim()}
            >
              {isValidating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Validating...
                </>
              ) : (
                "Validate & Save"
              )}
            </Button>
          </div>

          {/* V1 to V2 Migration Notice */}
          {!hasValidKey && (
            <Alert className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/50">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <AlertDescription className="text-amber-800 dark:text-amber-200">
                <strong>Important:</strong> Instantly is deprecating API V1 in 2025.
                Make sure you're using an <strong>API V2</strong> key.
                V1 keys will not work with this integration.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <Separator />

        {/* Sender Account Selection */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold">Sender Email Account</h4>
              <p className="text-sm text-muted-foreground">
                Select the email account to send campaigns from
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleFetchAccounts}
              disabled={!hasValidKey || isFetchingAccounts}
            >
              {isFetchingAccounts ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh
                </>
              )}
            </Button>
          </div>

          {!hasValidKey ? (
            <p className="text-sm text-muted-foreground italic">
              Add your API key above to load sender accounts
            </p>
          ) : cachedAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No accounts found. Click Refresh to load your sender accounts.
            </p>
          ) : (
            <>
              <Select
                value={selectedSenderEmail}
                onValueChange={setSelectedSenderEmail}
              >
                <SelectTrigger className="w-full md:max-w-md">
                  <SelectValue placeholder="Select sender email" />
                </SelectTrigger>
                <SelectContent>
                  {cachedAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.email}>
                      <div className="flex items-center gap-2">
                        <span>{account.email}</span>
                        {account.displayName && (
                          <span className="text-muted-foreground">
                            ({account.displayName})
                          </span>
                        )}
                        {account.status && (
                          <Badge variant="outline" className="text-xs">
                            {account.status}
                          </Badge>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {accountsCachedAt && (
                <p className="text-xs text-muted-foreground">
                  Last updated: {formatCacheTime(accountsCachedAt)}
                </p>
              )}
            </>
          )}
        </div>

        <Separator />

        {/* Auto-Push Setting */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold">Auto-Push to Instantly</h4>
              <p className="text-sm text-muted-foreground">
                Automatically push leads to Instantly when a search completes
              </p>
            </div>
            <Switch
              checked={autoPushEnabled}
              onCheckedChange={setAutoPushEnabled}
              disabled={!hasValidKey || cachedAccounts.length === 0}
            />
          </div>

          {autoPushEnabled && !selectedSenderEmail && (
            <p className="text-sm text-orange-500">
              Please select a sender email to enable auto-push
            </p>
          )}

          <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground">
            <p>
              <strong>Note:</strong> Campaigns are created as drafts in Instantly.
              You'll need to activate them manually in the Instantly dashboard.
            </p>
          </div>
        </div>

        {/* Save Button */}
        <Button
          onClick={handleSaveSettings}
          disabled={isSavingSettings || !hasValidKey}
          className="w-full md:w-auto"
        >
          {isSavingSettings ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            "Save Instantly Settings"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
