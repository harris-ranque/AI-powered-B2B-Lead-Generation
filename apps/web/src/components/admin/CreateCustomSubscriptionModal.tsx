/**
 * Create Custom Subscription Modal
 *
 * Admin-facing modal for creating custom subscriptions with:
 * - Custom pricing ($500-2000/month)
 * - Monthly credit allocations
 * - Optional extra credit purchases
 * - Dual ACH/Card pricing (3% convenience fee for cards)
 */

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import {
  CreditCard,
  DollarSign,
  Mail,
  User,
  Coins,
  AlertCircle,
  ExternalLink,
  Copy,
  CheckCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAction } from "convex/react";
import { api } from "@genni/convex-types";

interface CreateCustomSubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

// 3% convenience fee for card payments
const CARD_CONVENIENCE_FEE_PERCENT = 0.03;

export function CreateCustomSubscriptionModal({
  isOpen,
  onClose,
  onSuccess,
}: CreateCustomSubscriptionModalProps) {
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [monthlyPrice, setMonthlyPrice] = useState("");
  const [monthlyCredits, setMonthlyCredits] = useState("");
  const [allowExtraCredits, setAllowExtraCredits] = useState(false);
  const [extraCreditPrice, setExtraCreditPrice] = useState("");
  const [extraCreditPackSize, setExtraCreditPackSize] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { toast } = useToast();
  const createSubscription = useAction(api.billing.stripe.subscriptions.createCustomSubscription);

  // Calculated values
  const monthlyPriceCents = Math.round(parseFloat(monthlyPrice || "0") * 100);
  const cardPriceCents = monthlyPriceCents + Math.round(monthlyPriceCents * CARD_CONVENIENCE_FEE_PERCENT);
  const cardPrice = (cardPriceCents / 100).toFixed(2);
  const extraCreditPriceCents = Math.round(parseFloat(extraCreditPrice || "0") * 100);

  const resetForm = () => {
    setCustomerEmail("");
    setCustomerName("");
    setMonthlyPrice("");
    setMonthlyCredits("");
    setAllowExtraCredits(false);
    setExtraCreditPrice("");
    setExtraCreditPackSize("");
    setAdminNotes("");
    setCheckoutUrl(null);
    setCopied(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (!customerEmail) {
      toast({
        title: "Error",
        description: "Customer email is required",
        variant: "destructive",
      });
      return;
    }

    if (monthlyPriceCents < 50000 || monthlyPriceCents > 200000) {
      toast({
        title: "Error",
        description: "Monthly price must be between $500 and $2,000",
        variant: "destructive",
      });
      return;
    }

    const creditsNum = parseInt(monthlyCredits);
    if (!creditsNum || creditsNum < 100) {
      toast({
        title: "Error",
        description: "Monthly credits must be at least 100",
        variant: "destructive",
      });
      return;
    }

    if (allowExtraCredits) {
      if (!extraCreditPriceCents || extraCreditPriceCents <= 0) {
        toast({
          title: "Error",
          description: "Extra credit price is required when allowing extra credits",
          variant: "destructive",
        });
        return;
      }
      const packSize = parseInt(extraCreditPackSize);
      if (!packSize || packSize <= 0) {
        toast({
          title: "Error",
          description: "Extra credit pack size is required when allowing extra credits",
          variant: "destructive",
        });
        return;
      }
    }

    try {
      setIsLoading(true);

      const result = await createSubscription({
        customerEmail,
        customerName: customerName || undefined,
        monthlyPriceCents,
        monthlyCredits: creditsNum,
        allowExtraCredits,
        extraCreditPriceCents: allowExtraCredits ? extraCreditPriceCents : undefined,
        extraCreditPackSize: allowExtraCredits ? parseInt(extraCreditPackSize) : undefined,
        adminNotes: adminNotes || undefined,
      });

      if (result.success && result.checkoutUrl) {
        setCheckoutUrl(result.checkoutUrl);
        toast({
          title: "Subscription Created",
          description: "Checkout link is ready to send to customer",
        });
        onSuccess?.();
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Failed to create subscription";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyUrl = async () => {
    if (checkoutUrl) {
      await navigator.clipboard.writeText(checkoutUrl);
      setCopied(true);
      toast({
        title: "Copied",
        description: "Checkout URL copied to clipboard",
      });
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Success state - show checkout URL
  if (checkoutUrl) {
    return (
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              Subscription Created
            </DialogTitle>
            <DialogDescription>
              Send this checkout link to the customer to complete their subscription setup.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <Alert>
              <AlertDescription>
                <div className="space-y-2">
                  <p className="font-medium">Customer: {customerEmail}</p>
                  <p className="text-sm text-muted-foreground">
                    ACH Price: ${monthlyPrice}/month | Card Price: ${cardPrice}/month (includes 3% fee)
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Monthly Credits: {monthlyCredits}
                  </p>
                </div>
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label>Checkout URL</Label>
              <div className="flex gap-2">
                <Input
                  value={checkoutUrl}
                  readOnly
                  className="font-mono text-xs"
                />
                <Button variant="outline" size="icon" onClick={handleCopyUrl}>
                  {copied ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                This link expires in 24 hours. The customer can choose ACH or card payment at checkout.
              </p>
            </div>
          </div>

          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={handleClose}>
              Close
            </Button>
            <Button onClick={() => window.open(checkoutUrl, "_blank")}>
              <ExternalLink className="h-4 w-4 mr-2" />
              Open in New Tab
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Create Custom Subscription
          </DialogTitle>
          <DialogDescription>
            Create a custom subscription for a B2B customer with personalized pricing and credit allocation.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 py-4">
          {/* Customer Information */}
          <Card className="p-4 space-y-4">
            <h4 className="font-medium flex items-center gap-2">
              <User className="h-4 w-4" />
              Customer Information
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">
                  Email Address <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="customer@company.com"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    className="pl-9"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">Customer Name</Label>
                <Input
                  id="name"
                  placeholder="John Smith"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>
            </div>
          </Card>

          {/* Pricing Configuration */}
          <Card className="p-4 space-y-4">
            <h4 className="font-medium flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Pricing Configuration
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="price">
                  Monthly Price (USD) <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="price"
                    type="number"
                    placeholder="1000"
                    value={monthlyPrice}
                    onChange={(e) => setMonthlyPrice(e.target.value)}
                    className="pl-9"
                    min="500"
                    max="2000"
                    step="1"
                    required
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  $500 - $2,000 per month
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="credits">
                  Monthly Credits <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <Coins className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="credits"
                    type="number"
                    placeholder="500"
                    value={monthlyCredits}
                    onChange={(e) => setMonthlyCredits(e.target.value)}
                    className="pl-9"
                    min="100"
                    required
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Minimum 100 credits. Use-it-or-lose-it monthly.
                </p>
              </div>
            </div>

            {/* Price Preview */}
            {monthlyPrice && parseFloat(monthlyPrice) >= 500 && (
              <Alert>
                <AlertDescription>
                  <div className="flex justify-between items-center">
                    <span>ACH Price (no fee):</span>
                    <span className="font-medium">${monthlyPrice}/month</span>
                  </div>
                  <div className="flex justify-between items-center mt-1">
                    <span>Card Price (3% fee):</span>
                    <span className="font-medium">${cardPrice}/month</span>
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </Card>

          {/* Extra Credits Configuration */}
          <Card className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">Allow Extra Credit Purchases</h4>
                <p className="text-sm text-muted-foreground">
                  Customer can buy additional credits beyond monthly allocation
                </p>
              </div>
              <Switch
                checked={allowExtraCredits}
                onCheckedChange={setAllowExtraCredits}
              />
            </div>

            {allowExtraCredits && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t">
                <div className="space-y-2">
                  <Label htmlFor="extraPrice">Extra Credit Price (USD)</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="extraPrice"
                      type="number"
                      placeholder="50"
                      value={extraCreditPrice}
                      onChange={(e) => setExtraCreditPrice(e.target.value)}
                      className="pl-9"
                      min="1"
                      step="1"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Price per credit pack purchase
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="packSize">Credits Per Pack</Label>
                  <Input
                    id="packSize"
                    type="number"
                    placeholder="100"
                    value={extraCreditPackSize}
                    onChange={(e) => setExtraCreditPackSize(e.target.value)}
                    min="1"
                  />
                  <p className="text-xs text-muted-foreground">
                    Number of credits in each pack
                  </p>
                </div>
              </div>
            )}
          </Card>

          {/* Admin Notes */}
          <Card className="p-4 space-y-4">
            <h4 className="font-medium">Admin Notes</h4>
            <Textarea
              placeholder="Internal notes about this subscription (not visible to customer)"
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              rows={2}
            />
          </Card>

          {/* Important Notes */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <ul className="text-sm space-y-1 list-disc pl-4">
                <li>Customer will receive a checkout link via email</li>
                <li>They can choose ACH (no fee) or card payment (+3%)</li>
                <li>Monthly credits reset on billing date (no rollover)</li>
                <li>Subscription auto-renews unless cancelled</li>
              </ul>
            </AlertDescription>
          </Alert>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Creating..." : "Create Subscription"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
