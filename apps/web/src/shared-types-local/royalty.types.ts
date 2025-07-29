// Developer configuration and payout settings
export interface DeveloperConfig {
  _id: string;
  developerId: string;
  stripeConnectAccountId?: string;
  stripeConnectStatus?: 'pending' | 'active' | 'rejected';
  payoutMethod: 'automatic' | 'manual';
  bankDetails?: {
    accountName: string;
    accountNumber: string;
    routingNumber: string;
    bankName: string;
    swift?: string;
  };
  paypalEmail?: string;
  preferredPaymentMethod?: 'bank' | 'paypal' | 'crypto' | 'check';
  taxInfo?: {
    taxId: string;
    businessName?: string;
    address: {
      street: string;
      city: string;
      state: string;
      zip: string;
      country: string;
    };
  };
  createdAt: number;
  updatedAt: number;
}

// Revenue tracking for royalty calculations
export interface RevenueTracking {
  _id: string;
  date: string; // YYYY-MM-DD
  type: 'subscription' | 'one_time' | 'addon' | 'refund';
  amount: number; // In cents
  currency: string;
  customerId: string;
  subscriptionId?: string;
  invoiceId?: string;
  description: string;
  stripeEventId: string; // For idempotency
  metadata: Record<string, any>;
}

// Monthly royalty calculations and payment tracking
export interface RoyaltyPayment {
  _id: string;
  month: string; // YYYY-MM
  startDate: string;
  endDate: string;
  totalRevenue: number; // In cents
  royaltyRate: number; // 0.05 for 5%
  royaltyAmount: number; // In cents
  currency: string;
  status: 'calculating' | 'pending' | 'processing' | 'paid' | 'failed' | 'disputed';
  paymentMethod?: 'stripe_connect' | 'bank_transfer' | 'paypal' | 'other';
  paymentDetails?: {
    transactionId?: string;
    paidAt?: number;
    failureReason?: string;
    notes?: string;
  };
  breakdown: Array<{
    type: string;
    count: number;
    amount: number;
  }>;
  createdAt: number;
  dueDate: number; // 15th of following month
}

// Audit log for all royalty-related actions
export interface RoyaltyAuditLog {
  _id: string;
  timestamp: number;
  action: 'revenue_recorded' | 'royalty_calculated' | 'payment_initiated' | 'payment_completed' | 'payment_failed' | 'config_updated' | 'manual_adjustment';
  performedBy: string; // User ID
  details: Record<string, any>;
  ipAddress?: string;
}

// Dashboard statistics
export interface RoyaltyStats {
  lifetimeEarnings: number;
  pendingAmount: number;
  currentMonthEarnings: number;
  averageMonthly: number;
  percentageChange: number;
  firstPaymentDate?: string;
  nextPaymentDate?: string;
}

// Payment table filter types
export type PaymentFilter = 'all' | 'pending' | 'paid' | 'failed';

// Stripe Connect OAuth response
export interface StripeConnectResponse {
  success: boolean;
  accountId?: string;
  error?: string;
}

// Export/Invoice data
export interface InvoiceData {
  paymentId: string;
  month: string;
  amount: number;
  currency: string;
  breakdown: Array<{
    type: string;
    count: number;
    amount: number;
  }>;
  generatedAt: number;
}

// Admin view interfaces
export interface AdminRoyaltyOverview {
  totalPendingPayments: number;
  totalPendingAmount: number;
  monthlyRevenue: number;
  royaltyRate: number;
  nextPaymentDate: string;
}
