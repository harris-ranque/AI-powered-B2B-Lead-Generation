// Environment validation utility for runtime checks

interface EnvVars {
  VITE_CONVEX_URL?: string;
  VITE_STRIPE_PUBLISHABLE_KEY?: string;
  VITE_POSTHOG_KEY?: string;
  VITE_POSTHOG_HOST?: string;
  VITE_CREWAI_URL?: string;
  VITE_CREWAI_API_KEY?: string;
}

interface ValidationResult {
  isValid: boolean;
  missing: string[];
  warnings: string[];
  errors: string[];
}

const REQUIRED_VARS = ["VITE_CONVEX_URL"] as const;
const OPTIONAL_VARS = [
  "VITE_STRIPE_PUBLISHABLE_KEY",
  "VITE_POSTHOG_KEY",
  "VITE_POSTHOG_HOST",
  "VITE_CREWAI_URL",
  "VITE_CREWAI_API_KEY",
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

export function getEnvironmentInfo() {
  const validation = validateEnvironment();
  const env = import.meta.env;

  return {
    mode: env.MODE,
    dev: env.DEV,
    prod: env.PROD,
    base: env.BASE_URL,
    validation,
    convexConfigured: Boolean(
      env.VITE_CONVEX_URL &&
        env.VITE_CONVEX_URL !== "https://placeholder.convex.cloud",
    ),
    hasStripe: Boolean(
      env.VITE_STRIPE_PUBLISHABLE_KEY &&
        !env.VITE_STRIPE_PUBLISHABLE_KEY.includes("..."),
    ),
    hasAnalytics: Boolean(
      env.VITE_POSTHOG_KEY && !env.VITE_POSTHOG_KEY.includes("..."),
    ),
  };
}

// Development helper to log environment status
export function logEnvironmentStatus() {
  if (import.meta.env.DEV) {
    const info = getEnvironmentInfo();
    console.group("🔧 Environment Status");
    console.log("Mode:", info.mode);
    console.log("Convex Configured:", info.convexConfigured);
    console.log("Stripe Configured:", info.hasStripe);
    console.log("Analytics Configured:", info.hasAnalytics);

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
  }
}
