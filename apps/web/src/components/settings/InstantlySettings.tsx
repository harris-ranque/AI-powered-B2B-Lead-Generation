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
import { toast } from "sonner";
import { Send, RefreshCw, Key, Loader2 } from "lucide-react";

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
      toast.error("Please enter an API key");
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
        toast.success("Instantly API key validated and saved!");
        setApiKeyInput("");
        // Auto-fetch accounts after successful validation
        handleFetchAccounts();
      } else {
        toast.error(result.error || "Invalid API key. Please check and try again.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to validate API key";
      toast.error(message);
    } finally {
      setIsValidating(false);
    }
  };

  const handleFetchAccounts = async () => {
    if (!hasValidKey) {
      toast.error("Please add a valid Instantly API key first");
      return;
    }

    setIsFetchingAccounts(true);
    try {
      const accounts = await fetchSenderAccounts({});
      if (accounts.length === 0) {
        toast.info("No sender accounts found in your Instantly workspace");
      } else {
        toast.success(`Found ${accounts.length} sender account(s)`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch accounts";
      toast.error(message);
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
                Connected
              </Badge>
            ) : (
              <Badge variant="outline">Not configured</Badge>
            )}
          </div>

          <p className="text-sm text-muted-foreground">
            Get your API key from{" "}
            <a
              href="https://app.instantly.ai/app/settings/integrations"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Instantly Settings → Integrations
            </a>
          </p>

          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <Input
              type="password"
              placeholder={hasValidKey ? "Key saved. Enter a new key to update." : "Enter your Instantly API key"}
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              className="md:max-w-md"
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
