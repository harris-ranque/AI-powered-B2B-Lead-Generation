import { action } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";
import { api } from "../_generated/api";

// Simple decryption function (matches mutations.ts)
function decryptApiKey(encryptedKey: string): string {
  // In production, use proper decryption
  return Buffer.from(encryptedKey, 'base64').toString('utf8');
}

// Validate API key by testing it with the actual service
export const validateApiKey = action({
  args: {
    keyId: v.id("userApiKeys"),
  },
  handler: async (ctx, args): Promise<any> => {
    const user = await requireAuth(ctx);
    
    // Only starter tier users can validate their API keys
    if (user.plan !== "starter") {
      throw new Error("API key validation is only available for Starter tier users");
    }

    // TODO: Replace with proper query when available
    const apiKey: any = await ctx.runQuery(api.userApiKeys.queries.getUserApiKeys, {});
    
    if (!apiKey) {
      throw new Error("API key not found");
    }

    if (apiKey.userId !== user._id) {
      throw new Error("Not authorized to validate this API key");
    }

    try {
      const decryptedKey = decryptApiKey((apiKey as any).encryptedKey || "");
      let isValid = false;
      let validationError = "";

      // Test the API key with the actual service
      switch (apiKey.service) {
        case "openai":
          isValid = await validateOpenAIKey(decryptedKey);
          break;
        case "google_maps":
          isValid = await validateGoogleMapsKey(decryptedKey);
          break;
        case "findymail":
          isValid = await validateFindyMailKey(decryptedKey);
          break;
        case "apify":
          isValid = await validateApifyKey(decryptedKey);
          break;
        default:
          throw new Error(`Unknown service: ${apiKey.service}`);
      }

      // Update the API key validation status
      await ctx.runMutation(api.userApiKeys.mutations.updateValidationStatus, {
        keyId: args.keyId,
        isValid,
        validationError: isValid ? "" : "API key validation failed",
      });

      return { 
        success: true, 
        isValid,
        service: apiKey.service,
        validationError: isValid ? "" : "API key validation failed",
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown validation error";
      
      // Update with error status
      await ctx.runMutation(api.userApiKeys.mutations.updateValidationStatus, {
        keyId: args.keyId,
        isValid: false,
        validationError: errorMessage,
      });

      return { 
        success: false, 
        isValid: false,
        service: apiKey.service,
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
    
    // Only starter tier users need API key validation
    if (user.plan !== "starter") {
      return { success: true, results: [] };
    }

    // TODO: Replace with proper query when available
    const apiKeys = await ctx.runQuery(api.userApiKeys.queries.getUserApiKeys, {});

    const results: any[] = [];
    
    for (const apiKey of apiKeys) {
      try {
        const result: any = await ctx.runAction(api.userApiKeys.actions.validateApiKey, {
          keyId: apiKey._id,
        });
        results.push(result);
      } catch (error) {
        results.push({
          success: false,
          isValid: false,
          service: apiKey.service,
          validationError: error instanceof Error ? error.message : "Validation failed",
        });
      }
    }

    return { success: true, results };
  },
});

// Get decrypted API key for internal use (only for the system to use)
export const getDecryptedApiKey: any = action({
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
    // This is an internal action, should only be called by other backend functions
    
    // TODO: Replace with proper query when available
    const apiKeys = await ctx.runQuery(api.userApiKeys.queries.getUserApiKeys, {});
    const apiKey = apiKeys.find((k: any) => k.service === args.service && k.userId === args.userId);

    if (!apiKey) {
      throw new Error(`No valid ${args.service} API key found for user`);
    }

    const decryptedKey = decryptApiKey((apiKey as any).encryptedKey || "");
    
    // Record usage
    await ctx.runMutation(api.userApiKeys.mutations.recordApiKeyUsage, {
      service: args.service,
      userId: args.userId,
    });

    return { 
      apiKey: decryptedKey,
      keyId: apiKey._id,
      service: args.service,
    };
  },
});

// Helper functions to validate API keys with actual services
async function validateOpenAIKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    
    return response.status === 200;
  } catch (error) {
    console.error('OpenAI validation error:', error);
    return false;
  }
}

async function validateGoogleMapsKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(`https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=test&inputtype=textquery&fields=place_id&key=${apiKey}`);
    
    const data: any = await response.json();
    return response.status === 200 && !data.error_message;
  } catch (error) {
    console.error('Google Maps validation error:', error);
    return false;
  }
}

async function validateFindyMailKey(apiKey: string): Promise<boolean> {
  try {
    // Test with FindyMail API - checking account info
    const response = await fetch('https://app.findymail.com/api/v1/account', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    
    return response.status === 200;
  } catch (error) {
    console.error('FindyMail validation error:', error);
    return false;
  }
}

async function validateApifyKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(`https://api.apify.com/v2/users/me?token=${apiKey}`);
    
    return response.status === 200;
  } catch (error) {
    console.error('Apify validation error:', error);
    return false;
  }
}