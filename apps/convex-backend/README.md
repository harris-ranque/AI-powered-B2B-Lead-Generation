# Genni Convex Backend

This is the Convex backend for Genni, an AI-powered lead generation platform that combines Google Maps search, contact enrichment, and CrewAI-powered email personalization.

## Overview

The backend is built on Convex, providing real-time data synchronization, serverless functions, and robust authentication. It integrates with multiple external services to deliver a complete lead generation solution.

## Architecture

### Core Components

- **Users & Authentication**: Convex Auth with GitHub/Google providers
- **Business Profiles**: Company information for AI personalization
- **Search & Discovery**: Google Maps API integration for lead discovery
- **Lead Management**: Contact storage, enrichment, and AI analysis
- **Email Generation**: CrewAI integration for personalized emails
- **Billing**: Stripe integration with credit-based usage
- **Admin**: Dashboard and user management
- **Notifications**: Real-time alerts and email notifications

### External Integrations

- **Google Maps API**: Business discovery and location data
- **FindyMail API**: Contact information enrichment
- **CrewAI Worker**: AI-powered email generation and analysis
- **Stripe**: Payment processing and subscription management
- **Email Services**: Transactional email delivery

## Getting Started

### Prerequisites

- Node.js 18+
- Convex CLI: `npm install -g convex`
- API keys for external services

### Installation

1. Install dependencies:

   ```bash
   npm install
   ```

2. Set up environment variables:

   ```bash
   cp .env.local.example .env.local
   # Edit .env.local with your API keys
   ```

3. Initialize Convex:
   ```bash
   npx convex dev
   ```

### Development

Run the development server:

```bash
npm run dev
```

This will start Convex in development mode with:

- Real-time database synchronization
- Function hot reloading
- Authentication setup
- Webhook endpoints
- Scheduled functions (crons)

### Deployment

Deploy to production:

```bash
npm run deploy
```

## Environment Variables

### Required API Keys

```env
# Google Maps API (for lead discovery)
GOOGLE_MAPS_API_KEY=your-api-key

# FindyMail API (for contact enrichment)
FINDYMAIL_API_KEY=your-api-key

# CrewAI Worker (for AI email generation)
CREWAI_URL=http://your-worker-url
CREWAI_API_KEY=your-secure-key

# Stripe (for payments)
STRIPE_SECRET_KEY=sk_your-key
STRIPE_WEBHOOK_SECRET=whsec_your-secret

# OpenAI (for AI features)
OPENAI_API_KEY=sk-your-key
```

### Optional Configuration

```env
# Admin settings
ADMIN_EMAILS=admin@example.com
DEVELOPER_EMAIL=dev@example.com

# Application URLs
APP_URL=http://localhost:3000
API_URL=http://localhost:3001

# Feature flags
ENABLE_EMAIL_NOTIFICATIONS=true
ENABLE_WEBHOOK_RETRIES=true
```

## Database Schema

### Core Tables

- **users**: User accounts, plans, credits, preferences
- **businessProfiles**: Company info for AI personalization
- **searches**: Lead search sessions and parameters
- **leads**: Individual business leads with enrichment data
- **emailSequences**: AI-generated personalized emails
- **billing**: Subscription and payment tracking
- **creditTransactions**: Credit purchases and usage
- **notifications**: System alerts and notifications

### Relationships

- Users have business profiles (1:1)
- Users create searches (1:many)
- Searches contain leads (1:many)
- Leads have email sequences (1:many)
- Users have billing records (1:many)

## API Endpoints

### Webhooks

- `POST /webhooks/crewai/email-completed` - CrewAI email generation
- `POST /webhooks/crewai/analysis-completed` - CrewAI lead analysis
- `POST /webhooks/stripe` - Stripe payment events
- `POST /webhooks/findymail/enrichment-completed` - Contact enrichment

### Public API

- `GET /health` - System health check
- `GET /api/status` - API status and endpoints
- `GET /api/leads/export` - Lead data export (API key required)

## Features

### Lead Generation Workflow

1. **Search Creation**: User defines search parameters
2. **Google Maps Discovery**: Find businesses using Places API with spatial tiling
3. **Contact Enrichment**: Enhance leads with FindyMail
4. **AI Analysis**: CrewAI analyzes leads for relevance
5. **Email Generation**: Personalized emails created by AI
6. **Real-time Updates**: Progress tracked and displayed live

### Spatial Tiling & Lead Discovery

**How Spatial Tiling Works**:

Genni uses an intelligent spatial tiling algorithm to maximize lead discovery from Google Maps API while respecting API limitations (maximum 60 results per query):

1. **Grid Division**: Search area divided into smaller geographic tiles
2. **Parallel Discovery**: Each tile queried independently for maximum coverage
3. **Overlap Handling**: Adjacent tiles may discover the same business from different positions
4. **Smart Deduplication**: Two-level deduplication ensures data quality and cost efficiency

**Two-Level Deduplication System**:

```
Business Discovery → Per-Search Deduplication → User-Level Deduplication → Lead Created
                     (Spatial Tiling)            (Across All Searches)
```

**Level 1: Per-Search Deduplication** (Spatial Tiling)
- **Purpose**: Prevents duplicate tiles within a single search
- **Index**: `by_search_place ["searchId", "placeId"]`
- **Use Case**: When overlapping tiles discover the same business
- **Performance**: O(log n) compound index query - NO in-memory filtering
- **Result**: Each business appears once per search regardless of tile overlap

**Level 2: User-Level Deduplication** (Cross-Search)
- **Purpose**: Prevents re-processing businesses across multiple searches
- **Index**: `by_user_place ["userId", "placeId"]`
- **Use Case**: User creates multiple searches that discover the same business
- **Performance**: O(log n) compound index query - NO in-memory filtering
- **Result**: Each business processed once per user, saving credits and avoiding duplicate outreach

**Benefits**:
- **Maximum Coverage**: Spatial tiling discovers 10-20x more leads than single queries
- **Zero Duplicates**: Overlapping tiles automatically deduplicated
- **Cost Efficient**: No wasted credits on duplicate processing or enrichment
- **Scalable**: O(log n) performance maintains speed as database grows
- **User-Friendly**: Users can run multiple searches without worrying about duplicate leads

### Credit System

- **Free Plan**: 50 credits/month, 25 leads per search
- **Pro Plan**: 500 credits/month, 100 leads per search
- **Enterprise Plan**: 2000 credits/month, 500 leads per search

Credit costs:

- Lead discovery: 1 credit
- Contact enrichment: 2 credits
- AI analysis: 3 credits
- Email generation: 5 credits

### Real-time Features

- Live search progress updates
- Instant notifications
- Real-time lead status changes
- Dynamic dashboard metrics

## Security

### Authentication

- Convex Auth with JWT tokens
- GitHub and Google OAuth providers
- Role-based access control (user/admin)
- API key authentication for external access

### Data Protection

- Input validation and sanitization
- Rate limiting on API endpoints
- Webhook signature verification
- Encrypted sensitive data storage

### API Security

- Bearer token authentication
- CORS configuration
- Request size limits
- SQL injection prevention

## Monitoring

### Health Checks

- System health endpoint (`/health`)
- Scheduled health monitoring
- Error tracking and alerting
- Performance monitoring

### Analytics

- Daily metrics calculation
- User activity tracking
- Search performance analytics
- Conversion funnel analysis

## Development Guidelines

### Code Organization

- Feature-based module structure
- Separation of queries, mutations, and actions
- Internal functions for cross-module communication
- Shared utilities and constants

### Testing

- Unit tests for business logic
- Integration tests for external APIs
- Webhook testing with mock payloads
- Performance testing for large datasets

### Error Handling

- Structured error responses
- Graceful degradation
- Retry mechanisms for external APIs
- Comprehensive error logging

## Deployment

### Production Checklist

- [ ] Set production environment variables
- [ ] Configure webhook URLs
- [ ] Set up monitoring and alerting
- [ ] Test all external integrations
- [ ] Verify scheduled functions
- [ ] Configure backup strategies

### Scaling Considerations

- Convex auto-scales functions
- Rate limit external API calls
- Implement caching for expensive operations
- Monitor and optimize database queries
- Use batch operations for bulk processing

## Support

For issues and questions:

- Check the troubleshooting guide
- Review error logs in Convex dashboard
- Contact support at support@genni.com

## License

MIT License - see LICENSE file for details.
