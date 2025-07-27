# Royalty System Components

A complete production-ready royalty management system for the Genni platform with automatic and manual payment processing.

## Components

### DeveloperRoyaltyDashboard
Main dashboard for developers to view earnings, payment history, and configure payment settings.

**Features:**
- Lifetime earnings overview
- Pending payment tracking  
- Monthly revenue trends
- Payment history with filtering
- Integrated payment configuration

**Usage:**
```tsx
import { DeveloperRoyaltyDashboard } from '@/components/royalty';

export function DeveloperPage() {
  return <DeveloperRoyaltyDashboard />;
}
```

### AdminRoyaltyView
Administrative interface for company admins to manage royalty payments.

**Features:**
- Pending payments overview
- Manual payment processing
- Revenue breakdown analysis
- Payment status management

**Usage:**
```tsx
import { AdminRoyaltyView } from '@/components/royalty';

export function AdminPage() {
  return <AdminRoyaltyView />;
}
```

### PaymentConfigModal
Modal for developers to configure payment methods and banking details.

**Features:**
- Stripe Connect integration
- Manual payment setup (bank transfer, PayPal)
- Tax information collection
- Real-time validation

### PaymentTable
Reusable table component for displaying payment history with filtering.

**Features:**
- Status-based filtering
- Currency formatting
- Action menus (view details, download invoice)
- Responsive design

### InvoiceGenerator
Component for generating and exporting payment invoices.

**Features:**
- PDF-ready HTML invoice generation
- CSV export functionality
- Payment details integration
- Professional formatting

## Backend Integration

These components expect the following Convex API endpoints:

```typescript
// Required API structure
api.royalty.config.getDeveloperConfig
api.royalty.config.updateDeveloperConfig
api.royalty.dashboard.getStats
api.royalty.dashboard.getPayments
api.royalty.admin.getAllPayments
api.royalty.admin.getOverview
api.royalty.admin.markAsPaid
```

## Testing

Mock data and test utilities are available in `__tests__/mockData.ts`:

```tsx
import { mockDeveloperConfig, mockRoyaltyPayments } from '@/components/royalty/__tests__/mockData';
```

## Environment Variables

The system requires these environment variables:

```env
# Stripe Connect
STRIPE_SECRET_KEY=sk_...
STRIPE_CONNECT_CLIENT_ID=ca_...

# Convex
NEXT_PUBLIC_CONVEX_URL=https://...
```

## Security Considerations

- All payment data is encrypted in transit and at rest
- Bank details are masked in the UI
- Admin functions require proper role-based access
- Audit logging for all payment actions
- PCI compliance through Stripe integration

## Deployment Checklist

- [ ] Backend schema deployed to Convex
- [ ] Stripe Connect OAuth configured
- [ ] Environment variables set
- [ ] Role-based permissions configured
- [ ] Webhook endpoints secured
- [ ] Invoice generation tested
- [ ] Payment processing validated
- [ ] Audit logging verified

## Support

For implementation questions or issues, refer to the main implementation plan at `docs/royalty-implementation-plan.md`.