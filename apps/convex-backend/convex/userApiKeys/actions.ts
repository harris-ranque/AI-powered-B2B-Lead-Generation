"use node";

import crypto from "node:crypto";
import { action } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";
import { api, internal } from "../_generated/api";
import {
  ensureUserCanManageKeys,
  providerValidator,
  SUPPORTED_PROVIDERS,
} from "./mutations";

// Crypto helper functions for API key encryption
const AES_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // Recommended IV size for GCM

function resolveEncryptionKey(): Buffer {
  const secret =
    process.env.USER_API_KEY_SECRET ||
    process.env.CONVEX_SITE_SECRET ||
    (process.env.NODE_ENV === "production" ? undefined : "development-secret");

  if (!secret) {
    throw new Error("USER_API_KEY_SECRET environment variable is required");
  }

  if (secret === "development-secret") {
    console.warn(
      "Using fallback encryption key. Set USER_API_KEY_SECRET for production environments.",
    );
  }

  // Derive a 32-byte key for AES-256 from the secret
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptApiKey(key: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(AES_ALGORITHM, resolveEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

function decryptApiKey(encryptedKey: string): string {
  const payload = Buffer.from(encryptedKey, "base64");
  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = payload.subarray(IV_LENGTH + 16);

  const decipher = crypto.createDecipheriv(
    AES_ALGORITHM,
    resolveEncryptionKey(),
    iv,
  );
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

const ENTERPRISE_VALIDATION_PROVIDERS = new Set([
  "openai",
  "tavily",
  "perplexity",
  "google_places",
]);

type Provider = (typeof SUPPORTED_PROVIDERS)[number];

type ValidationResult = {
  valid: boolean;
  error?: string;
  quotaRemaining?: number | null;
};

const workerUrl = process.env.LANGGRAPH_URL;
const workerApiKey = process.env.LANGGRAPH_API_KEY;

async function validateWithWorker(
  provider: Provider,
  apiKey: string,
): Promise<ValidationResult> {
  if (!workerUrl || !workerApiKey) {
    throw new Error("LangGraph worker configuration missing for validation");
  }

  const response = await fetch(`${workerUrl}/validate-key`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${workerApiKey}`,
    },
    body: JSON.stringify({
      provider,
      key: apiKey,
    }),
  });
  let payload: ValidationResult = { valid: false };
  try {
    payload = (await response.json()) as ValidationResult;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to parse validation response";
    throw new Error(message);
  }

  if (!response.ok) {
    const message =
      payload.error || `${response.status} ${response.statusText} validation failure`;
    throw new Error(message);
  }

  return {
    valid: Boolean(payload.valid),
    error: payload.error,
    quotaRemaining: payload.quotaRemaining ?? null,
  };
}

async function validateLegacyProvider(
  provider: Provider,
  apiKey: string,
): Promise<ValidationResult> {
  switch (provider) {
    case "google_maps":
      return { valid: await validateGoogleMapsKey(apiKey) };
    case "findymail":
      return { valid: await validateFindyMailKey(apiKey) };
    case "icypeas":
      return { valid: await validateIcyPeasKey(apiKey) };
    case "apify":
      return { valid: await validateApifyKey(apiKey) };
    default:
      return { valid: false, error: "Unsupported provider for legacy validation" };
  }
}

// Add or update API key (action with crypto operations)
export const upsertApiKey = action({
  args: {
    provider: providerValidator,
    keyName: v.string(),
    apiKey: v.string(),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    keyId: any;
    action: "updated" | "created";
  }> => {
    const user = await requireAuth(ctx);
    ensureUserCanManageKeys(user.plan);

    // Crypto operations in action (allowed with "use node" in crypto.ts)
    const encryptedKey = encryptApiKey(args.apiKey);
    const keyHash = hashApiKey(args.apiKey);

    // Call internal mutation for DB operations
    return await ctx.runMutation(
      internal.userApiKeys.internal.upsertApiKeyInternal,
      {
        userId: user._id,
        provider: args.provider,
        keyName: args.keyName,
        encryptedKey,
        keyHash,
      }
    );
  },
});

// Validate API key by testing it with the actual service
export const validateApiKey = action({
  args: {
    keyId: v.id("userApiKeys"),
  },
  handler: async (ctx, args): Promise<any> => {
    const user = await requireAuth(ctx);

    ensureUserCanManageKeys(user.plan);

    // Get the API key with full details using internal query
    const apiKey = await ctx.runQuery(
      internal.userApiKeys.internal.getApiKeyById,
      {
        keyId: args.keyId,
      },
    );

    if (!apiKey) {
      throw new Error("API key not found");
    }

    if (apiKey.userId !== user._id) {
      throw new Error("Not authorized to validate this API key");
    }

    try {
      const decryptedKey = decryptApiKey((apiKey as any).encryptedKey || "");
      const provider = apiKey.provider as Provider;

      const validation = ENTERPRISE_VALIDATION_PROVIDERS.has(provider)
        ? await validateWithWorker(provider, decryptedKey)
        : await validateLegacyProvider(provider, decryptedKey);

      await ctx.runMutation(api.userApiKeys.mutations.updateValidationStatus, {
        keyId: args.keyId,
        validated: validation.valid,
        lastError: validation.valid ? undefined : validation.error || "Validation failed",
      });

      return {
        success: true,
        isValid: validation.valid,
        provider,
        quotaRemaining: validation.quotaRemaining ?? null,
        validationError: validation.error,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown validation error";

      // Update with error status
      await ctx.runMutation(api.userApiKeys.mutations.updateValidationStatus, {
        keyId: args.keyId,
        validated: false,
        lastError: errorMessage,
      });

      return {
        success: false,
        isValid: false,
        provider: apiKey.provider,
        validationError: errorMessage,
      };
    }
  },
});

// Validate all API keys for a user
export const validateAllApiKeys = action({
  args: {},
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    ensureUserCanManageKeys(user.plan);

    // Get all API keys using internal query with full details
    const apiKeys = await ctx.runQuery(
      internal.userApiKeys.internal.getUserApiKeysInternal,
      {
        userId: user._id,
      },
    );

    const results: any[] = [];

    for (const apiKey of apiKeys) {
      try {
        const result: any = await ctx.runAction(
          api.userApiKeys.actions.validateApiKey,
          {
            keyId: apiKey._id,
          },
        );
        results.push(result);
      } catch (error) {
        results.push({
          success: false,
          isValid: false,
          provider: apiKey.provider,
          validationError:
            error instanceof Error ? error.message : "Validation failed",
        });
      }
    }

    return { success: true, results };
  },
});

// Get decrypted API key for internal use (only for the system to use)
export const getDecryptedApiKey: any = action({
  args: {
    provider: providerValidator,
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // This is an internal action, should only be called by other backend functions

    // Fetch API key internally without requiring auth
    const apiKey = await ctx.runQuery(
      internal.userApiKeys.internal.getApiKeyForUserAndProvider,
      {
        userId: args.userId as any,
        provider: args.provider as any,
      },
    );

    if (!apiKey) {
      throw new Error(`No valid ${args.provider} API key found for user`);
    }

    const decryptedKey = decryptApiKey((apiKey as any).encryptedKey || "");

    // Record usage
    await ctx.runMutation(api.userApiKeys.mutations.recordApiKeyUsage, {
      provider: args.provider,
      userId: args.userId,
    });

    return {
      apiKey: decryptedKey,
      keyId: apiKey._id,
      provider: args.provider,
    };
  },
});

// Resolve user provider keys for use in actions
export const resolveUserProviderKeys = action({
  args: {
    userId: v.id("users"),
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const includeInactive = args.includeInactive ?? false;

    const keys = await ctx.runQuery(
      internal.userApiKeys.internal.getUserApiKeysInternal,
      {
        userId: args.userId,
      },
    );

    const providerKeys: Record<string, string> = {};

    for (const key of keys) {
      if (!includeInactive && (!key.isActive || !key.validated)) {
        continue;
      }

      try {
        providerKeys[key.provider] = decryptApiKey((key as any).encryptedKey || "");
      } catch (error) {
        console.warn("Failed to decrypt provider key", {
          provider: key.provider,
          userId: args.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return providerKeys;
  },
});

async function validateGoogleMapsKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=test&inputtype=textquery&fields=place_id&key=${apiKey}`,
    );

    const data: any = await response.json();
    return response.status === 200 && !data.error_message;
  } catch (error) {
    console.error("Google Maps validation error:", error);
    return false;
  }
}

async function validateFindyMailKey(apiKey: string): Promise<boolean> {
  try {
    // Test with FindyMail API - checking credits endpoint
    const response = await fetch("https://app.findymail.com/api/credits", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    return response.status === 200;
  } catch (error) {
    console.error("FindyMail validation error:", error);
    return false;
  }
}

async function validateIcyPeasKey(apiKey: string): Promise<boolean> {
  try {
    // Test with IcyPeas API - checking credits endpoint
    const response = await fetch("https://app.icypeas.com/api/credits", {
      method: "GET",
      headers: {
        Authorization: apiKey,
      },
    });

    return response.status === 200;
  } catch (error) {
    console.error("IcyPeas validation error:", error);
    return false;
  }
}

async function validateApifyKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.apify.com/v2/users/me?token=${apiKey}`,
    );

    return response.status === 200;
  } catch (error) {
    console.error("Apify validation error:", error);
    return false;
  }
}
