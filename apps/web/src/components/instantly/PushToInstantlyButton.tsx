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
import { toast } from "sonner";
import { Send, Loader2, Check, AlertCircle } from "lucide-react";

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
    // Pre-select default email if available
    if (defaultSenderEmail && cachedAccounts.some(a => a.email === defaultSenderEmail)) {
      setSelectedEmail(defaultSenderEmail);
    } else if (cachedAccounts.length === 1) {
      setSelectedEmail(cachedAccounts[0].email);
    }
    setIsOpen(true);
  };

  const handlePush = async () => {
    if (!selectedEmail) {
      toast.error("Please select a sender email");
      return;
    }

    setIsPushing(true);
    try {
      const result = await pushToInstantly({
        searchId,
        senderEmail: selectedEmail,
      });

      toast.success(
        `Successfully pushed ${result.pushedCount} leads to Instantly campaign "${result.campaignName}"`,
        {
          description: result.failedCount > 0
            ? `${result.failedCount} leads failed to push`
            : "Campaign created as draft",
        }
      );
      setIsOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to push to Instantly";
      toast.error(message);
    } finally {
      setIsPushing(false);
    }
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
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
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
              <p className="text-sm text-muted-foreground">
                No sender accounts found. Please refresh accounts in Settings.
              </p>
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
              You'll need to activate it in the Instantly dashboard.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handlePush}
            disabled={isPushing || !selectedEmail || cachedAccounts.length === 0}
          >
            {isPushing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Pushing...
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
