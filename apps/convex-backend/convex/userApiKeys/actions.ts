"use node";

import crypto from "node:crypto";
import { action, internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  ensureUserCanManageKeys,
  providerValidator,
  SUPPORTED_PROVIDERS,
} from "./mutations";

// Crypto helper functions for API key encryption
const AES_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // Recommended IV size for GCM

function resolveEncryptionKey(): Buffer {
  const secret = process.env.USER_API_KEY_SECRET || process.env.CONVEX_SITE_SECRET;

  if (!secret) {
    throw new Error(
      "CRITICAL SECURITY ERROR: USER_API_KEY_SECRET environment variable is required. " +
      "API key encryption cannot proceed without a secure secret. " +
      "Set USER_API_KEY_SECRET in your environment configuration."
    );
  }

  // Validate secret strength (minimum 32 characters for AES-256 security)
  if (secret.length < 32) {
    throw new Error(
      "CRITICAL SECURITY ERROR: USER_API_KEY_SECRET must be at least 32 characters " +
      "to ensure AES-256 encryption security. Current length: " + secret.length
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

type GetDecryptedApiKeyArgs = {
  provider: Provider;
  userId: Id<"users">;
  purpose?: string;
};

type GetDecryptedApiKeyResult = {
  apiKey: string;
  keyId: Id<"userApiKeys">;
  provider: Provider;
};

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
    // Log full error internally for debugging
    console.error("LangGraph validation response parsing error:", {
      provider,
      error: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
    });

    // Return generic error to user
    throw new Error(
      `Unable to validate ${provider} API key. Please verify your key is correct and try again.`
    );
  }

  if (!response.ok) {
    // Log full error internally for debugging
    console.error("LangGraph validation failed:", {
      provider,
      status: response.status,
      statusText: response.statusText,
      error: payload.error,
      timestamp: Date.now(),
    });

    // Return generic error to user
    throw new Error(
      `Unable to validate ${provider} API key. Please verify your key is correct and try again.`
    );
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
    // Pass provider for universal access check (e.g., Instantly is allowed for all plans)
    ensureUserCanManageKeys(user.plan, args.provider);

    // Crypto operations in action (allowed with "use node" in crypto.ts)
    const encryptedKey = encryptApiKey(args.apiKey);
    const keyHash = hashApiKey(args.apiKey);

    // Call internal mutation for DB operations
    const result = await ctx.runMutation(
      internal.userApiKeys.internal.upsertApiKeyInternal,
      {
        userId: user._id,
        provider: args.provider,
        keyName: args.keyName,
        encryptedKey,
        keyHash,
      }
    );

    // Log key creation/update
    await ctx.runMutation(internal.userApiKeys.internal.logApiKeyAccess, {
      userId: user._id,
      keyId: result.keyId,
      action: "created",
      purpose: result.action === "created" ? "new_key" : "key_update",
      success: true,
    });

    return result;
  },
});

// Validate API key by testing it with the actual service
export const validateApiKey = action({
  args: {
    keyId: v.id("userApiKeys"),
  },
  handler: async (ctx, args): Promise<any> => {
    const user = await requireAuth(ctx);

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

    // Pass provider for universal access check (e.g., Instantly is allowed for all plans)
    ensureUserCanManageKeys(user.plan, apiKey.provider);

    let validationSuccess = false;
    let validationError: string | undefined;

    try {
      const decryptedKey = decryptApiKey((apiKey as any).encryptedKey || "");
      const provider = apiKey.provider as Provider;

      const validation = ENTERPRISE_VALIDATION_PROVIDERS.has(provider)
        ? await validateWithWorker(provider, decryptedKey)
        : await validateLegacyProvider(provider, decryptedKey);

      validationSuccess = validation.valid;
      validationError = validation.error;

      await ctx.runMutation(api.userApiKeys.mutations.updateValidationStatus, {
        keyId: args.keyId,
        validated: validation.valid,
        lastError: validation.valid ? undefined : "API key validation failed",
      });

      // Log successful validation
      await ctx.runMutation(internal.userApiKeys.internal.logApiKeyAccess, {
        userId: user._id,
        keyId: args.keyId,
        action: "validated",
        purpose: "user_validation",
        success: validation.valid,
        errorMessage: validation.valid ? undefined : "Validation failed",
      });

      return {
        success: true,
        isValid: validation.valid,
        provider,
        quotaRemaining: validation.quotaRemaining ?? null,
        validationError: validation.valid ? undefined : "API key validation failed. Please verify your key is correct.",
      };
    } catch (error) {
      const sanitizedError = "API key validation failed. Please verify your key is correct.";

      // Log detailed error internally
      console.error("API key validation error:", {
        keyId: args.keyId,
        provider: apiKey.provider,
        userId: user._id,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      });

      // Update with error status
      await ctx.runMutation(api.userApiKeys.mutations.updateValidationStatus, {
        keyId: args.keyId,
        validated: false,
        lastError: sanitizedError,
      });

      // Log failed validation attempt
      await ctx.runMutation(internal.userApiKeys.internal.logApiKeyAccess, {
        userId: user._id,
        keyId: args.keyId,
        action: "validated",
        purpose: "user_validation",
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        isValid: false,
        provider: apiKey.provider,
        validationError: sanitizedError,
      };
    }
  },
});

// Validate all API keys for a user
export const validateAllApiKeys = action({
  args: {},
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // No plan check here - validateApiKey will check each key's provider individually
    // This allows users to validate their universal provider keys (e.g., Instantly)
    // while validateApiKey enforces per-provider access control

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
export const getDecryptedApiKey = internalAction({
  args: {
    provider: providerValidator,
    userId: v.id("users"),
    purpose: v.optional(v.string()),
  },
  handler: async (
    ctx: ActionCtx,
    args: GetDecryptedApiKeyArgs,
  ): Promise<GetDecryptedApiKeyResult> => {
    let apiKey: Doc<"userApiKeys"> | null = await ctx.runQuery(
      internal.userApiKeys.internal.getApiKeyForUserAndProvider,
      {
        userId: args.userId,
        provider: args.provider,
      },
    );

    // Migration: Auto-fallback to google_maps if google_places is requested but not found
    if (!apiKey && args.provider === "google_places") {
      apiKey = await ctx.runQuery(
        internal.userApiKeys.internal.getApiKeyForUserAndProvider,
        {
          userId: args.userId,
          provider: "google_maps",
        },
      );

      if (apiKey) {
        console.warn(
          `⚠️ DEPRECATION: User ${args.userId} is using legacy google_maps key. ` +
          `Please migrate to google_places by re-saving your Google Places API key.`
        );
      }
    }

    if (!apiKey) {
      throw new Error(`No valid ${args.provider} API key found for user`);
    }

    let decryptedKey: string;

    try {
      decryptedKey = decryptApiKey((apiKey as any).encryptedKey || "");

      await ctx.runMutation(internal.userApiKeys.internal.logApiKeyAccess, {
        userId: args.userId,
        keyId: apiKey._id,
        action: "decrypted",
        purpose: args.purpose ?? "system_use",
        success: true,
      });
    } catch (error) {
      await ctx.runMutation(internal.userApiKeys.internal.logApiKeyAccess, {
        userId: args.userId,
        keyId: apiKey._id,
        action: "decrypted",
        purpose: args.purpose ?? "system_use",
        success: false,
        errorMessage: error instanceof Error ? error.message : "Decryption failed",
      });

      throw error;
    }

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

// Resolve user provider keys for internal backend flows
export const resolveUserProviderKeys = internalAction({
  args: {
    userId: v.id("users"),
    includeInactive: v.optional(v.boolean()),
    purpose: v.optional(v.string()),
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
    let hasLegacyGoogleMaps = false;

    for (const key of keys) {
      if (!includeInactive && (!key.isActive || !key.validated)) {
        continue;
      }

      try {
        const decryptedKey = decryptApiKey((key as any).encryptedKey || "");
        providerKeys[key.provider] = decryptedKey;

        // Migration: If google_maps key found, also set as google_places for compatibility
        if (key.provider === "google_maps") {
          providerKeys["google_places"] = decryptedKey;
          hasLegacyGoogleMaps = true;
        }

        await ctx.runMutation(internal.userApiKeys.internal.logApiKeyAccess, {
          userId: args.userId,
          keyId: key._id,
          action: "decrypted",
          purpose: args.purpose ?? "provider_bundle_resolution",
          success: true,
        });
      } catch (error) {
        await ctx.runMutation(internal.userApiKeys.internal.logApiKeyAccess, {
          userId: args.userId,
          keyId: key._id,
          action: "decrypted",
          purpose: args.purpose ?? "provider_bundle_resolution",
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        });

        console.warn("Failed to decrypt provider key", {
          provider: key.provider,
          userId: args.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Log deprecation warning if legacy google_maps key is being used
    if (hasLegacyGoogleMaps && !keys.some((k: { provider: string; isActive: boolean; validated?: boolean }) => k.provider === "google_places" && k.isActive && k.validated)) {
      console.warn(
        `⚠️ DEPRECATION: User ${args.userId} is using legacy google_maps key. ` +
        `Please migrate to google_places by re-saving your Google Places API key.`
      );
    }

    return providerKeys;
  },
});

async function validateGoogleMapsKey(apiKey: string): Promise<boolean> {
  try {
    // Use a more specific test query that should always return results with a valid key
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=restaurant&inputtype=textquery&fields=place_id,name&key=${apiKey}`,
    );

    const data: any = await response.json();

    // Check for successful API response status
    // ZERO_RESULTS is acceptable - it means the key works but no results found
    // OK with results means the key works perfectly
    // Any error_message indicates a problem with the key
    if (data.error_message) {
      console.error("Google Maps validation error:", data.error_message);
      return false;
    }

    return response.status === 200 && (data.status === "OK" || data.status === "ZERO_RESULTS");
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
