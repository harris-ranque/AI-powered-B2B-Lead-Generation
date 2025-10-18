import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAuth } from "./auth";
import { api } from "./_generated/api";
import {
  ensureUserCanManageKeys,
  providerValidator,
} from "./userApiKeys/mutations";

interface ValidationResponse {
  valid: boolean;
  error?: string;
  quotaRemaining?: number | null;
}

export const validateKey = mutation({
  args: {
    provider: providerValidator,
    apiKey: v.string(),
    keyName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    ensureUserCanManageKeys(user.plan);

    const langgraphUrl = process.env.LANGGRAPH_URL;
    const workerApiKey = process.env.LANGGRAPH_API_KEY;

    if (!langgraphUrl || !workerApiKey) {
      throw new Error("LangGraph worker not configured");
    }

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

    const upsertResult = await ctx.runMutation(api.userApiKeys.mutations.upsertApiKey, {
      provider: args.provider,
      keyName: args.keyName ?? `${args.provider.toUpperCase()} key`,
      apiKey: args.apiKey,
    });

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
