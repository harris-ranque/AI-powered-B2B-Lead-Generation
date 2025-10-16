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

// Trigger redeploy
createRoot(document.getElementById("root")!).render(
  <PostHogProvider
    apiKey={import.meta.env.VITE_PUBLIC_POSTHOG_KEY}
    options={{
      api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
      defaults: '2025-05-24',
      capture_exceptions: true,
      debug: import.meta.env.MODE === "development",
    }}
  >
    <App />
  </PostHogProvider>
);