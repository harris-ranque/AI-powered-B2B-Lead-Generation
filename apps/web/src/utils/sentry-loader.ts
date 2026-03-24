import type * as SentryModule from "@sentry/react";

/**
 * Lightweight runtime loader for the optional `@sentry/react` dependency.
 *
 * The web app treats Sentry as optional so local development can proceed even
 * when the SDK hasn't been installed yet. This loader attempts to import the
 * SDK dynamically in the browser and gracefully degrades if the module is
 * unavailable.
 */
type Sentry = typeof SentryModule;

type CaptureArgs = Parameters<Sentry["captureException"]>;
type InitOptionsFactory = (module: Sentry) => Parameters<Sentry["init"]>[0];

let sentryModule: Sentry | null = null;
let sentryLoadError: unknown = null;
let hasInitialized = false;
let pendingInitFactory: InitOptionsFactory | null = null;
const pendingCaptures: CaptureArgs[] = [];

const shouldAttemptLoad =
  typeof window !== "undefined" &&
  Boolean(import.meta.env.VITE_SENTRY_DSN?.trim());
const moduleSpecifier = "@sentry/react";

if (shouldAttemptLoad) {
  void import(/* @vite-ignore */ moduleSpecifier)
    .then((module: Sentry) => {
      sentryModule = module;

      if (pendingInitFactory && !hasInitialized) {
        module.init(pendingInitFactory(module));
        hasInitialized = true;
        pendingInitFactory = null;
      }

      if (pendingCaptures.length > 0) {
        const queuedCaptures = pendingCaptures.splice(
          0,
          pendingCaptures.length,
        );
        for (const args of queuedCaptures) {
          module.captureException(...args);
        }
      }
    })
    .catch((error) => {
      sentryLoadError = error;
      pendingCaptures.length = 0;

      if (import.meta.env.DEV) {
        console.warn(
          "[sentry] Failed to load optional dependency @sentry/react. Telemetry is disabled.",
          error,
        );
      }
    });
} else {
  sentryLoadError = new Error(
    typeof window === "undefined"
      ? "Sentry SDK loading skipped outside the browser environment."
      : "Sentry SDK loading skipped because VITE_SENTRY_DSN is not configured.",
  );
}

/**
 * Queueable captureException wrapper that waits for the SDK to load.
 */
export function captureException(...args: CaptureArgs): void {
  if (sentryModule) {
    sentryModule.captureException(...args);
    return;
  }

  if (sentryLoadError) {
    if (import.meta.env.DEV) {
      console.warn(
        "[sentry] captureException called but the SDK is unavailable.",
        args[0],
      );
    }
    return;
  }

  pendingCaptures.push(args);
}

/**
 * Initialize Sentry once the SDK is available. Only the first invocation will
 * execute an initialization.
 */
export function initSentry(factory: InitOptionsFactory): void {
  if (hasInitialized) {
    return;
  }

  if (sentryModule) {
    sentryModule.init(factory(sentryModule));
    hasInitialized = true;
    pendingInitFactory = null;
    return;
  }

  if (sentryLoadError) {
    if (import.meta.env.DEV) {
      console.warn(
        "[sentry] init skipped because the SDK failed to load.",
        sentryLoadError,
      );
    }
    return;
  }

  pendingInitFactory = factory;
}

/**
 * Execute a callback with the loaded SDK when available.
 */
export function withSentry<T>(
  callback: (module: Sentry) => T,
  fallback: () => T,
): T {
  if (sentryModule) {
    return callback(sentryModule);
  }

  return fallback();
}

/**
 * Helper to determine whether the SDK has been successfully loaded.
 */
export function isSentryLoaded(): boolean {
  return sentryModule !== null;
}

/**
 * Surface the underlying load error for diagnostics.
 */
export function getSentryLoadError(): unknown {
  return sentryLoadError;
}
