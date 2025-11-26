/**
 * Environment Variable Validation System
 *
 * Ensures all required environment variables are present and valid
 * before application startup to prevent runtime failures.
 */

interface RequiredEnvVar {
  name: string;
  description: string;
  required: boolean;
  validate?: (value: string) => boolean;
}

export const REQUIRED_ENV_VARS: RequiredEnvVar[] = [
  // Core API Keys
  {
    name: "OPENAI_API_KEY",
    description: "OpenAI API key for LangGraph AI operations",
    required: true,
    validate: (value: string) => value.startsWith("sk-"),
  },
  {
    name: "GOOGLE_MAPS_API_KEY",
    description: "Google Maps API key for lead discovery",
    required: true,
  },
  {
    name: "FINDYMAIL_API_KEY",
    description: "FindyMail API key for email enrichment",
    required: true,
  },

  // Clerk Authentication
  {
    name: "CLERK_SECRET_KEY",
    description: "Clerk secret key for JWT verification",
    required: true,
    validate: (value: string) => value.startsWith("sk_"),
  },
  {
    name: "CLERK_WEBHOOK_SECRET",
    description: "Clerk webhook secret for signature verification",
    required: true,
    validate: (value: string) => value.startsWith("whsec_"),
  },
  {
    name: "CLERK_JWT_ISSUER_DOMAIN",
    description: "Clerk JWT issuer domain",
    required: true,
    validate: (value: string) => value.includes("clerk."),
  },
  {
    name: "CLERK_SYNC_TOKEN",
    description: "Shared secret used to authorize Clerk user sync migrations",
    required: false,
  },

  // FastSpring Payment Processing
  {
    name: "FASTSPRING_API_USERNAME",
    description: "FastSpring API username for secure checkout",
    required: true,
  },
  {
    name: "FASTSPRING_API_PASSWORD",
    description: "FastSpring API password for secure checkout",
    required: true,
  },
  {
    name: "FASTSPRING_WEBHOOK_SECRET",
    description: "FastSpring webhook secret for HMAC signature verification",
    required: true,
  },
  {
    name: "FASTSPRING_PRIVATE_KEY",
    description: "FastSpring RSA private key for secure payload encryption",
    required: true,
  },

  // LangGraph Worker
  {
    name: "LANGGRAPH_URL",
    description: "LangGraph worker service URL",
    required: true,
    validate: (value: string) => value.startsWith("http"),
  },
  {
    name: "LANGGRAPH_API_KEY",
    description: "LangGraph worker API key",
    required: true,
  },

  // Application Configuration
  {
    name: "APP_URL",
    description: "Application frontend URL",
    required: true,
    validate: (value: string) => value.startsWith("http"),
  },
  {
    name: "ADMIN_EMAILS",
    description: "Comma-separated list of admin email addresses",
    required: true,
    validate: (value: string) => value.includes("@"),
  },

  // Optional but recommended
  {
    name: "FINDYMAIL_WEBHOOK_SECRET",
    description: "FindyMail webhook secret for async operations",
    required: false,
  },
  {
    name: "DEVELOPER_EMAIL",
    description: "Developer email for notifications",
    required: false,
    validate: (value: string) => value.includes("@"),
  },
];

export interface ValidationResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  missing: string[];
  invalid: string[];
}

/**
 * Validates all required environment variables
 */
export function validateEnvironmentVariables(): ValidationResult {
  const result: ValidationResult = {
    success: true,
    errors: [],
    warnings: [],
    missing: [],
    invalid: [],
  };

  for (const envVar of REQUIRED_ENV_VARS) {
    const value = process.env[envVar.name];

    if (!value) {
      if (envVar.required) {
        result.missing.push(envVar.name);
        result.errors.push(
          `Missing required environment variable: ${envVar.name} - ${envVar.description}`,
        );
        result.success = false;
      } else {
        result.warnings.push(
          `Optional environment variable not set: ${envVar.name} - ${envVar.description}`,
        );
      }
      continue;
    }

    // Validate format if validator provided
    if (envVar.validate && !envVar.validate(value)) {
      result.invalid.push(envVar.name);
      result.errors.push(
        `Invalid format for environment variable: ${envVar.name} - ${envVar.description}`,
      );
      result.success = false;
    }
  }

  return result;
}

/**
 * Validates environment variables and throws detailed error if validation fails
 */
export function ensureValidEnvironment(): void {
  const validation = validateEnvironmentVariables();

  if (!validation.success) {
    const errorMessage = [
      "❌ ENVIRONMENT VALIDATION FAILED",
      "",
      "The following environment variables are required but missing or invalid:",
      "",
      ...validation.errors.map((error) => `  • ${error}`),
      "",
      "Please check your .env.local file and ensure all required variables are set.",
      "",
      "For deployment, ensure environment variables are configured in your deployment platform.",
    ].join("\n");

    console.error(errorMessage);
    throw new Error("Environment validation failed - see logs for details");
  }

  if (validation.warnings.length > 0) {
    console.warn("⚠️  Environment warnings:");
    validation.warnings.forEach((warning) => console.warn(`  • ${warning}`));
  }

  console.log("✅ Environment validation passed");
}

/**
 * Get a required environment variable with validation
 */
export function getRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

/**
 * Get an optional environment variable with default value
 */
export function getOptionalEnvVar(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

/**
 * Check if we're in production environment
 */
export function isProduction(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.CONVEX_CLOUD_URL !== undefined
  );
}

/**
 * Check if we're in development environment
 */
export function isDevelopment(): boolean {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.CONVEX_CLOUD_URL === undefined
  );
}

/**
 * Runtime environment validation for webhook endpoints
 */
export function validateWebhookEnvironment(): void {
  const requiredForWebhooks = [
    "CLERK_WEBHOOK_SECRET",
    "FASTSPRING_WEBHOOK_SECRET",
    "LANGGRAPH_API_KEY",
  ];

  const missing = requiredForWebhooks.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw new Error(
      `Webhook environment validation failed. Missing: ${missing.join(", ")}`,
    );
  }
}
