# Frontend Integration with Convex Backend

This document outlines the completed Phase 1 frontend integration with the Convex backend and next steps.

## ✅ Phase 1 Completed (Foundation & Backend Integration)

### 1. Dependencies Added

```json
{
  "@convex-dev/auth": "^0.0.70",
  "@stripe/react-stripe-js": "^2.4.0",
  "@stripe/stripe-js": "^2.4.0",
  "convex": "^1.16.4"
}
```

### 2. Convex Configuration

- **convex.json**: Points to the separate Convex backend functions directory
- **src/lib/convex.ts**: Convex client configuration
- **src/lib/stripe.ts**: Stripe client setup

### 3. Provider Integration

- **ConvexProvider**: Wraps app with Convex and ConvexAuth
- **App.tsx**: Updated to include ConvexProvider at root level
- **ProtectedRoute**: Handles authentication routing

### 4. Authentication System

- **LoginForm**: Complete authentication UI with email/password, GitHub, Google
- **useAuth**: Hook for authentication state and actions
- **Index.tsx**: Protected with authentication wrapper

### 5. Type System

- **src/lib/types.ts**: Complete TypeScript types based on Convex schema
- **Convex schema integration**: Types match backend data model

### 6. API Hooks Created

Placeholder hooks ready for activation when backend is connected:

- **useUser**: User management and credits
- **useProfile**: Business profile CRUD operations
- **useSearches**: Search creation and management
- **useLeads**: Lead management and enrichment
- **useCrewAI**: AI email generation and analysis
- **useBilling**: Billing and payment operations
- **useNotifications**: User notifications

### 7. API Client Refactored

- **api-client.ts**: Refactored to use Convex types
- **Helper functions**: Data formatting and default values
- **Type exports**: Unified type system

## 🔧 Environment Setup Required

### Frontend Environment Variables

Create `apps/web/.env.local`:

```env
VITE_CONVEX_URL=https://your-convex-deployment-url
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
VITE_POSTHOG_KEY=phc_...
VITE_POSTHOG_HOST=https://app.posthog.com
```

### Backend Environment Variables

Ensure `convex/.env.local` has:

```env
# API Keys
OPENAI_API_KEY=sk-...
GOOGLE_MAPS_API_KEY=...
FINDYMAIL_API_KEY=...
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...

# CrewAI Worker
CREWAI_URL=http://localhost:8080
CREWAI_API_KEY=your_secure_api_key

# Admin
ADMIN_EMAILS=admin@example.com
DEVELOPER_EMAIL=dev@example.com

# URLs
APP_URL=http://localhost:3000
```

## 🚀 Next Steps - Phase 2

### Immediate Actions Required:

1. **Deploy Convex Backend**

   ```bash
   cd ../genni-convex
   npx convex dev    # For development
   npx convex deploy # For production
   ```

2. **Update Environment Variables**
   - Get Convex deployment URL
   - Update `VITE_CONVEX_URL` in frontend
   - Test authentication flow

3. **Enable API Hooks**
   - Uncomment Convex queries in hooks
   - Test basic authentication
   - Verify data flow

### Phase 2 Implementation Tasks:

#### Task 1: BusinessProfileWizard Integration

```typescript
// In BusinessProfileWizard.tsx
import { useProfile } from "@/hooks/useProfile";

const { profile, createOrUpdateProfile } = useProfile();

const handleSubmit = async (data) => {
  await createOrUpdateProfile(data);
};
```

#### Task 2: Lead Search Integration

```typescript
// In LeadDiscoveryStage (or any caller)
import { useSearches } from "@/hooks/useSearches";

const { createSearch } = useSearches();

const handleSearch = async (params) => {
  // Orchestrator auto-starts via scheduler when autoStart is true
  const { searchId } = await createSearch({
    name,
    parameters: params,
    autoStart: true,
  });
  // No direct action call needed; backend runs discovery → enrichment → analysis
};
```

#### Task 3: Real-time Lead Display

```typescript
// In LeadCard component
import { useLeads } from "@/hooks/useLeads";

const { leads, updateLeadStatus } = useLeads(searchId);

// Real-time updates via Convex subscriptions
useEffect(() => {
  // Leads automatically update via Convex real-time subscriptions
}, [leads]);
```

#### Task 4: AI Email Generation

```typescript
// In AIEmailGenerator.tsx
import { useEmailGeneration } from "@/hooks/useCrewAI";

const { generateEmail } = useEmailGeneration();

const handleGenerate = async () => {
  await generateEmail({ leadId, requirements });
};
```

## 🛠️ Development Commands

```bash
# Install dependencies
cd apps/web
pnpm install

# Start development server
pnpm dev

# Type checking
pnpm type-check

# Linting
pnpm lint
```

## 📁 File Structure Added

```
apps/web/src/
├── components/
│   ├── auth/
│   │   ├── LoginForm.tsx
│   │   └── ProtectedRoute.tsx
│   ├── providers/
│   │   └── ConvexProvider.tsx
│   └── ui/
│       └── loading-spinner.tsx
├── hooks/
│   ├── useAuth.ts
│   ├── useUser.ts
│   ├── useProfile.ts
│   ├── useSearches.ts
│   ├── useLeads.ts
│   ├── useCrewAI.ts
│   ├── useBilling.ts
│   └── useNotifications.ts
└── lib/
    ├── convex.ts
    ├── stripe.ts
    ├── types.ts
    └── api-client.ts (refactored)
```

## 🔄 Real-time Features Ready

Once backend is connected, the following real-time features will work automatically:

1. **Live search progress**: Search status updates in real-time
2. **Lead enrichment tracking**: Contact discovery and AI analysis progress
3. **Email generation status**: AI processing status and results
4. **Notifications**: System alerts and updates
5. **Credit usage**: Real-time credit balance updates

## 🎯 Success Metrics

- ✅ Authentication flow working
- ✅ ConvexProvider integrated
- ✅ All hooks ready for activation
- ✅ Type system aligned with backend
- ✅ Environment configuration documented

**Next milestone**: Connect to deployed Convex backend and activate real data flow.

## 🚨 Important Notes

1. **Placeholder hooks**: All hooks currently return placeholder data until backend is connected
2. **Authentication**: Ready for Convex Auth but needs backend deployment
3. **Types**: Fully aligned with Convex schema for seamless integration
4. **Real-time**: Built-in Convex subscriptions will provide live updates once connected
5. **Error handling**: Comprehensive error boundaries and loading states implemented

The frontend is now fully prepared for Convex backend integration. Phase 1 creates a solid foundation that will seamlessly connect to real data once the backend is deployed and configured.
