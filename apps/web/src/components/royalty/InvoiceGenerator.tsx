import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Download, FileText, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { RoyaltyPayment, InvoiceData } from '@shared';

interface InvoiceGeneratorProps {
  payment: RoyaltyPayment;
  config?: {
    companyName?: string;
    companyAddress?: string;
    developerName?: string;
    developerAddress?: string;
  };
}

export function InvoiceGenerator({ payment, config }: InvoiceGeneratorProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount / 100);
  };

  const generatePDF = () => {
    // In a real implementation, this would generate a proper PDF
    // For now, we'll create a printable HTML version
    const invoiceWindow = window.open('', '_blank');
    if (!invoiceWindow) return;

    const invoiceHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Royalty Invoice - ${payment.month}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
          .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
          .company-info { text-align: left; }
          .invoice-info { text-align: right; }
          .invoice-title { font-size: 24px; font-weight: bold; margin-bottom: 20px; }
          .section { margin-bottom: 30px; }
          .table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          .table th, .table td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
          .table th { background-color: #f8f9fa; font-weight: bold; }
          .total-section { background-color: #f8f9fa; padding: 20px; margin-top: 20px; }
          .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
          @media print { body { margin: 20px; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="company-info">
            <h2>${config?.companyName || 'Genni AI'}</h2>
            <p>${config?.companyAddress || 'San Francisco, CA'}</p>
          </div>
          <div class="invoice-info">
            <div class="invoice-title">ROYALTY STATEMENT</div>
            <p><strong>Invoice ID:</strong> ${payment._id}</p>
            <p><strong>Period:</strong> ${format(new Date(payment.month + '-01'), 'MMMM yyyy')}</p>
            <p><strong>Date:</strong> ${format(new Date(payment.createdAt), 'MMM d, yyyy')}</p>
            <p><strong>Due Date:</strong> ${format(new Date(payment.dueDate), 'MMM d, yyyy')}</p>
          </div>
        </div>

        <div class="section">
          <h3>Bill To:</h3>
          <p><strong>${config?.developerName || 'Developer'}</strong></p>
          <p>${config?.developerAddress || 'Developer Address'}</p>
        </div>

        <div class="section">
          <h3>Revenue Breakdown</h3>
          <table class="table">
            <thead>
              <tr>
                <th>Revenue Type</th>
                <th>Count</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              ${payment.breakdown.map(item => `
                <tr>
                  <td style="text-transform: capitalize;">${item.type.replace('_', ' ')}</td>
                  <td>${item.count}</td>
                  <td>${formatCurrency(item.amount)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="total-section">
          <table class="table" style="margin: 0;">
            <tr>
              <td><strong>Total Revenue</strong></td>
              <td style="text-align: right;"><strong>${formatCurrency(payment.totalRevenue)}</strong></td>
            </tr>
            <tr>
              <td><strong>Royalty Rate</strong></td>
              <td style="text-align: right;"><strong>${(payment.royaltyRate * 100).toFixed(1)}%</strong></td>
            </tr>
            <tr style="font-size: 18px; background-color: #e3f2fd;">
              <td><strong>Royalty Amount Due</strong></td>
              <td style="text-align: right;"><strong>${formatCurrency(payment.royaltyAmount)}</strong></td>
            </tr>
          </table>
        </div>

        ${payment.paymentDetails?.transactionId ? `
          <div class="section">
            <h3>Payment Information</h3>
            <p><strong>Transaction ID:</strong> ${payment.paymentDetails.transactionId}</p>
            ${payment.paymentDetails.paidAt ? `<p><strong>Paid On:</strong> ${format(new Date(payment.paymentDetails.paidAt), 'MMM d, yyyy')}</p>` : ''}
            ${payment.paymentDetails.notes ? `<p><strong>Notes:</strong> ${payment.paymentDetails.notes}</p>` : ''}
          </div>
        ` : ''}

        <div class="footer">
          <p>This is an automated royalty statement. For questions, please contact support.</p>
          <p>Generated on ${format(new Date(), 'MMM d, yyyy h:mm a')}</p>
        </div>
      </body>
      </html>
    `;

    invoiceWindow.document.write(invoiceHTML);
    invoiceWindow.document.close();
  };

  const downloadCSV = () => {
    const csvData = [
      ['Royalty Statement', payment.month],
      ['Period', `${payment.startDate} to ${payment.endDate}`],
      ['Total Revenue', formatCurrency(payment.totalRevenue)],
      ['Royalty Rate', `${(payment.royaltyRate * 100).toFixed(1)}%`],
      ['Royalty Amount', formatCurrency(payment.royaltyAmount)],
      ['Status', payment.status],
      [''],
      ['Revenue Breakdown'],
      ['Type', 'Count', 'Amount'],
      ...payment.breakdown.map(item => [
        item.type.replace('_', ' '),
        item.count.toString(),
        formatCurrency(item.amount)
      ])
    ];

    const csvContent = csvData.map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `royalty-statement-${payment.month}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <FileText className="h-5 w-5" />
          <span>Invoice & Export</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <label className="font-medium">Period:</label>
            <p>{format(new Date(payment.month + '-01'), 'MMMM yyyy')}</p>
          </div>
          <div>
            <label className="font-medium">Status:</label>
            <div className="mt-1">
              <Badge 
                variant={payment.status === 'paid' ? 'default' : 'outline'}
                className={payment.status === 'paid' ? 'bg-green-100 text-green-800' : ''}
              >
                {payment.status.charAt(0).toUpperCase() + payment.status.slice(1)}
              </Badge>
            </div>
          </div>
          <div>
            <label className="font-medium">Total Revenue:</label>
            <p className="font-mono">{formatCurrency(payment.totalRevenue)}</p>
          </div>
          <div>
            <label className="font-medium">Royalty Amount:</label>
            <p className="font-mono font-bold">{formatCurrency(payment.royaltyAmount)}</p>
          </div>
        </div>

        <div className="border-t pt-4">
          <h4 className="font-medium mb-2">Export Options</h4>
          <div className="flex space-x-2">
            <Button 
              onClick={generatePDF}
              size="sm"
              variant="outline"
              className="flex items-center space-x-1"
            >
              <FileText className="h-4 w-4" />
              <span>View Invoice</span>
            </Button>
            <Button 
              onClick={downloadCSV}
              size="sm"
              variant="outline"
              className="flex items-center space-x-1"
            >
              <Download className="h-4 w-4" />
              <span>Download CSV</span>
            </Button>
          </div>
        </div>

        {payment.paymentDetails?.transactionId && (
          <div className="border-t pt-4">
            <h4 className="font-medium mb-2">Payment Details</h4>
            <div className="text-sm space-y-1">
              <p><span className="font-medium">Transaction ID:</span> {payment.paymentDetails.transactionId}</p>
              {payment.paymentDetails.paidAt && (
                <p><span className="font-medium">Paid On:</span> {format(new Date(payment.paymentDetails.paidAt), 'MMM d, yyyy')}</p>
              )}
              {payment.paymentDetails.notes && (
                <p><span className="font-medium">Notes:</span> {payment.paymentDetails.notes}</p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}