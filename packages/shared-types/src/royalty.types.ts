export interface DeveloperConfig {
  developerId: string;
  email: string;
  name: string;
  royaltyPercentage: number; // e.g., 0.05 for 5%
  paymentMethod: 'stripe' | 'paypal' | 'bank_transfer';
  paymentDetails: {
    stripeAccountId?: string;
    paypalEmail?: string;
    bankAccount?: {
      accountNumber: string;
      routingNumber: string;
      accountHolderName: string;
    };
  };
  taxInfo: {
    taxId?: string;
    country: string;
    taxExempt: boolean;
  };
  isActive: boolean;
  createdAt: number;
}

export interface RevenueTracking {
  id: string;
  month: string; // YYYY-MM format
  totalRevenue: number;
  royaltyAmount: number;
  developerId: string;
  status: 'pending' | 'calculated' | 'paid' | 'failed';
  paymentDate?: number;
  paymentReference?: string;
  breakdown: {
    subscriptions: number;
    oneTimePayments: number;
    refunds: number;
  };
  createdAt: number;
}

export interface RoyaltyPayment {
  id: string;
  developerId: string;
  amount: number;
  currency: 'USD';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  paymentMethod: string;
  paymentReference?: string;
  monthsCovered: string[]; // Array of YYYY-MM strings
  taxWithheld?: number;
  createdAt: number;
  completedAt?: number;
  failureReason?: string;
}