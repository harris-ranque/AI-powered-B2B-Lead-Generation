/**
 * Custom Subscription List Component
 *
 * Admin-facing list for viewing and managing custom subscriptions.
 * Shows subscription status, pricing, credits, and allows cancellation.
 */

import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CreditCard,
  Plus,
  RefreshCw,
  ExternalLink,
  Copy,
  XCircle,
  CheckCircle,
  Clock,
  AlertTriangle,
  Pause,
  Coins,
  User,
  Ban,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useAction, useConvex } from "convex/react";
import { api } from "@genni/convex-types";
import { Id } from "@genni/convex-types/dataModel";
import { CreateCustomSubscriptionModal } from "./CreateCustomSubscriptionModal";

type SubscriptionStatus = "pending_checkout" | "active" | "past_due" | "cancelled" | "paused";

interface EnrichedSubscription {
  _id: Id<"customSubscriptions">;
  userId: Id<"users">;
  stripeCustomerId: string;
  stripeSubscriptionId?: string;
  monthlyPriceCents: number;
  monthlyCredits: number;
  allowExtraCredits: boolean;
  extraCreditPriceCents?: number;
  extraCreditPackSize?: number;
  status: SubscriptionStatus;
  checkoutUrl?: string;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  createdAt: number;
  updatedAt: number;
  adminNotes?: string;
  user: {
    email: string;
    name?: string;
    plan: string;
  } | null;
}

const statusConfig: Record<
  SubscriptionStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }
> = {
  pending_checkout: {
    label: "Pending Checkout",
    variant: "secondary",
    icon: <Clock className="h-3 w-3" />,
  },
  active: {
    label: "Active",
    variant: "default",
    icon: <CheckCircle className="h-3 w-3" />,
  },
  past_due: {
    label: "Past Due",
    variant: "destructive",
    icon: <AlertTriangle className="h-3 w-3" />,
  },
  cancelled: {
    label: "Cancelled",
    variant: "outline",
    icon: <XCircle className="h-3 w-3" />,
  },
  paused: {
    label: "Paused",
    variant: "secondary",
    icon: <Pause className="h-3 w-3" />,
  },
};

export function CustomSubscriptionList() {
  const [statusFilter, setStatusFilter] = useState<SubscriptionStatus | "all">("all");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [subscriptionToCancel, setSubscriptionToCancel] = useState<Id<"customSubscriptions"> | null>(null);
  const [cancelImmediately, setCancelImmediately] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const { toast } = useToast();
  const convex = useConvex();

  const subscriptions = useQuery(
    api.billing.stripe.subscriptions.listAllSubscriptions,
    statusFilter === "all" ? {} : { status: statusFilter }
  ) as EnrichedSubscription[] | undefined;

  const cancelSubscription = useAction(api.billing.stripe.subscriptions.cancelSubscription);

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const handleCopyCheckoutUrl = async (url: string) => {
    await navigator.clipboard.writeText(url);
    toast({
      title: "Copied",
      description: "Checkout URL copied to clipboard",
    });
  };

  const handleCancelClick = (subscriptionId: Id<"customSubscriptions">) => {
    setSubscriptionToCancel(subscriptionId);
    setCancelDialogOpen(true);
  };

  const handleConfirmCancel = async () => {
    if (!subscriptionToCancel) return;

    try {
      setIsCancelling(true);
      await cancelSubscription({
        subscriptionId: subscriptionToCancel,
        cancelImmediately,
      });
      toast({
        title: "Subscription Cancelled",
        description: cancelImmediately
          ? "Subscription has been cancelled immediately"
          : "Subscription will be cancelled at the end of the billing period",
      });
      setCancelDialogOpen(false);
      setSubscriptionToCancel(null);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Failed to cancel subscription";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsCancelling(false);
    }
  };

  const getStatusBadge = (status: SubscriptionStatus) => {
    const config = statusConfig[status];
    return (
      <Badge variant={config.variant} className="flex items-center gap-1 w-fit">
        {config.icon}
        {config.label}
      </Badge>
    );
  };

  // Calculate stats
  const stats = {
    total: subscriptions?.length || 0,
    active: subscriptions?.filter((s) => s.status === "active").length || 0,
    pending: subscriptions?.filter((s) => s.status === "pending_checkout").length || 0,
    pastDue: subscriptions?.filter((s) => s.status === "past_due").length || 0,
    mrr: subscriptions
      ?.filter((s) => s.status === "active")
      .reduce((sum, s) => sum + s.monthlyPriceCents, 0) || 0,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <CreditCard className="h-6 w-6" />
            Custom Subscriptions
          </h2>
          <p className="text-muted-foreground">
            Manage B2B custom subscription plans
          </p>
        </div>
        <Button onClick={() => setIsCreateModalOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Subscription
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Total</div>
          <div className="text-2xl font-bold">{stats.total}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Active</div>
          <div className="text-2xl font-bold text-green-600">{stats.active}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Pending</div>
          <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Past Due</div>
          <div className="text-2xl font-bold text-red-600">{stats.pastDue}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">MRR</div>
          <div className="text-2xl font-bold">{formatCurrency(stats.mrr)}</div>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Status:</span>
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as SubscriptionStatus | "all")}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending_checkout">Pending Checkout</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="past_due">Past Due</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void convex.refreshQuery(
              api.billing.stripe.subscriptions.listAllSubscriptions,
              statusFilter === "all" ? {} : { status: statusFilter }
            );
          }}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Subscriptions Table */}
      <Card>
        {!subscriptions ? (
          <div className="p-8 text-center text-muted-foreground">
            Loading subscriptions...
          </div>
        ) : subscriptions.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <CreditCard className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium">No subscriptions found</p>
            <p className="text-sm">Create your first custom subscription to get started</p>
            <Button
              className="mt-4"
              onClick={() => setIsCreateModalOpen(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Subscription
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Monthly Price</TableHead>
                <TableHead>Credits</TableHead>
                <TableHead>Billing Period</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subscriptions.map((subscription) => (
                <TableRow key={subscription._id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div className="font-medium">
                          {subscription.user?.name || "Unknown"}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {subscription.user?.email}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{getStatusBadge(subscription.status)}</TableCell>
                  <TableCell>
                    <div className="font-medium">
                      {formatCurrency(subscription.monthlyPriceCents)}
                    </div>
                    <div className="text-xs text-muted-foreground">per month</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Coins className="h-4 w-4 text-muted-foreground" />
                      <span>{subscription.monthlyCredits}</span>
                    </div>
                    {subscription.allowExtraCredits && (
                      <div className="text-xs text-muted-foreground">
                        +{subscription.extraCreditPackSize} @ {formatCurrency(subscription.extraCreditPriceCents || 0)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {subscription.currentPeriodStart && subscription.currentPeriodEnd ? (
                      <div className="text-sm">
                        <div>{formatDate(subscription.currentPeriodStart)}</div>
                        <div className="text-muted-foreground">
                          to {formatDate(subscription.currentPeriodEnd)}
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>{formatDate(subscription.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {subscription.status === "pending_checkout" && subscription.checkoutUrl && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleCopyCheckoutUrl(subscription.checkoutUrl!)}
                            title="Copy checkout URL"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => window.open(subscription.checkoutUrl, "_blank")}
                            title="Open checkout URL"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                      {(subscription.status === "active" || subscription.status === "past_due") && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleCancelClick(subscription._id)}
                          title="Cancel subscription"
                          className="text-destructive hover:text-destructive"
                        >
                          <Ban className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Create Subscription Modal */}
      <CreateCustomSubscriptionModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={() => {
          // Subscriptions will auto-refresh via Convex reactivity
        }}
      />

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Subscription</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel this subscription? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={cancelImmediately}
                onChange={(e) => setCancelImmediately(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm">
                Cancel immediately (otherwise cancels at end of billing period)
              </span>
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCancelling}>Keep Subscription</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmCancel}
              disabled={isCancelling}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isCancelling ? "Cancelling..." : "Cancel Subscription"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
