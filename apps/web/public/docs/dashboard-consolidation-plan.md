# Dashboard, Analytics, and Billing Consolidation Plan

## Objective
Create a cohesive landing experience that surfaces key lead-generation insights, credit usage, and billing controls in one place while preserving deep-dive analytics and administrative tooling. The new dashboard should greet users with actionable context, highlight recent activity, and offer direct entry points into core workflows (lead pipeline, search history, analytics, billing, and profile management).

## Current Experience Audit

### Lead Eternity dashboard shell
The primary dashboard shell exposes separate tabs for lead pipeline orchestration, search history, business profile, credits & billing, analytics, settings, and (for admins) the admin dashboard. Each tab wraps a dedicated workflow component, so navigation currently requires switching contexts to view credits/billing information versus analytics.【F:apps/web/src/components/LeadEternityDashboard.tsx†L400-L563】

### Analytics tab (Dashboard component)
The analytics tab assembles real-time metrics and alerts sourced from Convex hooks: lead/search/email stats, subscription usage, urgent broadcasts, active searches, subscription warnings, usage meters, and recent activity streams. The layout already includes hero stats, broadcast alerts, progress trackers, subscription status cards, and placeholders for chart visualizations.【F:apps/web/src/components/Dashboard.tsx†L1-L620】

### Credits & Billing tab (CreditManager component)
The credits & billing tab focuses on purchase and upgrade flows. It reads live billing, credit balance, runtime-configured credit packs, and plan metadata; renders plan comparisons; and orchestrates Stripe checkout sessions for plan upgrades and ad-hoc credit purchases.【F:apps/web/src/components/CreditManager.tsx†L1-L200】

### Admin billing dashboard
Admins have a richer revenue and cost analytics surface with plan distribution, revenue growth, cost breakdowns, and quick administrative actions. These views already unify subscription metrics, ARR/MRR, churn, usage-by-plan, and credit utilization percentages fetched from Convex admin queries.【F:apps/web/src/components/AdminBillingDashboard.tsx†L20-L423】

## Proposed Dashboard Landing (default entry point)

1. **Welcome + Quick Actions**
   - Personalized greeting, plan badge, and a quick summary of credit balance and usage limits.
   - Shortcut buttons to "Start new lead pipeline", "Review latest searches", "Manage credits", and "Update business profile" leveraging existing tab components for deep links.【F:apps/web/src/components/LeadEternityDashboard.tsx†L400-L563】
2. **Key Performance Tiles**
   - Reuse the existing `stats` cards (total leads, leads with emails, searches completed, AI emails generated) to show momentum at a glance.【F:apps/web/src/components/Dashboard.tsx†L177-L249】
3. **Usage & Subscription Snapshot**
   - Embed the `SubscriptionStatusCard`, `UsageMetersCard`, and `UsageWarnings` stack to remind users of limits and upsell opportunities.【F:apps/web/src/components/Dashboard.tsx†L309-L481】
4. **Active Work + Recent Activity**
   - Surface the active search tracker, urgent broadcasts, and recent activity feed so users can jump into ongoing work or respond to alerts.【F:apps/web/src/components/Dashboard.tsx†L280-L620】
5. **Recommended Next Steps**
   - Use credit consumption and recent search history to prompt actions like purchasing credits, enriching leads, or exporting results (linking to billing or pipeline tabs). Data already available in `CreditManager` usage stats and search hooks can drive these prompts.【F:apps/web/src/components/CreditManager.tsx†L69-L144】【F:apps/web/src/components/Dashboard.tsx†L105-L205】

Implementation approach: create a new `DashboardLanding` component that composes the above sections, set it as the default route after authentication, and preserve existing tabs as deep links accessible via CTA buttons.

## Combined Performance & Billing Workspace
Merge the current analytics and credits/billing tabs into a single "Performance & Billing" page for non-admin users, with layered sections:

1. **Header Bar**
   - Show current plan, credit balance, renewal countdown, and upgrade/purchase CTAs by combining `CreditManager`'s plan metadata with dashboard usage limits.【F:apps/web/src/components/CreditManager.tsx†L69-L200】【F:apps/web/src/components/Dashboard.tsx†L309-L325】
2. **Usage Insights**
   - Display credit consumption progress, monthly allowance, searches this month, leads generated, and average cost per lead using existing usage stats and visual progress bars.【F:apps/web/src/components/CreditManager.tsx†L69-L152】
3. **Performance Analytics**
   - Reuse the dashboard metrics grid, active search tracker, and recent activity feed to provide context for how credits are being spent.【F:apps/web/src/components/Dashboard.tsx†L177-L620】
4. **Billing & Purchase Controls**
   - Embed the pricing table and credit pack purchase UI from `CreditManager`, possibly in accordions or side panels so users can act without leaving analytics.【F:apps/web/src/components/CreditManager.tsx†L81-L144】【F:apps/web/src/components/CreditManager.tsx†L166-L200】
5. **Plan & Cost Trends (Admins and growth-focused users)**
   - For users with admin privileges, conditionally include the plan distribution, revenue growth, cost analytics, and admin quick actions panels from the admin dashboard to avoid maintaining duplicate layouts.【F:apps/web/src/components/AdminBillingDashboard.tsx†L140-L423】

## Implementation Steps

1. **Routing & Navigation**
   - Point post-login redirects to the new `DashboardLanding` route, keeping tab navigation for detailed workflows.
   - Replace the separate "Analytics" and "Credits & Billing" sidebar items with a single "Performance & Billing" link that loads the merged view, while still exposing admin-only billing analytics where required.【F:apps/web/src/components/LeadEternityDashboard.tsx†L421-L563】
2. **Component Composition**
   - Extract shared sections (stat tiles, usage snapshot, broadcast feed, pricing table) into smaller presentational components so they can be reused across landing and combined views without duplicating logic.
   - Parameterize components to accept externally provided data when used outside their original context (e.g., allow `CreditManager` to render without owning routing side effects).
3. **Data Fetching Strategy**
   - Continue using existing Convex hooks; coordinate queries so landing and combined views share cached results. Guard expensive admin queries behind role checks before invoking `api.admin.billing.*` hooks.【F:apps/web/src/components/AdminBillingDashboard.tsx†L22-L120】
4. **State & Error Handling**
   - Preserve the existing error boundary patterns and error toasts to ensure runtime issues are surfaced uniformly across the new layouts.【F:apps/web/src/components/LeadEternityDashboard.tsx†L432-L563】【F:apps/web/src/components/Dashboard.tsx†L84-L120】
5. **Responsive & Progressive Enhancement**
   - Ensure grids collapse gracefully (existing components already use responsive Tailwind grids) and prioritize at-a-glance metrics on small screens before action-heavy panels.

## Future Enhancements
- Add configurable widgets so users can pin preferred metrics or quick actions to the landing experience.
- Incorporate trend charts (replacing placeholders) using the same data powering admin revenue analytics for non-admin visibility at an aggregate level.【F:apps/web/src/components/AdminBillingDashboard.tsx†L310-L360】
- Layer in contextual AI tips that suggest next steps based on recent lead generation activity and credit usage patterns.
