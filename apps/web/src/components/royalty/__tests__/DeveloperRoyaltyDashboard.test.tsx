import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConvexProvider, ConvexReactClient } from 'convex/react';
import { DeveloperRoyaltyDashboard } from '../DeveloperRoyaltyDashboard';
import { 
  mockDeveloperConfig, 
  mockRoyaltyStats, 
  mockRoyaltyPayments,
  mockDeveloperConfigManual,
  mockDeveloperConfigPending 
} from './mockData';

// Mock the Convex API
jest.mock('../../../../../convex/_generated/api', () => ({
  api: {
    royalty: {
      config: {
        getDeveloperConfig: 'getDeveloperConfig',
        updateDeveloperConfig: 'updateDeveloperConfig',
      },
      dashboard: {
        getStats: 'getStats',
        getPayments: 'getPayments',
      },
    },
  },
}));

const mockConvexClient = new ConvexReactClient('https://test.convex.dev');

const renderWithConvex = (component: React.ReactElement) => {
  return render(
    <ConvexProvider client={mockConvexClient}>
      {component}
    </ConvexProvider>
  );
};

// Mock useQuery and useMutation
const mockUseQuery = jest.fn();
const mockUseMutation = jest.fn();

jest.mock('convex/react', () => ({
  ...jest.requireActual('convex/react'),
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
}));

describe('DeveloperRoyaltyDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseQuery.mockImplementation((query) => {
      if (query === 'getDeveloperConfig') return mockDeveloperConfig;
      if (query === 'getStats') return mockRoyaltyStats;
      if (query === 'getPayments') return mockRoyaltyPayments;
      return null;
    });
    mockUseMutation.mockReturnValue(jest.fn());
  });

  it('renders dashboard with stats correctly', () => {
    renderWithConvex(<DeveloperRoyaltyDashboard />);

    expect(screen.getByText('Developer Royalty Dashboard')).toBeInTheDocument();
    expect(screen.getByText('$1,250.00')).toBeInTheDocument(); // Lifetime earnings
    expect(screen.getByText('$450.00')).toBeInTheDocument();   // Pending amount
    expect(screen.getByText('$250.00')).toBeInTheDocument();   // Current month
    expect(screen.getByText('$187.50')).toBeInTheDocument();   // Average monthly
  });

  it('displays setup alert for automatic payment without Stripe Connect', () => {
    mockUseQuery.mockImplementation((query) => {
      if (query === 'getDeveloperConfig') return mockDeveloperConfigPending;
      if (query === 'getStats') return mockRoyaltyStats;
      if (query === 'getPayments') return mockRoyaltyPayments;
      return null;
    });

    renderWithConvex(<DeveloperRoyaltyDashboard />);

    expect(screen.getByText('Setup Required')).toBeInTheDocument();
    expect(screen.getByText(/Please complete your Stripe Connect setup/)).toBeInTheDocument();
  });

  it('does not show setup alert for manual payment method', () => {
    mockUseQuery.mockImplementation((query) => {
      if (query === 'getDeveloperConfig') return mockDeveloperConfigManual;
      if (query === 'getStats') return mockRoyaltyStats;
      if (query === 'getPayments') return mockRoyaltyPayments;
      return null;
    });

    renderWithConvex(<DeveloperRoyaltyDashboard />);

    expect(screen.queryByText('Setup Required')).not.toBeInTheDocument();
  });

  it('opens payment settings modal when button is clicked', () => {
    renderWithConvex(<DeveloperRoyaltyDashboard />);

    const settingsButton = screen.getByRole('button', { name: /Payment Settings/i });
    fireEvent.click(settingsButton);

    expect(screen.getByText('Payment Configuration')).toBeInTheDocument();
  });

  it('displays payment history tabs', () => {
    renderWithConvex(<DeveloperRoyaltyDashboard />);

    expect(screen.getByRole('tab', { name: 'All Payments' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pending' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Paid' })).toBeInTheDocument();
  });

  it('filters payments correctly by tab', () => {
    renderWithConvex(<DeveloperRoyaltyDashboard />);

    // Click on Pending tab
    fireEvent.click(screen.getByRole('tab', { name: 'Pending' }));
    
    // Should show pending payments only
    expect(screen.getByText('January 2025')).toBeInTheDocument();
    
    // Click on Paid tab
    fireEvent.click(screen.getByRole('tab', { name: 'Paid' }));
    
    // Should show paid payments
    expect(screen.getByText('December 2024')).toBeInTheDocument();
    expect(screen.getByText('November 2024')).toBeInTheDocument();
  });

  it('formats currency correctly', () => {
    renderWithConvex(<DeveloperRoyaltyDashboard />);

    // Check for properly formatted currency values
    expect(screen.getByText('$5,000.00')).toBeInTheDocument(); // Total revenue
    expect(screen.getByText('$250.00')).toBeInTheDocument();   // Royalty amount
  });

  it('handles loading state when data is null', () => {
    mockUseQuery.mockReturnValue(null);

    renderWithConvex(<DeveloperRoyaltyDashboard />);

    expect(screen.getByText('Developer Royalty Dashboard')).toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument();
  });

  it('closes payment config modal when cancel is clicked', async () => {
    renderWithConvex(<DeveloperRoyaltyDashboard />);

    // Open modal
    const settingsButton = screen.getByRole('button', { name: /Payment Settings/i });
    fireEvent.click(settingsButton);

    expect(screen.getByText('Payment Configuration')).toBeInTheDocument();

    // Close modal
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(screen.queryByText('Payment Configuration')).not.toBeInTheDocument();
    });
  });
});