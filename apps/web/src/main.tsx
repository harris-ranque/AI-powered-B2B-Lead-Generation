// Initialize Sentry before anything else
import "./sentry";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initializeStoredAppTheme } from "./lib/appTheme";

// Initialize global error handling
import "./lib/error-handler";

// Initialize logging utility
import { logger } from "./utils/logger";

// Log environment status in development
import { logEnvironmentStatus, validateClerkConfiguration } from "./lib/env-validation";
// PostHog analytics provider
import { PostHogProvider } from "posthog-js/react";

logEnvironmentStatus();

// Enhanced startup logging with Clerk configuration
const clerkValidation = validateClerkConfiguration();
logger.info("Application starting up", {
  timestamp: new Date().toISOString(),
  environment: import.meta.env.MODE,
  nodeEnv: import.meta.env.NODE_ENV,
  railwayEnv:
    import.meta.env.VITE_RAILWAY_ENVIRONMENT || import.meta.env.ENVIRONMENT,
  isDevelopment: import.meta.env.MODE === "development",
  convexConfigured: Boolean(
    import.meta.env.VITE_CONVEX_URL &&
      !import.meta.env.VITE_CONVEX_URL.includes("placeholder"),
  ),
  clerkConfigured: clerkValidation.isValid,
  clerkError: clerkValidation.error,
  hasClerkKey: Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY),
});

initializeStoredAppTheme();

// PostHog configuration
const posthogKey = import.meta.env.VITE_PUBLIC_POSTHOG_KEY;
const posthogHost = import.meta.env.VITE_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

// Log PostHog configuration status
if (posthogKey) {
  logger.info("PostHog analytics initialized", {
    projectId: "233412",
    host: posthogHost,
    debug: import.meta.env.MODE === "development",
  });
} else {
  logger.warn("PostHog API key not configured - analytics disabled");
}

createRoot(document.getElementById("root")!).render(
  <PostHogProvider
    apiKey={posthogKey}
    options={{
      api_host: posthogHost,
      // Snapshot defaults for configuration consistency
      // See: https://posthog.com/docs/libraries/js/config
      defaults: '2025-11-30',
      // Create person profiles for identified users (when identify() is called)
      // Use 'always' if you want profiles for anonymous users too (4x more expensive)
      // See: https://posthog.com/docs/data/anonymous-vs-identified-events
      person_profiles: 'identified_only',
      // Autocapture clicks, form submissions, etc.
      // Exception autocapture is controlled via project settings in PostHog dashboard
      // See: https://posthog.com/docs/error-tracking/installation/web
      autocapture: true,
      // Capture page views automatically
      capture_pageview: true,
      // Capture page leaves for session duration
      capture_pageleave: true,
      // Persist user identification across sessions
      persistence: 'localStorage+cookie',
      // Enable session recording (if you have it enabled in PostHog)
      disable_session_recording: false,
      // Debug mode in development
      debug: import.meta.env.MODE === "development",
      // Bootstrap with feature flags disabled initially
      bootstrap: {
        featureFlags: {},
      },
      // Respect Do Not Track browser setting
      respect_dnt: true,
      // Load feature flags on init
      loaded: (posthog) => {
        if (import.meta.env.MODE === "development") {
          console.log("[PostHog] Loaded successfully", {
            distinctId: posthog.get_distinct_id(),
            sessionId: posthog.get_session_id(),
          });
        }
      },
    }}
  >
    <App />
  </PostHogProvider>
);