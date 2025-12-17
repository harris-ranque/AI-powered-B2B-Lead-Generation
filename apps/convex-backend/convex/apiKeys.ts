"use node";

import crypto from "node:crypto";
import { action } from "./_generated/server";
import { v } from "convex/values";
import { requireAuth } from "./auth";
import { api, internal } from "./_generated/api";
import {
  ensureUserCanManageKeys,
  providerValidator,
} from "./userApiKeys/mutations";
import type { Id } from "./_generated/dataModel";

interface ValidationResponse {
  valid: boolean;
  error?: string;
  quotaRemaining?: number | null;
}

interface UpsertResult {
  success: boolean;
  keyId: Id<"userApiKeys">;
  action: "updated" | "created";
}

// Crypto helper functions for API key encryption
const AES_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function resolveEncryptionKey(): Buffer {
  const secret = process.env.USER_API_KEY_SECRET || process.env.CONVEX_SITE_SECRET;

  if (!secret) {
    throw new Error(
      "CRITICAL SECURITY ERROR: USER_API_KEY_SECRET environment variable is required"
    );
  }

  if (secret.length < 32) {
    throw new Error(
      "CRITICAL SECURITY ERROR: USER_API_KEY_SECRET must be at least 32 characters"
    );
  }

  return crypto.createHash("sha256").update(secret).digest();
}

function encryptApiKey(key: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(AES_ALGORITHM, resolveEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export const validateKey = action({
  args: {
    provider: providerValidator,
    apiKey: v.string(),
    keyName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    console.log("validateKey: Starting", { provider: args.provider });

    const user = await requireAuth(ctx);
    console.log("validateKey: User authenticated", { userId: user._id, plan: user.plan });

    ensureUserCanManageKeys(user.plan, args.provider);
    console.log("validateKey: User can manage keys");

    const langgraphUrl = process.env.LANGGRAPH_URL;
    const workerApiKey = process.env.LANGGRAPH_API_KEY;

    console.log("validateKey: Environment check", {
      hasLanggraphUrl: !!langgraphUrl,
      hasWorkerApiKey: !!workerApiKey,
      langgraphUrlLength: langgraphUrl?.length,
      workerApiKeyLength: workerApiKey?.length,
    });

    if (!langgraphUrl || !workerApiKey) {
      console.error("validateKey: Missing environment variables", {
        langgraphUrl,
        workerApiKey: workerApiKey ? "***SET***" : "MISSING",
      });
      throw new Error("LangGraph worker not configured");
    }

    console.log("validateKey: Calling LangGraph worker", { url: langgraphUrl });

    const response = await fetch(`${langgraphUrl}/validate-key`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${workerApiKey}`,
      },
      body: JSON.stringify({
        provider: args.provider,
        key: args.apiKey,
      }),
    });

    let payload: ValidationResponse = { valid: false };
    try {
      payload = (await response.json()) as ValidationResponse;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to parse validation response";
      throw new Error(message);
    }

    if (!response.ok) {
      throw new Error(payload.error || "Provider validation failed");
    }

    // ✅ FIX: Handle encryption directly to avoid nested action auth issues
    const encryptedKey = encryptApiKey(args.apiKey);
    const keyHash = hashApiKey(args.apiKey);

    // Call internal mutation directly with encrypted data
    const upsertResult: UpsertResult = await ctx.runMutation(
      internal.userApiKeys.internal.upsertApiKeyInternal,
      {
        userId: user._id,
        provider: args.provider,
        keyName: args.keyName ?? `${args.provider.toUpperCase()} key`,
        encryptedKey,
        keyHash,
      }
    );

    // Log key creation/update
    await ctx.runMutation(internal.userApiKeys.internal.logApiKeyAccess, {
      userId: user._id,
      keyId: upsertResult.keyId,
      action: "created",
      purpose: upsertResult.action === "created" ? "new_key" : "key_update",
      success: true,
    });

    // Update validation status
    await ctx.runMutation(api.userApiKeys.mutations.updateValidationStatus, {
      keyId: upsertResult.keyId,
      validated: payload.valid,
      lastError: payload.valid ? undefined : payload.error,
    });

    return {
      ...payload,
      keyId: upsertResult.keyId,
    };
  },
});
