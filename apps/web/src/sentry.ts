import * as Sentry from "@sentry/react";

// Initialize Sentry as early as possible in the app lifecycle.
// DSN and other settings are read from Vite environment variables.
const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

if (dsn && dsn.trim() !== "") {
  Sentry.init({
    dsn,
    // Send default PII (IP address, etc.) when available
    sendDefaultPii: true,
    // Enable Sentry internal logger and allow console logs to be sent as Logs
    enableLogs: true,
    // Tag events with the current environment
    environment: import.meta.env.MODE,
    // Send console logs (log, warn, error) to Sentry as Logs
    integrations: [
      Sentry.consoleLoggingIntegration({ levels: ["log", "warn", "error"] }),
    ],
  });
}

export { Sentry };
