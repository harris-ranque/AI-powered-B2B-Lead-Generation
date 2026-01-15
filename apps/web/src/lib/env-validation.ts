// Environment validation utility for runtime checks
import { logger } from "@/utils/logger";

interface EnvVars {
  VITE_CONVEX_URL?: string;
  VITE_FASTSPRING_STORE_ID?: string;
  VITE_PUBLIC_POSTHOG_KEY?: string;
  VITE_PUBLIC_POSTHOG_HOST?: string;
  VITE_CREWAI_URL?: string;
  VITE_CREWAI_API_KEY?: string;
  VITE_SENTRY_DSN?: string;
  VITE_CLERK_PUBLISHABLE_KEY?: string;
  VITE_GOOGLE_MAPS_API_KEY?: string;
  VITE_SUPPORT_EMAIL?: string;
}

interface ValidationResult {
  isValid: boolean;
  missing: string[];
  warnings: string[];
  errors: string[];
}

const REQUIRED_VARS = ["VITE_CONVEX_URL", "VITE_CLERK_PUBLISHABLE_KEY"] as const;
const OPTIONAL_VARS = [
  "VITE_FASTSPRING_STORE_ID",
  "VITE_PUBLIC_POSTHOG_KEY",
  "VITE_PUBLIC_POSTHOG_HOST",
  "VITE_CREWAI_URL",
  "VITE_CREWAI_API_KEY",
  "VITE_SENTRY_DSN",
  "VITE_GOOGLE_MAPS_API_KEY",
  "VITE_SUPPORT_EMAIL",
] as const;

export function validateEnvironment(): ValidationResult {
  const env = import.meta.env as EnvVars;
  const missing: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  // Check required variables
  for (const varName of REQUIRED_VARS) {
    const value = env[varName];
    if (!value || value.trim() === "") {
      missing.push(varName);
      errors.push(`${varName} is required but missing or empty`);
    } else if (value === "https://placeholder.convex.cloud") {
      warnings.push(`${varName} is using placeholder value`);
    }
  }

  // Check optional variables (only warn if they look like placeholders)
  for (const varName of OPTIONAL_VARS) {
    const value = env[varName];
    if (
      value &&
      (value.includes("placeholder") ||
        value.includes("...") ||
        value.includes("your_"))
    ) {
      warnings.push(`${varName} appears to be using a placeholder value`);
    }
  }

  return {
    isValid: missing.length === 0,
    missing,
    warnings,
    errors,
  };
}

export function validateClerkConfiguration(): {
  isValid: boolean;
  error?: string;
  clerkKey?: string;
} {
  const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

  if (!clerkKey) {
    return {
      isValid: false,
      error: "VITE_CLERK_PUBLISHABLE_KEY is missing. Please set this environment variable in Railway.",
    };
  }

  if (!clerkKey.startsWith('pk_')) {
    return {
      isValid: false,
      error: `Invalid Clerk publishable key format. Expected format: pk_test_... or pk_live_..., got: ${clerkKey.substring(0, 10)}...`,
      clerkKey,
    };
  }

  return {
    isValid: true,
    clerkKey,
  };
}

export function getEnvironmentInfo() {
  const validation = validateEnvironment();
  const clerkValidation = validateClerkConfiguration();
  const env = import.meta.env;

  return {
    mode: env.MODE,
    dev: env.DEV,
    prod: env.PROD,
    base: env.BASE_URL,
    validation,
    clerkValidation,
    convexConfigured: Boolean(
      env.VITE_CONVEX_URL &&
        env.VITE_CONVEX_URL !== "https://placeholder.convex.cloud",
    ),
    clerkConfigured: clerkValidation.isValid,
    hasFastSpring: Boolean(
      env.VITE_FASTSPRING_STORE_ID &&
        !env.VITE_FASTSPRING_STORE_ID.includes("..."),
    ),
    hasAnalytics: Boolean(
      env.VITE_PUBLIC_POSTHOG_KEY && !env.VITE_PUBLIC_POSTHOG_KEY.includes("..."),
    ),
  };
}

// Development helper to log environment status
export function logEnvironmentStatus() {
  const info = getEnvironmentInfo();

  if (import.meta.env.DEV) {
    console.group("🔧 Environment Status");
    console.log("Mode:", info.mode);
    console.log("Convex Configured:", info.convexConfigured);
    console.log("Clerk Configured:", info.clerkConfigured);
    console.log("FastSpring Configured:", info.hasFastSpring);
    console.log("Analytics Configured:", info.hasAnalytics);

    if (!info.clerkConfigured && info.clerkValidation.error) {
      console.group("🔑 Clerk Authentication Error");
      console.error(info.clerkValidation.error);
      console.groupEnd();
    }

    if (info.validation.errors.length > 0) {
      console.group("❌ Errors");
      info.validation.errors.forEach((error) => console.error(error));
      console.groupEnd();
    }

    if (info.validation.warnings.length > 0) {
      console.group("⚠️ Warnings");
      info.validation.warnings.forEach((warning) => console.warn(warning));
      console.groupEnd();
    }

    console.groupEnd();
  } else {
    // Production/Staging logging via app logger
    if (!info.validation.isValid) {
      logger.error("Missing required environment variables in production", {
        missing: info.validation.missing,
        errors: info.validation.errors,
      });
    }

    // Enhanced Clerk-specific logging for production debugging
    if (!info.clerkConfigured) {
      logger.error("Clerk authentication configuration error in production", {
        error: info.clerkValidation.error,
        hasClerkKey: Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY),
        clerkKeyPrefix: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.substring(0, 10),
      });
    }

    // Warn for any optional variables that are missing entirely in prod
    const env = import.meta.env as EnvVars;
    const missingOptional = (OPTIONAL_VARS as readonly string[]).filter(
      (varName) => !env[varName as keyof EnvVars],
    );

    if (missingOptional.length > 0) {
      logger.warn("Optional environment variables are missing in production", {
        missingOptional,
      });
    }

    // Specific note for Sentry to make it obvious when disabled
    if (!env.VITE_SENTRY_DSN) {
      logger.warn("Sentry DSN not set; Sentry is disabled");
    }
  }
}
