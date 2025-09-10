import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";

// Simple encryption/decryption functions (in production, use proper encryption)
function encryptApiKey(key: string): string {
  // In production, use proper encryption like AES
  return Buffer.from(key).toString('base64');
}

function decryptApiKey(encryptedKey: string): string {
  // In production, use proper decryption
  return Buffer.from(encryptedKey, 'base64').toString('utf8');
}

function hashApiKey(key: string): string {
  // Simple hash for lookup (in production, use proper hashing)
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16);
}

// Add or update API key
export const upsertApiKey = mutation({
  args: {
    service: v.union(
      v.literal("openai"),
      v.literal("google_maps"),
      v.literal("findymail"),
      v.literal("apify")
    ),
    keyName: v.string(),
    apiKey: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    
    // Only starter tier users can manage their own API keys
    if (user.plan !== "starter") {
      throw new Error("API key management is only available for Starter tier users");
    }

    // Check if key already exists for this service
    const existingKey = await ctx.db
      .query("userApiKeys")
      .filter((q) => q.eq(q.field("userId"), user._id))
      .filter((q) => q.eq(q.field("service"), args.service))
      .unique();

    const encryptedKey = encryptApiKey(args.apiKey);
    const keyHash = hashApiKey(args.apiKey);
    
    const keyData = {
      userId: user._id,
      service: args.service,
      keyName: args.keyName,
      encryptedKey,
      keyHash,
      isValid: false, // Will be validated separately
      usageCount: 0,
      isActive: true,
      updatedAt: Date.now(),
    };

    if (existingKey) {
      // Update existing key
      await ctx.db.patch(existingKey._id, keyData);
      
      return { 
        success: true, 
        keyId: existingKey._id,
        action: "updated" 
      };
    } else {
      // Create new key
      const keyId = await ctx.db.insert("userApiKeys", {
        ...keyData,
        createdAt: Date.now(),
      });
      
      return { 
        success: true, 
        keyId,
        action: "created" 
      };
    }
  },
});

// Delete API key
export const deleteApiKey = mutation({
  args: {
    keyId: v.id("userApiKeys"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    
    // Only starter tier users can manage their own API keys
    if (user.plan !== "starter") {
      throw new Error("API key management is only available for Starter tier users");
    }

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
    
    // Only starter tier users can manage their own API keys
    if (user.plan !== "starter") {
      throw new Error("API key management is only available for Starter tier users");
    }

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
    service: v.union(
      v.literal("openai"),
      v.literal("google_maps"),
      v.literal("findymail"),
      v.literal("apify")
    ),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Find the active API key for this service and user
    const apiKey = await ctx.db
      .query("userApiKeys")
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .filter((q) => q.eq(q.field("service"), args.service))
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
    isValid: v.boolean(),
    validationError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db.get(args.keyId);
    
    if (!apiKey) {
      throw new Error("API key not found");
    }

    await ctx.db.patch(args.keyId, {
      isValid: args.isValid,
      lastValidated: Date.now(),
      validationError: args.validationError || undefined,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});