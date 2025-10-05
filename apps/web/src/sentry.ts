import { initSentry, withSentry } from "@/utils/sentry-loader";

// Initialize Sentry as early as possible in the app lifecycle.
// DSN and other settings are read from Vite environment variables.
const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

if (dsn && dsn.trim() !== "") {
  initSentry((sdk) => ({
    dsn,
    // Send default PII (IP address, etc.) when available
    sendDefaultPii: true,
    // Enable Sentry internal logger and allow console logs to be sent as Logs
    enableLogs: true,
    // Tag events with the current environment
    environment: import.meta.env.MODE,
    // Send console logs (log, warn, error) to Sentry as Logs
    integrations: [
      sdk.consoleLoggingIntegration({ levels: ["log", "warn", "error"] }),
    ],
  }));
} else if (import.meta.env.DEV) {
  withSentry(
    () => undefined,
    () => {
      console.info(
        "[sentry] VITE_SENTRY_DSN is not configured. Sentry initialization is skipped.",
      );
      return undefined;
    },
  );
}

export {
  captureException,
  getSentryLoadError,
  isSentryLoaded,
} from "@/utils/sentry-loader";
