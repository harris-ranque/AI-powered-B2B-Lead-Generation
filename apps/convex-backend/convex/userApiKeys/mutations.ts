import crypto from "node:crypto";

import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";

export const SUPPORTED_PROVIDERS = [
  "openai",
  "tavily",
  "perplexity",
  "google_places",
  // Legacy enrichment providers remain for backwards compatibility
  "google_maps",
  "findymail",
  "icypeas",
  "apify",
] as const;

export const providerValidator = v.union(
  ...SUPPORTED_PROVIDERS.map((provider) => v.literal(provider)),
);

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

export function decryptApiKey(encryptedKey: string): string {
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

export function ensureUserCanManageKeys(plan: string) {
  if (!plan) {
    throw new Error("User plan missing for API key operation");
  }

  // Starter historically supported BYOK for enrichment, enterprise requires it.
  const allowedPlans = new Set(["starter", "enterprise", "business"]);
  if (!allowedPlans.has(plan)) {
    throw new Error("API key management is not enabled for this plan");
  }
}

// Add or update API key
export const upsertApiKey = mutation({
  args: {
    provider: providerValidator,
    keyName: v.string(),
    apiKey: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    ensureUserCanManageKeys(user.plan);

    const existingKey = await ctx.db
      .query("userApiKeys")
      .withIndex("by_user_provider_active", (q) =>
        q
          .eq("userId", user._id)
          .eq("provider", args.provider)
          .eq("isActive", true),
      )
      .unique();

    const encryptedKey = encryptApiKey(args.apiKey);
    const keyHash = hashApiKey(args.apiKey);

    const keyData = {
      userId: user._id,
      provider: args.provider,
      keyName: args.keyName,
      encryptedKey,
      keyHash,
      validated: false, // Must be validated explicitly
      usageCount: existingKey?.usageCount ?? 0,
      isActive: true,
      updatedAt: Date.now(),
    };

    if (existingKey) {
      await ctx.db.patch(existingKey._id, keyData);

      return {
        success: true,
        keyId: existingKey._id,
        action: "updated",
      };
    }

    const keyId = await ctx.db.insert("userApiKeys", {
      ...keyData,
      createdAt: Date.now(),
    });

    return {
      success: true,
      keyId,
      action: "created",
    };
  },
});

// Delete API key
export const deleteApiKey = mutation({
  args: {
    keyId: v.id("userApiKeys"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    ensureUserCanManageKeys(user.plan);

    const apiKey = await ctx.db.get(args.keyId);

    if (!apiKey) {
      throw new Error("API key not found");
    }

    if (apiKey.userId !== user._id) {
      throw new Error("Not authorized to delete this API key");
    }

    await ctx.db.delete(args.keyId);

    return { success: true };
  },
});

// Toggle API key active status
export const toggleApiKey = mutation({
  args: {
    keyId: v.id("userApiKeys"),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    ensureUserCanManageKeys(user.plan);

    const apiKey = await ctx.db.get(args.keyId);

    if (!apiKey) {
      throw new Error("API key not found");
    }

    if (apiKey.userId !== user._id) {
      throw new Error("Not authorized to modify this API key");
    }

    await ctx.db.patch(args.keyId, {
      isActive: args.isActive,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Update API key usage (internal use)
export const recordApiKeyUsage = mutation({
  args: {
    provider: providerValidator,
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db
      .query("userApiKeys")
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .filter((q) => q.eq(q.field("provider"), args.provider))
      .filter((q) => q.eq(q.field("isActive"), true))
      .unique();

    if (apiKey) {
      await ctx.db.patch(apiKey._id, {
        usageCount: apiKey.usageCount + 1,
        lastUsed: Date.now(),
        updatedAt: Date.now(),
      });
    }

    return { success: true };
  },
});

// Update API key validation status (internal use)
export const updateValidationStatus = mutation({
  args: {
    keyId: v.id("userApiKeys"),
    validated: v.boolean(),
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db.get(args.keyId);

    if (!apiKey) {
      throw new Error("API key not found");
    }

    await ctx.db.patch(args.keyId, {
      validated: args.validated,
      validatedAt: Date.now(),
      lastError: args.lastError || undefined,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});
