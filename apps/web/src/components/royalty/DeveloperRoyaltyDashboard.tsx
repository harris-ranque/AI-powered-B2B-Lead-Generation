import React, { useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { 
  DollarSign, 
  TrendingUp, 
  CreditCard, 
  Download,
  Settings,
  AlertCircle,
  CheckCircle
} from 'lucide-react';
import { PaymentTable } from './PaymentTable';
import { PaymentConfigModal } from './PaymentConfigModal';
import { RoyaltyStats, DeveloperConfig, RoyaltyPayment } from '@shared/royalty.types';

import { api } from '../../../../convex/_generated/api';

export function DeveloperRoyaltyDashboard() {
  const config = useQuery(api.royalty.config.getDeveloperConfig) as DeveloperConfig | null;
  const stats = useQuery(api.royalty.dashboard.getStats) as RoyaltyStats | null;
  const payments = useQuery(api.royalty.dashboard.getPayments) as RoyaltyPayment[] | null;
  const [showConfig, setShowConfig] = useState(false);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount / 100);
  };

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
              {formatCurrency(stats?.lifetimeEarnings || 0)}
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
              {formatCurrency(stats?.pendingAmount || 0)}
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
              {formatCurrency(stats?.currentMonthEarnings || 0)}
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
              {formatCurrency(stats?.averageMonthly || 0)}
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