import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@genni/convex-types";
import type { Id } from "@genni/convex-types/dataModel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  AlertTitle,
} from "@/components/ui/alert";
import { toast } from "sonner";
import { Send, Loader2, Check, AlertCircle, ExternalLink, RefreshCw } from "lucide-react";

interface PushToInstantlyButtonProps {
  searchId: Id<"searches">;
  searchName?: string;
  status: string;
  totalLeads: number;
  analyzedCount: number;
  enrichedCount: number;
}

interface InstantlyAccount {
  id: string;
  email: string;
  displayName?: string;
  status?: string;
}

interface InstantlySettingsData {
  autoPushEnabled: boolean;
  defaultSenderEmail?: string;
  cachedAccounts?: InstantlyAccount[];
}

interface PushStatusData {
  pushed: boolean;
  campaign?: {
    instantlyCampaignId: string;
    instantlyCampaignName: string;
    pushedAt: number;
    leadsCount: number;
  };
}

interface PushResult {
  success: boolean;
  campaignId: string;
  campaignName: string;
  pushedCount: number;
  failedCount: number;
  errors?: string[];
}

/**
 * Parse error message and provide user-friendly guidance
 */
function getErrorGuidance(errorMessage: string): {
  title: string;
  description: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
} {
  const messageLower = errorMessage.toLowerCase();

  // API key issues
  if (messageLower.includes("api key") && (messageLower.includes("invalid") || messageLower.includes("no valid"))) {
    return {
      title: "Invalid API Key",
      description: "Your Instantly API key appears to be invalid or not configured. Make sure you're using an API V2 key.",
      action: {
        label: "Get API Key",
        href: "https://app.instantly.ai/app/settings/integrations",
      },
    };
  }

  if (messageLower.includes("permission") || messageLower.includes("scope")) {
    return {
      title: "Insufficient Permissions",
      description: "Your API key doesn't have the required permissions. Create a new key with 'campaigns:create', 'leads:create', and 'accounts:read' scopes.",
      action: {
        label: "Manage API Keys",
        href: "https://app.instantly.ai/app/settings/integrations",
      },
    };
  }

  // Rate limit
  if (messageLower.includes("rate limit")) {
    return {
      title: "Rate Limit Exceeded",
      description: "Instantly's rate limit (100 requests/10 seconds) was exceeded. Please wait a few minutes before trying again.",
    };
  }

  // No leads
  if (messageLower.includes("no leads")) {
    return {
      title: "No Leads Available",
      description: "No leads with email addresses and completed analysis were found. Make sure your leads have been enriched and analyzed.",
    };
  }

  // Network/timeout issues
  if (messageLower.includes("timeout") || messageLower.includes("network") || messageLower.includes("connect")) {
    return {
      title: "Connection Issue",
      description: "Unable to connect to Instantly. Please check your internet connection and try again.",
    };
  }

  // Server errors
  if (messageLower.includes("technical difficulties") || messageLower.includes("server")) {
    return {
      title: "Instantly Service Issue",
      description: "Instantly is experiencing technical difficulties. Please try again in a few minutes.",
      action: {
        label: "Check Instantly Status",
        href: "https://status.instantly.ai",
      },
    };
  }

  // Already pushed
  if (messageLower.includes("already been pushed")) {
    return {
      title: "Already Pushed",
      description: "This search has already been pushed to Instantly. Check your Instantly dashboard for the existing campaign.",
      action: {
        label: "Open Instantly Dashboard",
        href: "https://app.instantly.ai/app/campaigns",
      },
    };
  }

  // Default
  return {
    title: "Push Failed",
    description: errorMessage,
  };
}

export function PushToInstantlyButton({
  searchId,
  searchName,
  status,
  totalLeads,
  analyzedCount,
  enrichedCount,
}: PushToInstantlyButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<string>("");
  const [lastError, setLastError] = useState<string | null>(null);

  // Check if user has Instantly configured
  const userApiKeys = useQuery(api.userApiKeys.queries.getUserApiKeys);
  const instantlySettings = useQuery(api.instantly.queries.getSettings) as InstantlySettingsData | null | undefined;
  const pushStatus = useQuery(api.instantly.queries.isSearchPushed, { searchId }) as PushStatusData | null | undefined;

  // Action
  const pushToInstantly = useAction(api.instantly.actions.pushToInstantly);

  // Find Instantly key
  const instantlyKey = userApiKeys?.find((key) => key.provider === "instantly");
  const hasValidKey = instantlyKey?.validated;

  // Get cached accounts
  const cachedAccounts = instantlySettings?.cachedAccounts || [];
  const defaultSenderEmail = instantlySettings?.defaultSenderEmail;

  // Already pushed check
  const alreadyPushed = pushStatus?.pushed;
  const campaignInfo = pushStatus?.campaign;

  // Can push check
  const canPush =
    hasValidKey &&
    status === "completed" &&
    analyzedCount > 0 &&
    !alreadyPushed;

  // Don't render if no Instantly key
  if (!hasValidKey) {
    return null;
  }

  const handleOpenDialog = () => {
    // Clear any previous errors
    setLastError(null);

    // Pre-select default email if available
    if (defaultSenderEmail && cachedAccounts.some(a => a.email === defaultSenderEmail)) {
      setSelectedEmail(defaultSenderEmail);
    } else if (cachedAccounts.length === 1) {
      // Non-null assertion is safe here because we just checked length === 1
      setSelectedEmail(cachedAccounts[0]!.email);
    }
    setIsOpen(true);
  };

  const handlePush = async () => {
    if (!selectedEmail) {
      toast.error("Please select a sender email");
      return;
    }

    setIsPushing(true);
    setLastError(null);

    try {
      const result = await pushToInstantly({
        searchId,
        senderEmail: selectedEmail,
      }) as PushResult;

      if (result.success) {
        // Success - show appropriate message based on results
        if (result.failedCount > 0) {
          toast.warning(
            `Pushed ${result.pushedCount} of ${result.pushedCount + result.failedCount} leads`,
            {
              description: `${result.failedCount} leads failed. Campaign "${result.campaignName}" created as draft.`,
              duration: 8000,
            }
          );
        } else {
          toast.success(
            `Successfully pushed ${result.pushedCount} leads to Instantly`,
            {
              description: `Campaign "${result.campaignName}" created as draft. Activate it in Instantly to start sending.`,
              duration: 6000,
              action: {
                label: "Open Instantly",
                onClick: () => window.open("https://app.instantly.ai/app/campaigns", "_blank"),
              },
            }
          );
        }

        // Log any errors for debugging but don't show to user if operation succeeded
        if (result.errors && result.errors.length > 0) {
          console.warn("Instantly push completed with some batch errors:", result.errors);
        }

        setIsOpen(false);
      } else {
        // Partial failure - campaign was created but something went wrong
        const errorMessage = "Campaign was created but no leads were pushed successfully. Please check your Instantly dashboard.";
        setLastError(errorMessage);
        toast.error(errorMessage);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to push to Instantly";
      setLastError(errorMessage);

      // Show structured error toast
      const guidance = getErrorGuidance(errorMessage);
      toast.error(guidance.title, {
        description: guidance.description,
        duration: 10000,
        action: guidance.action?.href ? {
          label: guidance.action.label,
          onClick: () => window.open(guidance.action!.href, "_blank"),
        } : undefined,
      });
    } finally {
      setIsPushing(false);
    }
  };

  const handleCloseDialog = () => {
    setIsOpen(false);
    setLastError(null);
  };

  // Already pushed - show badge
  if (alreadyPushed && campaignInfo) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled
        className="gap-2"
      >
        <Check className="h-4 w-4 text-green-500" />
        Pushed to Instantly
      </Button>
    );
  }

  // Not ready to push
  if (!canPush) {
    if (status !== "completed") {
      return null; // Don't show for incomplete searches
    }

    if (analyzedCount === 0) {
      return (
        <Button
          size="sm"
          variant="outline"
          disabled
          className="gap-2"
          title="No analyzed leads to push"
        >
          <AlertCircle className="h-4 w-4 text-muted-foreground" />
          No Leads
        </Button>
      );
    }

    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleCloseDialog}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          onClick={handleOpenDialog}
          className="gap-2"
        >
          <Send className="h-4 w-4" />
          Push to Instantly
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Push to Instantly</DialogTitle>
          <DialogDescription>
            Create a new campaign in Instantly with your AI-generated email sequences.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Error Alert */}
          {lastError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{getErrorGuidance(lastError).title}</AlertTitle>
              <AlertDescription className="mt-2">
                <p className="text-sm">{getErrorGuidance(lastError).description}</p>
                {getErrorGuidance(lastError).action?.href && (
                  <a
                    href={getErrorGuidance(lastError).action!.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-sm font-medium underline"
                  >
                    {getErrorGuidance(lastError).action!.label}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Search Summary */}
          <div className="rounded-lg border p-3 space-y-2">
            <div className="font-medium">{searchName || "Lead Search"}</div>
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="secondary">{totalLeads} leads found</Badge>
              <Badge variant="secondary">{enrichedCount} with contacts</Badge>
              <Badge variant="outline">{analyzedCount} analyzed</Badge>
            </div>
          </div>

          {/* Sender Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Sender Email Account</label>
            {cachedAccounts.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-center">
                <p className="text-sm text-muted-foreground mb-2">
                  No sender accounts found in your Instantly workspace.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open("/settings", "_self")}
                >
                  <RefreshCw className="mr-2 h-3 w-3" />
                  Refresh Accounts in Settings
                </Button>
              </div>
            ) : (
              <Select value={selectedEmail} onValueChange={setSelectedEmail}>
                <SelectTrigger>
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
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Info Note */}
          <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
            <p>
              <strong>Note:</strong> The campaign will be created as a draft.
              You'll need to activate it in the{" "}
              <a
                href="https://app.instantly.ai/app/campaigns"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                Instantly dashboard
              </a>
              .
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCloseDialog} disabled={isPushing}>
            Cancel
          </Button>
          <Button
            onClick={handlePush}
            disabled={isPushing || !selectedEmail || cachedAccounts.length === 0}
          >
            {isPushing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating Campaign...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Create Campaign
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
