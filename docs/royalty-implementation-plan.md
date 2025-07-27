# Developer Royalty System - Implementation Plan

## Overview

This document outlines the implementation of a 5% revenue royalty system with both automatic (Stripe Connect) and manual payment options. The system provides full transparency, automated tracking, and flexible payout methods.

## Database Schema Updates

### New Tables

```typescript
// convex/schema.ts

// Developer configuration and payout settings
developerConfig: defineTable({
  developerId: v.string(), // User ID of the developer
  stripeConnectAccountId: v.optional(v.string()),
  stripeConnectStatus: v.optional(v.union(
    v.literal("pending"),
    v.literal("active"),
    v.literal("rejected")
  )),
  payoutMethod: v.union(
    v.literal("automatic"), // Via Stripe Connect
    v.literal("manual")     // Bank transfer/PayPal/etc
  ),
  bankDetails: v.optional(v.object({
    accountName: v.string(),
    accountNumber: v.string(),
    routingNumber: v.string(),
    bankName: v.string(),
    swift: v.optional(v.string()),
  })),
  paypalEmail: v.optional(v.string()),
  preferredPaymentMethod: v.optional(v.union(
    v.literal("bank"),
    v.literal("paypal"),
    v.literal("crypto"),
    v.literal("check")
  )),
  taxInfo: v.optional(v.object({
    taxId: v.string(),
    businessName: v.optional(v.string()),
    address: v.object({
      street: v.string(),
      city: v.string(),
      state: v.string(),
      zip: v.string(),
      country: v.string(),
    })
  })),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_developer", ["developerId"]),

// Revenue tracking for royalty calculations
revenueTracking: defineTable({
  date: v.string(), // YYYY-MM-DD
  type: v.union(
    v.literal("subscription"),
    v.literal("one_time"),
    v.literal("addon"),
    v.literal("refund")
  ),
  amount: v.number(), // In cents
  currency: v.string(),
  customerId: v.string(),
  subscriptionId: v.optional(v.string()),
  invoiceId: v.optional(v.string()),
  description: v.string(),
  stripeEventId: v.string(), // For idempotency
  metadata: v.any(),
}).index("by_date", ["date"])
  .index("by_stripe_event", ["stripeEventId"]),

// Monthly royalty calculations and payment tracking
royaltyPayments: defineTable({
  month: v.string(), // YYYY-MM
  startDate: v.string(),
  endDate: v.string(),
  totalRevenue: v.number(), // In cents
  royaltyRate: v.number(), // 0.05 for 5%
  royaltyAmount: v.number(), // In cents
  currency: v.string(),
  status: v.union(
    v.literal("calculating"),
    v.literal("pending"),
    v.literal("processing"),
    v.literal("paid"),
    v.literal("failed"),
    v.literal("disputed")
  ),
  paymentMethod: v.optional(v.union(
    v.literal("stripe_connect"),
    v.literal("bank_transfer"),
    v.literal("paypal"),
    v.literal("other")
  )),
  paymentDetails: v.optional(v.object({
    transactionId: v.optional(v.string()),
    paidAt: v.optional(v.number()),
    failureReason: v.optional(v.string()),
    notes: v.optional(v.string()),
  })),
  breakdown: v.array(v.object({
    type: v.string(),
    count: v.number(),
    amount: v.number(),
  })),
  createdAt: v.number(),
  dueDate: v.number(), // 15th of following month
}).index("by_month", ["month"])
  .index("by_status", ["status"]),

// Audit log for all royalty-related actions
royaltyAuditLog: defineTable({
  timestamp: v.number(),
  action: v.union(
    v.literal("revenue_recorded"),
    v.literal("royalty_calculated"),
    v.literal("payment_initiated"),
    v.literal("payment_completed"),
    v.literal("payment_failed"),
    v.literal("config_updated"),
    v.literal("manual_adjustment")
  ),
  performedBy: v.string(), // User ID
  details: v.any(),
  ipAddress: v.optional(v.string()),
}).index("by_timestamp", ["timestamp"]),
```

## API Implementation

### Developer Configuration

```typescript
// convex/royalty/config.ts

import { mutation, query } from "../_generated/server";
import { v } from "convex/values";

export const updateDeveloperConfig = mutation({
  args: {
    stripeConnectAccountId: v.optional(v.string()),
    payoutMethod: v.union(v.literal("automatic"), v.literal("manual")),
    bankDetails: v.optional(v.object({
      accountName: v.string(),
      accountNumber: v.string(),
      routingNumber: v.string(),
      bankName: v.string(),
      swift: v.optional(v.string()),
    })),
    paypalEmail: v.optional(v.string()),
    preferredPaymentMethod: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    
    // Check if user is developer
    const user = await ctx.db.query("users")
      .withIndex("by_email", q => q.eq("email", identity.email))
      .first();
      
    if (user?.role !== "developer") {
      throw new Error("Not authorized");
    }
    
    const existing = await ctx.db.query("developerConfig")
      .withIndex("by_developer", q => q.eq("developerId", user._id))
      .first();
    
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("developerConfig", {
        developerId: user._id,
        ...args,
        payoutMethod: args.payoutMethod || "manual",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    
    // Log the update
    await ctx.db.insert("royaltyAuditLog", {
      timestamp: Date.now(),
      action: "config_updated",
      performedBy: user._id,
      details: { updatedFields: Object.keys(args) },
    });
  },
});

export const getDeveloperConfig = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    
    const user = await ctx.db.query("users")
      .withIndex("by_email", q => q.eq("email", identity.email))
      .first();
      
    if (user?.role !== "developer") return null;
    
    return await ctx.db.query("developerConfig")
      .withIndex("by_developer", q => q.eq("developerId", user._id))
      .first();
  },
});
```

### Revenue Tracking

```typescript
// convex/royalty/revenue.ts

import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const recordRevenue = internalMutation({
  args: {
    stripeEvent: v.any(),
  },
  handler: async (ctx, args) => {
    const { stripeEvent } = args;
    
    // Prevent duplicate processing
    const existing = await ctx.db.query("revenueTracking")
      .withIndex("by_stripe_event", q => q.eq("stripeEventId", stripeEvent.id))
      .first();
      
    if (existing) return;
    
    let amount = 0;
    let type: "subscription" | "one_time" | "refund" = "subscription";
    let description = "";
    
    switch (stripeEvent.type) {
      case "invoice.payment_succeeded":
        amount = stripeEvent.data.object.amount_paid;
        type = stripeEvent.data.object.subscription ? "subscription" : "one_time";
        description = `Invoice ${stripeEvent.data.object.number}`;
        break;
        
      case "charge.refunded":
        amount = -stripeEvent.data.object.amount_refunded;
        type = "refund";
        description = `Refund for ${stripeEvent.data.object.id}`;
        break;
        
      default:
        return; // Ignore other events
    }
    
    await ctx.db.insert("revenueTracking", {
      date: new Date().toISOString().split('T')[0],
      type,
      amount,
      currency: stripeEvent.data.object.currency || "usd",
      customerId: stripeEvent.data.object.customer,
      subscriptionId: stripeEvent.data.object.subscription,
      invoiceId: stripeEvent.data.object.id,
      description,
      stripeEventId: stripeEvent.id,
      metadata: stripeEvent.data.object.metadata || {},
    });
    
    await ctx.db.insert("royaltyAuditLog", {
      timestamp: Date.now(),
      action: "revenue_recorded",
      performedBy: "system",
      details: { amount, type, stripeEventId: stripeEvent.id },
    });
  },
});
```

### Royalty Calculations

```typescript
// convex/royalty/calculations.ts

import { scheduledFunction, internalMutation } from "../_generated/server";
import { v } from "convex/values";

// Run on the 1st of each month
export const calculateMonthlyRoyalty = scheduledFunction(
  "0 0 1 * *",
  async (ctx) => {
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    
    const monthStr = lastMonth.toISOString().slice(0, 7); // YYYY-MM
    const startDate = `${monthStr}-01`;
    const endDate = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0)
      .toISOString().split('T')[0];
    
    // Check if already calculated
    const existing = await ctx.db.query("royaltyPayments")
      .withIndex("by_month", q => q.eq("month", monthStr))
      .first();
      
    if (existing) return;
    
    // Calculate total revenue for the month
    const revenues = await ctx.db.query("revenueTracking")
      .withIndex("by_date", q => 
        q.gte("date", startDate).lte("date", endDate)
      )
      .collect();
    
    const breakdown = revenues.reduce((acc, rev) => {
      const type = rev.type;
      if (!acc[type]) {
        acc[type] = { type, count: 0, amount: 0 };
      }
      acc[type].count += 1;
      acc[type].amount += rev.amount;
      return acc;
    }, {} as Record<string, any>);
    
    const totalRevenue = revenues.reduce((sum, rev) => sum + rev.amount, 0);
    const royaltyAmount = Math.floor(totalRevenue * 0.05); // 5%
    
    // Due on the 15th of the following month
    const dueDate = new Date();
    dueDate.setDate(15);
    
    await ctx.db.insert("royaltyPayments", {
      month: monthStr,
      startDate,
      endDate,
      totalRevenue,
      royaltyRate: 0.05,
      royaltyAmount,
      currency: "usd",
      status: "pending",
      breakdown: Object.values(breakdown),
      createdAt: Date.now(),
      dueDate: dueDate.getTime(),
    });
    
    await ctx.db.insert("royaltyAuditLog", {
      timestamp: Date.now(),
      action: "royalty_calculated",
      performedBy: "system",
      details: { month: monthStr, totalRevenue, royaltyAmount },
    });
    
    // Send notification to developer and admin
    await ctx.scheduler.runAfter(0, internal.notifications.sendRoyaltyCalculated, {
      month: monthStr,
      amount: royaltyAmount,
    });
  }
);
```

### Automatic Payments (Stripe Connect)

```typescript
// convex/royalty/autopay.ts

import { action, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export const processAutomaticPayment = action({
  args: {
    paymentId: v.id("royaltyPayments"),
  },
  handler: async (ctx, args) => {
    const payment = await ctx.runQuery(internal.royalty.getPayment, {
      paymentId: args.paymentId,
    });
    
    if (!payment || payment.status !== "pending") {
      throw new Error("Invalid payment");
    }
    
    const config = await ctx.runQuery(internal.royalty.getDeveloperConfigInternal);
    
    if (!config?.stripeConnectAccountId || config.payoutMethod !== "automatic") {
      throw new Error("Automatic payments not configured");
    }
    
    // Update status to processing
    await ctx.runMutation(internal.royalty.updatePaymentStatus, {
      paymentId: args.paymentId,
      status: "processing",
    });
    
    try {
      // Create transfer via Stripe Connect
      const transfer = await stripe.transfers.create({
        amount: payment.royaltyAmount,
        currency: payment.currency,
        destination: config.stripeConnectAccountId,
        description: `Royalty payment for ${payment.month}`,
        metadata: {
          royaltyPaymentId: args.paymentId,
          month: payment.month,
        },
      });
      
      // Update payment record
      await ctx.runMutation(internal.royalty.completePayment, {
        paymentId: args.paymentId,
        transactionId: transfer.id,
        paymentMethod: "stripe_connect",
      });
      
      return { success: true, transferId: transfer.id };
      
    } catch (error) {
      // Handle failure
      await ctx.runMutation(internal.royalty.failPayment, {
        paymentId: args.paymentId,
        reason: error.message,
      });
      
      throw error;
    }
  },
});
```

## UI Components

### Developer Royalty Dashboard

```typescript
// components/admin/DeveloperRoyaltyDashboard.tsx

import React, { useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { 
  DollarSign, 
  TrendingUp, 
  CreditCard, 
  Download,
  Settings,
  AlertCircle,
  CheckCircle
} from 'lucide-react';

export function DeveloperRoyaltyDashboard() {
  const config = useQuery(api.royalty.config.getDeveloperConfig);
  const stats = useQuery(api.royalty.dashboard.getStats);
  const payments = useQuery(api.royalty.dashboard.getPayments);
  const [showConfig, setShowConfig] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Developer Royalty Dashboard</h1>
        <Button onClick={() => setShowConfig(true)}>
          <Settings className="mr-2 h-4 w-4" />
          Payment Settings
        </Button>
      </div>

      {/* Alert if payment method not configured */}
      {!config?.stripeConnectAccountId && config?.payoutMethod === "automatic" && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Setup Required</AlertTitle>
          <AlertDescription>
            Please complete your Stripe Connect setup to receive automatic payments.
            <Button variant="link" onClick={() => setShowConfig(true)}>
              Complete Setup
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Overview Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Lifetime Earnings
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${(stats?.lifetimeEarnings || 0).toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground">
              Since {stats?.firstPaymentDate || 'N/A'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Pending Payment
            </CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${(stats?.pendingAmount || 0).toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground">
              Due {stats?.nextPaymentDate || 'N/A'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              This Month
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${(stats?.currentMonthEarnings || 0).toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats?.percentageChange || 0}% from last month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Average Monthly
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${(stats?.averageMonthly || 0).toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground">
              Last 12 months
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Payment History */}
      <Card>
        <CardHeader>
          <CardTitle>Payment History</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="all" className="w-full">
            <TabsList>
              <TabsTrigger value="all">All Payments</TabsTrigger>
              <TabsTrigger value="pending">Pending</TabsTrigger>
              <TabsTrigger value="paid">Paid</TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="space-y-4">
              <PaymentTable 
                payments={payments || []} 
                config={config}
                filter="all"
              />
            </TabsContent>

            <TabsContent value="pending" className="space-y-4">
              <PaymentTable 
                payments={payments?.filter(p => p.status === "pending") || []} 
                config={config}
                filter="pending"
              />
            </TabsContent>

            <TabsContent value="paid" className="space-y-4">
              <PaymentTable 
                payments={payments?.filter(p => p.status === "paid") || []} 
                config={config}
                filter="paid"
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Configuration Modal */}
      {showConfig && (
        <PaymentConfigModal 
          config={config}
          onClose={() => setShowConfig(false)}
        />
      )}
    </div>
  );
}
```

### Payment Configuration Modal

```typescript
// components/admin/PaymentConfigModal.tsx

import React, { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function PaymentConfigModal({ config, onClose }) {
  const updateConfig = useMutation(api.royalty.config.updateDeveloperConfig);
  const [payoutMethod, setPayoutMethod] = useState(config?.payoutMethod || 'manual');
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    stripeConnectAccountId: config?.stripeConnectAccountId || '',
    bankDetails: config?.bankDetails || {
      accountName: '',
      accountNumber: '',
      routingNumber: '',
      bankName: '',
      swift: '',
    },
    paypalEmail: config?.paypalEmail || '',
    preferredPaymentMethod: config?.preferredPaymentMethod || 'bank',
  });

  const handleSave = async () => {
    setLoading(true);
    try {
      await updateConfig({
        payoutMethod,
        ...formData,
      });
      onClose();
    } catch (error) {
      console.error('Failed to update config:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Payment Configuration</DialogTitle>
          <DialogDescription>
            Configure how you want to receive your royalty payments
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-4">
            <Label>Payment Method</Label>
            <RadioGroup value={payoutMethod} onValueChange={setPayoutMethod}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="automatic" id="automatic" />
                <Label htmlFor="automatic" className="flex-1">
                  <div className="font-medium">Automatic (Stripe Connect)</div>
                  <div className="text-sm text-muted-foreground">
                    Receive payments automatically on the 15th of each month
                  </div>
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="manual" id="manual" />
                <Label htmlFor="manual" className="flex-1">
                  <div className="font-medium">Manual</div>
                  <div className="text-sm text-muted-foreground">
                    View payment details and receive payments manually
                  </div>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {payoutMethod === 'automatic' ? (
            <div className="space-y-4">
              <Label>Stripe Connect Setup</Label>
              {!config?.stripeConnectAccountId ? (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Click the button below to connect your Stripe account and enable automatic payments.
                  </p>
                  <Button 
                    onClick={() => window.open('/api/stripe/connect', '_blank')}
                    className="w-full"
                  >
                    Connect Stripe Account
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-sm">Stripe account connected</span>
                  </div>
                  <Input
                    value={formData.stripeConnectAccountId}
                    disabled
                    placeholder="acct_..."
                  />
                </div>
              )}
            </div>
          ) : (
            <Tabs defaultValue="bank" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="bank">Bank Transfer</TabsTrigger>
                <TabsTrigger value="paypal">PayPal</TabsTrigger>
                <TabsTrigger value="other">Other</TabsTrigger>
              </TabsList>

              <TabsContent value="bank" className="space-y-4">
                <div className="grid gap-4">
                  <div>
                    <Label htmlFor="accountName">Account Name</Label>
                    <Input
                      id="accountName"
                      value={formData.bankDetails.accountName}
                      onChange={(e) => setFormData({
                        ...formData,
                        bankDetails: {
                          ...formData.bankDetails,
                          accountName: e.target.value
                        }
                      })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="bankName">Bank Name</Label>
                    <Input
                      id="bankName"
                      value={formData.bankDetails.bankName}
                      onChange={(e) => setFormData({
                        ...formData,
                        bankDetails: {
                          ...formData.bankDetails,
                          bankName: e.target.value
                        }
                      })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="accountNumber">Account Number</Label>
                    <Input
                      id="accountNumber"
                      type="password"
                      value={formData.bankDetails.accountNumber}
                      onChange={(e) => setFormData({
                        ...formData,
                        bankDetails: {
                          ...formData.bankDetails,
                          accountNumber: e.target.value
                        }
                      })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="routingNumber">Routing Number</Label>
                    <Input
                      id="routingNumber"
                      value={formData.bankDetails.routingNumber}
                      onChange={(e) => setFormData({
                        ...formData,
                        bankDetails: {
                          ...formData.bankDetails,
                          routingNumber: e.target.value
                        }
                      })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="swift">SWIFT Code (International)</Label>
                    <Input
                      id="swift"
                      value={formData.bankDetails.swift}
                      onChange={(e) => setFormData({
                        ...formData,
                        bankDetails: {
                          ...formData.bankDetails,
                          swift: e.target.value
                        }
                      })}
                    />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="paypal" className="space-y-4">
                <div>
                  <Label htmlFor="paypalEmail">PayPal Email</Label>
                  <Input
                    id="paypalEmail"
                    type="email"
                    value={formData.paypalEmail}
                    onChange={(e) => setFormData({
                      ...formData,
                      paypalEmail: e.target.value,
                      preferredPaymentMethod: 'paypal'
                    })}
                    placeholder="your@email.com"
                  />
                </div>
              </TabsContent>

              <TabsContent value="other" className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Please contact support to arrange alternative payment methods such as 
                  cryptocurrency or check payments.
                </p>
                <Button variant="outline" className="w-full">
                  Contact Support
                </Button>
              </TabsContent>
            </Tabs>
          )}
        </div>

        <div className="flex justify-end space-x-2 mt-6">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? 'Saving...' : 'Save Configuration'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

### Payment Table Component

```typescript
// components/admin/PaymentTable.tsx

import React from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Download, MoreVertical, Eye, CreditCard } from 'lucide-react';

export function PaymentTable({ payments, config, filter }) {
  const handleExport = (payment) => {
    // Generate invoice/receipt PDF
    window.open(`/api/royalty/invoice/${payment._id}`, '_blank');
  };

  const handleViewDetails = (payment) => {
    // Open payment details modal
  };

  const getStatusBadge = (status) => {
    const variants = {
      pending: 'outline',
      processing: 'secondary',
      paid: 'success',
      failed: 'destructive',
    };
    
    return (
      <Badge variant={variants[status] || 'default'}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount / 100);
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Period</TableHead>
          <TableHead>Revenue</TableHead>
          <TableHead>Royalty (5%)</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Payment Method</TableHead>
          <TableHead>Due Date</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {payments.map((payment) => (
          <TableRow key={payment._id}>
            <TableCell className="font-medium">
              {format(new Date(payment.month + '-01'), 'MMMM yyyy')}
            </TableCell>
            <TableCell>{formatCurrency(payment.totalRevenue)}</TableCell>
            <TableCell className="font-semibold">
              {formatCurrency(payment.royaltyAmount)}
            </TableCell>
            <TableCell>{getStatusBadge(payment.status)}</TableCell>
            <TableCell>
              {payment.status === 'paid' ? (
                payment.paymentMethod || 'N/A'
              ) : config?.payoutMethod === 'automatic' ? (
                <div className="flex items-center space-x-1">
                  <CreditCard className="h-3 w-3" />
                  <span className="text-sm">Automatic</span>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">
                  {config?.preferredPaymentMethod || 'Manual'}
                </span>
              )}
            </TableCell>
            <TableCell>
              {format(new Date(payment.dueDate), 'MMM d, yyyy')}
            </TableCell>
            <TableCell className="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="h-8 w-8 p-0">
                    <span className="sr-only">Open menu</span>
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleViewDetails(payment)}>
                    <Eye className="mr-2 h-4 w-4" />
                    View Details
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport(payment)}>
                    <Download className="mr-2 h-4 w-4" />
                    Download Invoice
                  </DropdownMenuItem>
                  {payment.status === 'pending' && config?.payoutMethod === 'manual' && (
                    <DropdownMenuItem>
                      <CreditCard className="mr-2 h-4 w-4" />
                      View Payment Info
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

## Admin Company View

```typescript
// components/admin/CompanyRoyaltyView.tsx

import React from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, AlertCircle } from 'lucide-react';

export function CompanyRoyaltyView() {
  const payments = useQuery(api.royalty.admin.getAllPayments);
  const pendingPayments = payments?.filter(p => p.status === 'pending') || [];
  const markAsPaid = useMutation(api.royalty.admin.markAsPaid);

  const handleMarkAsPaid = async (paymentId, transactionId) => {
    await markAsPaid({ paymentId, transactionId });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Developer Royalty Management</h2>

      {pendingPayments.length > 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            You have {pendingPayments.length} pending royalty payment(s) totaling 
            ${pendingPayments.reduce((sum, p) => sum + p.royaltyAmount, 0) / 100}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Royalty Payment Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {payments?.map((payment) => (
              <div key={payment._id} className="border rounded-lg p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-medium">
                      {format(new Date(payment.month + '-01'), 'MMMM yyyy')}
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      Revenue: ${payment.totalRevenue / 100} → 
                      Royalty: ${payment.royaltyAmount / 100}
                    </p>
                  </div>
                  <div className="text-right">
                    {payment.status === 'paid' ? (
                      <div className="flex items-center space-x-2 text-green-600">
                        <CheckCircle className="h-4 w-4" />
                        <span>Paid</span>
                      </div>
                    ) : payment.paymentMethod === 'automatic' ? (
                      <Badge>Auto-pay scheduled</Badge>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => {
                          const txId = prompt('Enter transaction ID:');
                          if (txId) handleMarkAsPaid(payment._id, txId);
                        }}
                      >
                        Mark as Paid
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

## Implementation Steps

### Phase 1: Database & Core Logic (Week 1)
1. Add royalty tables to schema
2. Implement revenue tracking webhook
3. Create monthly calculation cron job
4. Build developer config API

### Phase 2: Developer Dashboard (Week 2)
1. Create royalty dashboard UI
2. Implement payment configuration modal
3. Add payment history table
4. Build export functionality

### Phase 3: Payment Processing (Week 3)
1. Integrate Stripe Connect OAuth
2. Implement automatic payment flow
3. Add manual payment tracking
4. Create invoice generation

### Phase 4: Admin Tools (Week 4)
1. Build admin royalty view
2. Add manual payment marking
3. Implement audit logging
4. Create dispute resolution flow

### Phase 5: Testing & Polish (Week 5)
1. Test all payment scenarios
2. Add comprehensive error handling
3. Implement notifications
4. Create documentation

## Security Considerations

1. **Access Control**
   - Only developers can view their own royalty data
   - Admins can view all payments but not modify calculations
   - Audit log for all actions

2. **Data Integrity**
   - Immutable revenue records
   - Cryptographic verification of calculations
   - Stripe webhook signature validation

3. **Payment Security**
   - PCI compliance via Stripe
   - Encrypted storage of bank details
   - Two-factor authentication for changes

4. **Transparency**
   - Public API for revenue verification
   - Detailed breakdown of all charges
   - Monthly statements with full details

## Monitoring & Alerts

1. **Automated Alerts**
   - New royalty calculation completed
   - Payment due reminders (3 days before)
   - Payment processed notifications
   - Failed payment alerts

2. **Dashboard Metrics**
   - Real-time revenue tracking
   - Payment success rate
   - Average payment time
   - Dispute rate

3. **Compliance Tracking**
   - Tax document generation (1099s)
   - Payment history exports
   - Audit trail reports

This implementation provides a complete, transparent, and automated royalty system that protects both the developer and the company while minimizing manual intervention.