# Lead Eternity - Final Architecture & Implementation Guide

## Final Tech Stack

```
Frontend:    Railway (React/TypeScript)
Backend:     Convex (Database, Auth, Queues, Actions)
AI Worker:   Railway (Python CrewAI + FastAPI)
Payments:    Stripe (via Convex)
Analytics:   PostHog
External:    Google Maps, FindyMail, OpenAI
```

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        Railway                               │
├─────────────────────────┬───────────────────────────────────┤
│   React Frontend App    │        CrewAI Worker              │
│   - TypeScript/React    │        - Python/FastAPI          │
│   - Stripe Elements     │        - CrewAI Agents           │
│   - PostHog Analytics   │        - Async Processing        │
│   - Admin Dashboard     │        - Port 8080               │
│   - Port 3000          │                                   │
└────────────┬───────────┴─────────────┬─────────────────────┘
             │                         │
             │ HTTPS                   │ Internal Network
             │                         │
      ┌──────▼─────────────────────────▼──────┐
      │           Convex Backend              │
      │   - Realtime Database                 │
      │   - Authentication (Built-in)         │
      │   - Actions (API Orchestration)       │
      │   - Scheduled Jobs                    │
      │   - File Storage                      │
      │   - Admin Functions                   │
      └─────────────────┬─────────────────────┘
                        │
              ┌─────────┴──────────┐
              │   External APIs    │
              │   - Google Maps    │
              │   - FindyMail      │
              │   - OpenAI         │
              │   - Stripe         │
              └───────────────────┘
```

## Detailed User Flow Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                    COMPLETE USER JOURNEY                      │
└──────────────────────────────────────────────────────────────┘

1. ONBOARDING & SETUP
   ┌─────────┐     ┌──────────┐     ┌─────────────┐     ┌──────────┐
   │ Landing │────▶│  Sign Up │────▶│   Profile   │────▶│Dashboard │
   │  Page   │     │  (Auth)  │     │   Wizard    │     │  Home    │
   └─────────┘     └──────────┘     └─────────────┘     └──────────┘
        │               │                   │                  │
   [Marketing]    [Convex Auth]     [Multi-Step Form]    [Overview]
                                           │
                                    Store in Convex:
                                    - Company Info
                                    - Target Market
                                    - Value Props
                                    - Messaging

2. SEARCH CONFIGURATION
   ┌──────────┐     ┌─────────────┐     ┌──────────────┐
   │   New    │────▶│   Search    │────▶│   Preview    │
   │  Search  │     │ Parameters  │     │   & Start    │
   └──────────┘     └─────────────┘     └──────────────┘
        │                  │                     │
   [Dashboard]      [Location/Industry]    [Credit Check]
                          │                     │
                    Validate Against:      If Free User:
                    - Google Maps API      - Check Credits
                    - User Profile         - Show Upgrade

3. LEAD DISCOVERY PIPELINE
   ┌────────────────────────────────────────────────────────┐
   │                  Asynchronous Processing                │
   ├────────────────────────────────────────────────────────┤
   │                                                        │
   │  Submit ──▶ Queue ──▶ Google Maps ──▶ For Each Lead:  │
   │    │         │           │               │             │
   │  [Save]   [Convex]   [Batch API]    [Process]        │
   │    │         │           │               │             │
   │    ▼         ▼           ▼               ▼             │
   │  Session   Status     Results      ┌──────────┐       │
   │  Created   Updates    Stored       │ Enrich   │       │
   │                                    │ Lead     │       │
   │                                    └────┬─────┘       │
   │                                         │             │
   │                          ┌──────────────┴──────────┐  │
   │                          ▼                         ▼  │
   │                    Find Emails              Analyze w/AI│
   │                    (FindyMail)              (CrewAI)   │
   │                         │                         │    │
   │                         ▼                         ▼    │
   │                    Store Contact            Intelligence│
   │                                                        │
   └────────────────────────────────────────────────────────┘

4. AI ANALYSIS & EMAIL GENERATION
   ┌───────────────────────────────────────────────────────┐
   │               CrewAI Worker Processing                 │
   ├───────────────────────────────────────────────────────┤
   │                                                       │
   │  Lead Data ──▶ HTTP POST ──▶ Railway Worker          │
   │      │            │               │                   │
   │  [Convex]    [Auth+JSON]    [Python App]            │
   │                                  │                   │
   │                          ┌───────▼────────┐          │
   │                          │  Agent Crew    │          │
   │                          ├────────────────┤          │
   │                          │ 1. Analyzer    │          │
   │                          │ 2. Researcher  │          │
   │                          │ 3. Writer      │          │
   │                          │ 4. Follow-ups  │          │
   │                          └───────┬────────┘          │
   │                                  │                   │
   │                          Generate 5 Emails           │
   │                                  │                   │
   │                          Webhook Results             │
   │                                  │                   │
   │                          Store in Convex             │
   │                                                       │
   └───────────────────────────────────────────────────────┘

5. RESULTS & ACTIONS
   ┌──────────┐     ┌─────────────┐     ┌──────────────┐
   │  Results │────▶│Lead Details │────▶│Export/Action │
   │   View   │     │   + Emails  │     │   Options    │
   └──────────┘     └─────────────┘     └──────────────┘
        │                  │                     │
   [Real-time]      [Preview/Edit]         [Download]
   [Updates]        [Regenerate]           [Integrate]
        │                  │                     │
        ▼                  ▼                     ▼
   Lead Cards      Email Sequences        CSV/JSON/CRM
   w/ Scores       w/ Preview             Integration

6. BILLING & USAGE
   ┌──────────┐     ┌─────────────┐     ┌──────────────┐
   │  Usage   │────▶│   Upgrade   │────▶│Stripe Checkout│
   │ Tracking │     │   Prompt    │     │              │
   └──────────┘     └─────────────┘     └──────────────┘
        │                  │                     │
   [Credits/Limits]  [Plan Options]      [Secure Payment]
        │                  │                     │
        ▼                  ▼                     ▼
   Update Usage      Show Benefits         Webhook
   in Convex         & Pricing            Confirmation

7. ADMIN DASHBOARD
   ┌──────────┐     ┌─────────────┐     ┌──────────────┐
   │  Admin   │────▶│  Dashboard  │────▶│   Actions    │
   │  Login   │     │   Overview  │     │              │
   └──────────┘     └─────────────┘     └──────────────┘
        │                  │                     │
   [Role Check]      [Metrics View]        [User Mgmt]
        │                  │                     │
        ▼                  ▼                     ▼
   Admin Auth        - Total Users         - View Users
                     - Active Companies    - Edit Plans
                     - Revenue Metrics     - Support Tools
                     - Usage Stats         - Export Data
```

## Data Flow Architecture

```
┌────────────────────────────────────────────────────────────┐
│                    DATA FLOW DIAGRAM                        │
└────────────────────────────────────────────────────────────┘

1. USER INPUT FLOW
   Browser ──▶ React Form ──▶ Convex Mutation ──▶ Database
      │            │               │                 │
   [HTTPS]    [Validation]    [Auth Check]      [PostgreSQL]

2. SEARCH PROCESSING FLOW
   Search Request ──▶ Convex Action ──▶ Google Maps API
         │                │                   │
   [Parameters]     [Rate Limit]        [Batch Calls]
         │                │                   │
         ▼                ▼                   ▼
   Create Session    Queue Jobs         Store Results

3. ENRICHMENT PIPELINE
   For Each Lead:
   ┌─────────────────────────────────────────────────┐
   │                                                 │
   │  Lead ──▶ FindyMail API ──▶ Contact Discovery  │
   │   │           │                 │               │
   │   ▼           ▼                 ▼               │
   │  Basic     Email Finder    Store Contacts      │
   │  Info      Service         in Database         │
   │                                                 │
   │  Lead ──▶ CrewAI Worker ──▶ AI Analysis       │
   │   │          │                │                 │
   │   ▼          ▼                ▼                 │
   │  Context  HTTP Request   Store Intelligence    │
   │  Data     to Railway     in Database           │
   │                                                 │
   └─────────────────────────────────────────────────┘

4. REAL-TIME UPDATE FLOW
   Database Change ──▶ Convex Subscription ──▶ React Component
         │                    │                      │
   [Mutation]          [WebSocket]            [Auto Update]
         │                    │                      │
         ▼                    ▼                      ▼
   Trigger Event      Push to Client         Update UI

5. PAYMENT FLOW
   Checkout ──▶ Stripe ──▶ Webhook ──▶ Convex ──▶ Update User
      │           │          │           │           │
   [Frontend]  [Process]  [Verify]   [Action]   [Database]
```

## CrewAI Agent Architecture

```
┌─────────────────────────────────────────────────────────┐
│              EMAIL PERSONALIZATION CREW                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Input: Lead Data + User Profile                       │
│                   │                                     │
│                   ▼                                     │
│  ┌─────────────────────────────────┐                  │
│  │   1. RELEVANCE ANALYZER         │                  │
│  │   - Match offerings to needs    │                  │
│  │   - Score fit (1-10)           │                  │
│  │   - Find connection points      │                  │
│  └────────────────┬────────────────┘                  │
│                   ▼                                     │
│  ┌─────────────────────────────────┐                  │
│  │   2. PAIN POINT RESEARCHER      │                  │
│  │   - Industry challenges         │                  │
│  │   - Company-specific issues     │                  │
│  │   - Growth blockers             │                  │
│  └────────────────┬────────────────┘                  │
│                   ▼                                     │
│  ┌─────────────────────────────────┐                  │
│  │   3. VALUE PROP MATCHER         │                  │
│  │   - Align solutions to pains    │                  │
│  │   - Create benefit statements   │                  │
│  │   - Prioritize propositions     │                  │
│  └────────────────┬────────────────┘                  │
│                   ▼                                     │
│  ┌─────────────────────────────────┐                  │
│  │   4. EMAIL COPYWRITER           │                  │
│  │   - 140-word main email         │                  │
│  │   - Compelling subject line     │                  │
│  │   - Clear CTA                   │                  │
│  └────────────────┬────────────────┘                  │
│                   ▼                                     │
│  ┌─────────────────────────────────┐                  │
│  │   5. FOLLOW-UP STRATEGIST       │                  │
│  │   - 4 follow-up emails          │                  │
│  │   - Different angles            │                  │
│  │   - Escalating urgency          │                  │
│  └────────────────┬────────────────┘                  │
│                   ▼                                     │
│         Output: 5 Personalized Emails                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Admin Dashboard Flow

```
┌─────────────────────────────────────────────────────────┐
│                    ADMIN DASHBOARD                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. AUTHENTICATION                                      │
│     Admin Login ──▶ Role Verification ──▶ Dashboard    │
│         │                │                    │         │
│    [Email/Pass]     [isAdmin flag]      [Redirect]     │
│                                                         │
│  2. OVERVIEW METRICS                                    │
│     ┌──────────────┬──────────────┬──────────────┐    │
│     │ Total Users  │ Active Users │   Revenue    │    │
│     │   1,234      │     892      │  $45,678    │    │
│     └──────────────┴──────────────┴──────────────┘    │
│     ┌──────────────┬──────────────┬──────────────┐    │
│     │Searches/Day  │ Leads Found  │ Email Rate   │    │
│     │    156       │   7,890      │    67%       │    │
│     └──────────────┴──────────────┴──────────────┘    │
│                                                         │
│  3. USER MANAGEMENT                                     │
│     Search Users ──▶ View Details ──▶ Take Action     │
│         │                │                │            │
│    [Filter/Sort]    [User Profile]   [Edit/Ban]       │
│                                                         │
│  4. COMPANY INSIGHTS                                    │
│     Top Companies ──▶ Usage Stats ──▶ Support         │
│         │                 │               │            │
│    [By Revenue]      [API Calls]    [Contact]         │
│                                                         │
│  5. SYSTEM HEALTH                                       │
│     API Status ──▶ Queue Health ──▶ Error Logs        │
│         │               │               │              │
│    [Uptime]        [Jobs/Min]     [Sentry]           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Database Schema Overview

```
Convex Tables:
├── users (Convex Auth)
│   ├── email
│   ├── name
│   ├── role (user/admin)
│   ├── stripeCustomerId
│   ├── plan (free/pro/enterprise)
│   ├── creditsRemaining
│   ├── isActive
│   └── lastLoginAt
│
├── businessProfiles
│   ├── userId
│   ├── companyName
│   ├── targetIndustries[]
│   ├── offerings[]
│   └── toneOfVoice
│
├── searchSessions
│   ├── userId
│   ├── status
│   ├── searchParams
│   └── progress
│
├── leads
│   ├── sessionId
│   ├── businessInfo
│   ├── contacts[]
│   ├── intelligence
│   └── emailSequence[]
│
├── usageLog
│   ├── userId
│   ├── action
│   ├── creditsUsed
│   └── timestamp
│
└── adminMetrics
    ├── date
    ├── totalUsers
    ├── activeUsers
    ├── revenue
    ├── searchesCount
    └── leadsGenerated

Note: adminMetrics table is populated by scheduled Convex functions
that aggregate data daily for fast dashboard loading.
```

## API Endpoints Structure

```
Convex Functions:
├── auth/
│   ├── signIn
│   ├── signUp
│   └── signOut
│
├── profile/
│   ├── create
│   ├── update
│   └── get
│
├── search/
│   ├── start
│   ├── getStatus
│   └── cancel
│
├── leads/
│   ├── list
│   ├── get
│   └── regenerateEmails
│
├── billing/
│   ├── createCheckout
│   ├── handleWebhook
│   └── getUsage
│
├── crewai/
│   ├── analyzeCompany
│   └── generateEmails
│
└── admin/
    ├── getMetrics
    ├── listUsers
    ├── getUser
    ├── updateUser
    ├── listCompanies
    ├── getSystemHealth
    └── exportData

Railway CrewAI API:
├── POST /analyze
├── GET /health
└── POST /webhook/complete
```

## Deployment Configuration

```yaml
# Railway Frontend (railway.toml)
[build]
builder = "nixpacks"
buildCommand = "npm run build"

[deploy]
startCommand = "npm start"
healthcheckPath = "/"
restartPolicyType = "always"

[service]
internalPort = 3000

# Railway CrewAI Worker (railway.toml)
[build]
builder = "nixpacks"

[deploy]
startCommand = "uvicorn main:app --host 0.0.0.0 --port 8080"
healthcheckPath = "/health"
restartPolicyType = "always"
numReplicas = 2

[service]
internalPort = 8080
```