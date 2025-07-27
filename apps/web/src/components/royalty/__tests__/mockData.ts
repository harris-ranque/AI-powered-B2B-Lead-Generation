import { DeveloperConfig, RoyaltyPayment, RoyaltyStats, AdminRoyaltyOverview } from '@shared/royalty.types';

// Mock data for testing royalty components
export const mockDeveloperConfig: DeveloperConfig = {
  _id: 'config_123',
  developerId: 'dev_456',
  stripeConnectAccountId: 'acct_1234567890',
  stripeConnectStatus: 'active',
  payoutMethod: 'automatic',
  bankDetails: {
    accountName: 'John Developer',
    accountNumber: '****1234',
    routingNumber: '123456789',
    bankName: 'Chase Bank',
    swift: 'CHASUS33',
  },
  paypalEmail: 'developer@example.com',
  preferredPaymentMethod: 'bank',
  taxInfo: {
    taxId: '123-45-6789',
    businessName: 'Dev Solutions LLC',
    address: {
      street: '123 Developer St',
      city: 'San Francisco',
      state: 'CA',
      zip: '94102',
      country: 'US',
    },
  },
  createdAt: Date.now() - 86400000 * 30, // 30 days ago
  updatedAt: Date.now() - 86400000 * 5,  // 5 days ago
};

export const mockRoyaltyStats: RoyaltyStats = {
  lifetimeEarnings: 125000, // $1,250.00 in cents
  pendingAmount: 45000,     // $450.00 in cents
  currentMonthEarnings: 25000, // $250.00 in cents
  averageMonthly: 18750,    // $187.50 in cents
  percentageChange: 15.5,
  firstPaymentDate: '2024-01-15',
  nextPaymentDate: '2025-02-15',
};

export const mockRoyaltyPayments: RoyaltyPayment[] = [
  {
    _id: 'payment_1',
    month: '2025-01',
    startDate: '2025-01-01',
    endDate: '2025-01-31',
    totalRevenue: 500000, // $5,000 in cents
    royaltyRate: 0.05,
    royaltyAmount: 25000, // $250 in cents
    currency: 'usd',
    status: 'pending',
    breakdown: [
      { type: 'subscription', count: 45, amount: 450000 },
      { type: 'one_time', count: 5, amount: 50000 },
    ],
    createdAt: Date.now() - 86400000 * 5,
    dueDate: Date.now() + 86400000 * 10, // 10 days from now
  },
  {
    _id: 'payment_2',
    month: '2024-12',
    startDate: '2024-12-01',
    endDate: '2024-12-31',
    totalRevenue: 400000, // $4,000 in cents
    royaltyRate: 0.05,
    royaltyAmount: 20000, // $200 in cents
    currency: 'usd',
    status: 'paid',
    paymentMethod: 'stripe_connect',
    paymentDetails: {
      transactionId: 'tr_1234567890',
      paidAt: Date.now() - 86400000 * 15,
    },
    breakdown: [
      { type: 'subscription', count: 38, amount: 380000 },
      { type: 'one_time', count: 2, amount: 20000 },
    ],
    createdAt: Date.now() - 86400000 * 35,
    dueDate: Date.now() - 86400000 * 20,
  },
  {
    _id: 'payment_3',
    month: '2024-11',
    startDate: '2024-11-01',
    endDate: '2024-11-30',
    totalRevenue: 350000, // $3,500 in cents
    royaltyRate: 0.05,
    royaltyAmount: 17500, // $175 in cents
    currency: 'usd',
    status: 'paid',
    paymentMethod: 'bank_transfer',
    paymentDetails: {
      transactionId: 'bank_transfer_001',
      paidAt: Date.now() - 86400000 * 45,
      notes: 'Manual bank transfer processed',
    },
    breakdown: [
      { type: 'subscription', count: 35, amount: 350000 },
    ],
    createdAt: Date.now() - 86400000 * 65,
    dueDate: Date.now() - 86400000 * 50,
  },
  {
    _id: 'payment_4',
    month: '2024-10',
    startDate: '2024-10-01',
    endDate: '2024-10-31',
    totalRevenue: 300000, // $3,000 in cents
    royaltyRate: 0.05,
    royaltyAmount: 15000, // $150 in cents
    currency: 'usd',
    status: 'failed',
    paymentDetails: {
      failureReason: 'Bank account verification failed',
    },
    breakdown: [
      { type: 'subscription', count: 30, amount: 300000 },
    ],
    createdAt: Date.now() - 86400000 * 95,
    dueDate: Date.now() - 86400000 * 80,
  },
];

export const mockAdminOverview: AdminRoyaltyOverview = {
  totalPendingPayments: 1,
  totalPendingAmount: 25000, // $250 in cents
  monthlyRevenue: 500000,    // $5,000 in cents
  royaltyRate: 0.05,
  nextPaymentDate: '2025-02-15',
};

// Mock API functions for testing
export const mockRoyaltyApi = {
  config: {
    getDeveloperConfig: jest.fn().mockResolvedValue(mockDeveloperConfig),
    updateDeveloperConfig: jest.fn().mockResolvedValue(undefined),
  },
  dashboard: {
    getStats: jest.fn().mockResolvedValue(mockRoyaltyStats),
    getPayments: jest.fn().mockResolvedValue(mockRoyaltyPayments),
  },
  admin: {
    getAllPayments: jest.fn().mockResolvedValue(mockRoyaltyPayments),
    getOverview: jest.fn().mockResolvedValue(mockAdminOverview),
    markAsPaid: jest.fn().mockResolvedValue(undefined),
  },
  exports: {
    generateInvoice: jest.fn().mockResolvedValue('/mock/invoice/payment_1.pdf'),
  },
};

// Helper functions for test scenarios
export const mockDeveloperConfigManual: DeveloperConfig = {
  ...mockDeveloperConfig,
  payoutMethod: 'manual',
  stripeConnectAccountId: undefined,
  stripeConnectStatus: undefined,
};

export const mockDeveloperConfigPending: DeveloperConfig = {
  ...mockDeveloperConfig,
  stripeConnectStatus: 'pending',
};

export const mockPendingPayments = mockRoyaltyPayments.filter(p => p.status === 'pending');
export const mockPaidPayments = mockRoyaltyPayments.filter(p => p.status === 'paid');
export const mockFailedPayments = mockRoyaltyPayments.filter(p => p.status === 'failed');