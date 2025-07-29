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
import { RoyaltyPayment, DeveloperConfig, PaymentFilter } from '@/shared-types-local/royalty.types';

interface PaymentTableProps {
  payments: RoyaltyPayment[];
  config: DeveloperConfig | null;
  filter: PaymentFilter;
}

export function PaymentTable({ payments, config, filter }: PaymentTableProps) {
  const handleExport = (payment: RoyaltyPayment) => {
    // Generate invoice/receipt PDF
    window.open(`/api/royalty/invoice/${payment._id}`, '_blank');
  };

  const handleViewDetails = (payment: RoyaltyPayment) => {
    // Open payment details modal
    console.log('View details for payment:', payment._id);
  };

  const getStatusBadge = (status: RoyaltyPayment['status']) => {
    const variants = {
      calculating: 'secondary',
      pending: 'outline',
      processing: 'secondary',
      paid: 'default',
      failed: 'destructive',
      disputed: 'destructive',
    } as const;

    const colors = {
      calculating: 'bg-blue-100 text-blue-800',
      pending: 'bg-yellow-100 text-yellow-800',
      processing: 'bg-blue-100 text-blue-800',
      paid: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
      disputed: 'bg-red-100 text-red-800',
    };
    
    return (
      <Badge variant={variants[status]} className={colors[status]}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount / 100);
  };

  if (payments.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No payments found for the selected filter.
      </div>
    );
  }

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