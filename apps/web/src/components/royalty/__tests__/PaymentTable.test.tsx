import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaymentTable } from '../PaymentTable';
import { 
  mockRoyaltyPayments, 
  mockDeveloperConfig,
  mockDeveloperConfigManual,
  mockPendingPayments,
  mockPaidPayments 
} from './mockData';

// Mock window.open for export functionality
const mockWindowOpen = jest.fn();
Object.defineProperty(window, 'open', {
  writable: true,
  value: mockWindowOpen,
});

describe('PaymentTable', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders payment table with all payments', () => {
    render(
      <PaymentTable 
        payments={mockRoyaltyPayments} 
        config={mockDeveloperConfig}
        filter="all"
      />
    );

    expect(screen.getByText('Period')).toBeInTheDocument();
    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.getByText('Royalty (5%)')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Payment Method')).toBeInTheDocument();
    expect(screen.getByText('Due Date')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();
  });

  it('displays payment data correctly', () => {
    render(
      <PaymentTable 
        payments={mockRoyaltyPayments} 
        config={mockDeveloperConfig}
        filter="all"
      />
    );

    // Check for payment periods
    expect(screen.getByText('January 2025')).toBeInTheDocument();
    expect(screen.getByText('December 2024')).toBeInTheDocument();
    expect(screen.getByText('November 2024')).toBeInTheDocument();

    // Check for currency formatting
    expect(screen.getByText('$5,000.00')).toBeInTheDocument();
    expect(screen.getByText('$250.00')).toBeInTheDocument();
  });

  it('shows correct status badges', () => {
    render(
      <PaymentTable 
        payments={mockRoyaltyPayments} 
        config={mockDeveloperConfig}
        filter="all"
      />
    );

    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('displays automatic payment method for Stripe Connect', () => {
    render(
      <PaymentTable 
        payments={mockPendingPayments} 
        config={mockDeveloperConfig}
        filter="pending"
      />
    );

    expect(screen.getByText('Automatic')).toBeInTheDocument();
  });

  it('displays manual payment method when configured', () => {
    render(
      <PaymentTable 
        payments={mockPendingPayments} 
        config={mockDeveloperConfigManual}
        filter="pending"
      />
    );

    expect(screen.getByText('bank')).toBeInTheDocument();
  });

  it('shows empty state when no payments', () => {
    render(
      <PaymentTable 
        payments={[]} 
        config={mockDeveloperConfig}
        filter="all"
      />
    );

    expect(screen.getByText('No payments found for the selected filter.')).toBeInTheDocument();
  });

  it('opens action menu and handles export', () => {
    render(
      <PaymentTable 
        payments={mockRoyaltyPayments} 
        config={mockDeveloperConfig}
        filter="all"
      />
    );

    // Click first action menu button
    const actionButtons = screen.getAllByLabelText('Open menu');
    fireEvent.click(actionButtons[0]);

    expect(screen.getByText('View Details')).toBeInTheDocument();
    expect(screen.getByText('Download Invoice')).toBeInTheDocument();

    // Test export functionality
    fireEvent.click(screen.getByText('Download Invoice'));
    expect(mockWindowOpen).toHaveBeenCalledWith('/api/royalty/invoice/payment_1', '_blank');
  });

  it('shows payment info option for manual pending payments', () => {
    render(
      <PaymentTable 
        payments={mockPendingPayments} 
        config={mockDeveloperConfigManual}
        filter="pending"
      />
    );

    // Click action menu
    const actionButton = screen.getByLabelText('Open menu');
    fireEvent.click(actionButton);

    expect(screen.getByText('View Payment Info')).toBeInTheDocument();
  });

  it('does not show payment info for automatic payments', () => {
    render(
      <PaymentTable 
        payments={mockPendingPayments} 
        config={mockDeveloperConfig}
        filter="pending"
      />
    );

    // Click action menu
    const actionButton = screen.getByLabelText('Open menu');
    fireEvent.click(actionButton);

    expect(screen.queryByText('View Payment Info')).not.toBeInTheDocument();
  });

  it('formats due dates correctly', () => {
    render(
      <PaymentTable 
        payments={mockRoyaltyPayments} 
        config={mockDeveloperConfig}
        filter="all"
      />
    );

    // Check that dates are formatted properly (should contain month abbreviations)
    const dateElements = screen.getAllByText(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    expect(dateElements.length).toBeGreaterThan(0);
  });

  it('handles view details action', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    
    render(
      <PaymentTable 
        payments={mockRoyaltyPayments} 
        config={mockDeveloperConfig}
        filter="all"
      />
    );

    // Click first action menu button
    const actionButtons = screen.getAllByLabelText('Open menu');
    fireEvent.click(actionButtons[0]);

    // Click view details
    fireEvent.click(screen.getByText('View Details'));
    
    expect(consoleSpy).toHaveBeenCalledWith('View details for payment:', 'payment_1');
    
    consoleSpy.mockRestore();
  });
});