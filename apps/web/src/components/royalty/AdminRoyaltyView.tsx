import React from 'react';
import { useQuery, useMutation } from 'convex/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, AlertCircle, DollarSign, Users, Calendar, TrendingUp } from 'lucide-react';
import { format } from 'date-fns';
import { RoyaltyPayment, AdminRoyaltyOverview } from '@shared';

import { api } from "@genni/convex-types"

export function AdminRoyaltyView() {
  const payments = useQuery(api.royalty.admin.getAllPayments) as RoyaltyPayment[] | null;
  const overview = useQuery(api.royalty.admin.getOverview) as AdminRoyaltyOverview | null;
  const markAsPaid = useMutation(api.royalty.admin.markAsPaid);

  const pendingPayments = payments?.filter(p => p.status === 'pending') || [];
  const totalPendingAmount = pendingPayments.reduce((sum, p) => sum + p.royaltyAmount, 0);

  const handleMarkAsPaid = async (paymentId: string) => {
    const transactionId = prompt('Enter transaction ID:');
    if (transactionId) {
      try {
        await markAsPaid({ paymentId, transactionId });
      } catch (error) {
        console.error('Failed to mark payment as paid:', error);
      }
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount / 100);
  };

  const getStatusBadge = (status: RoyaltyPayment['status']) => {
    const colors = {
      calculating: 'bg-blue-100 text-blue-800',
      pending: 'bg-yellow-100 text-yellow-800',
      processing: 'bg-blue-100 text-blue-800',
      paid: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
      disputed: 'bg-red-100 text-red-800',
    };
    
    return (
      <Badge className={colors[status]}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Developer Royalty Management</h2>
        <div className="text-sm text-muted-foreground">
          Last updated: {format(new Date(), 'MMM d, yyyy h:mm a')}
        </div>
      </div>

      {/* Overview Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Pending Payments
            </CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {pendingPayments.length}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(totalPendingAmount)} total
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Monthly Revenue
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(overview?.monthlyRevenue || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              Current month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Royalty Rate
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {((overview?.royaltyRate || 0.05) * 100).toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">
              To developer
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Next Payment
            </CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {overview?.nextPaymentDate ? format(new Date(overview.nextPaymentDate), 'MMM d') : 'N/A'}
            </div>
            <p className="text-xs text-muted-foreground">
              Due date
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Alerts */}
      {pendingPayments.length > 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Action Required</AlertTitle>
          <AlertDescription>
            You have {pendingPayments.length} pending royalty payment(s) totaling {formatCurrency(totalPendingAmount)}. 
            Manual payments need to be processed.
          </AlertDescription>
        </Alert>
      )}

      {/* Payment Management */}
      <Card>
        <CardHeader>
          <CardTitle>Payment Management</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {payments?.map((payment) => (
              <div key={payment._id} className="border rounded-lg p-4">
                <div className="flex justify-between items-start">
                  <div className="space-y-2">
                    <h4 className="font-medium">
                      {format(new Date(payment.month + '-01'), 'MMMM yyyy')}
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      Revenue: {formatCurrency(payment.totalRevenue)} → 
                      Royalty: {formatCurrency(payment.royaltyAmount)}
                    </p>
                    <div className="flex items-center space-x-4">
                      {getStatusBadge(payment.status)}
                      <span className="text-sm text-muted-foreground">
                        Due: {format(new Date(payment.dueDate), 'MMM d, yyyy')}
                      </span>
                    </div>
                    {payment.paymentDetails?.transactionId && (
                      <p className="text-xs text-muted-foreground">
                        Transaction: {payment.paymentDetails.transactionId}
                      </p>
                    )}
                  </div>
                  <div className="text-right space-y-2">
                    {payment.status === 'paid' ? (
                      <div className="flex items-center space-x-2 text-green-600">
                        <CheckCircle className="h-4 w-4" />
                        <span className="text-sm">Paid</span>
                        {payment.paymentDetails?.paidAt && (
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(payment.paymentDetails.paidAt), 'MMM d')}
                          </span>
                        )}
                      </div>
                    ) : payment.paymentMethod === 'automatic' ? (
                      <Badge variant="outline">Auto-pay scheduled</Badge>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => handleMarkAsPaid(payment._id)}
                        disabled={payment.status === 'processing'}
                      >
                        {payment.status === 'processing' ? 'Processing...' : 'Mark as Paid'}
                      </Button>
                    )}
                    
                    {payment.status === 'failed' && payment.paymentDetails?.failureReason && (
                      <p className="text-xs text-red-600">
                        Failed: {payment.paymentDetails.failureReason}
                      </p>
                    )}
                  </div>
                </div>
                
                {/* Payment Breakdown */}
                <div className="mt-4 pt-4 border-t">
                  <p className="text-sm font-medium mb-2">Revenue Breakdown:</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    {payment.breakdown.map((item, index) => (
                      <div key={index} className="bg-muted p-2 rounded">
                        <div className="font-medium capitalize">{item.type}</div>
                        <div>{item.count} items</div>
                        <div className="text-muted-foreground">{formatCurrency(item.amount)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            
            {!payments?.length && (
              <div className="text-center py-8 text-muted-foreground">
                No royalty payments found.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}