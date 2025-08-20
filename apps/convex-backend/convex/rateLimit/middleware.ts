import { GenericMutationCtx, GenericActionCtx } from "convex/server";
import { DataModel } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { getCurrentUser } from "../auth";
import { Id } from "../_generated/dataModel";

/**
 * Rate Limiting Middleware
 * 
 * Easy-to-use middleware for protecting endpoints with rate limiting
 */

export class RateLimitError extends Error {
  constructor(
    message: string,
    public retryAfter: number,
    public currentUsage: number,
    public limit: number
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

// Rate limit middleware for mutations
export async function withRateLimit<T>(
  ctx: GenericMutationCtx<DataModel>,
  operation: "searches" | "enrichment" | "ai_analysis" | "api_calls",
  fn: () => Promise<T>,
  options: {
    requestCount?: number;
    skipAuthCheck?: boolean;
    customUserId?: string;
  } = {}
): Promise<T> {
  const { requestCount = 1, skipAuthCheck = false, customUserId } = options;

  // Get user ID
  let userId: string;
  if (customUserId) {
    userId = customUserId;
  } else if (skipAuthCheck) {
    throw new Error("Must provide customUserId when skipping auth check");
  } else {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("Authentication required for rate limiting");
    }
    userId = user._id;
  }

  // Check rate limit
  const rateLimitResult = await ctx.runMutation(internal.rateLimit.internal.checkRateLimit, {
    userId,
    operation,
    requestCount,
  });

  if (!rateLimitResult.allowed) {
    throw new RateLimitError(
      `Rate limit exceeded for ${operation}. Try again in ${rateLimitResult.retryAfter} seconds.`,
      rateLimitResult.retryAfter,
      rateLimitResult.currentUsage,
      rateLimitResult.limit
    );
  }

  // Execute the function if rate limit passed
  try {
    return await fn();
  } catch (error) {
    // Note: We don't rollback the rate limit record on error
    // This prevents abuse where users intentionally trigger errors
    // to avoid rate limit counts
    throw error;
  }
}

// Rate limit middleware for actions
export async function withRateLimitAction<T>(
  ctx: GenericActionCtx<DataModel>,
  operation: "searches" | "enrichment" | "ai_analysis" | "api_calls",
  fn: () => Promise<T>,
  options: {
    requestCount?: number;
    userId?: string;
  } = {}
): Promise<T> {
  const { requestCount = 1, userId } = options;

  if (!userId) {
    throw new Error("userId required for action rate limiting");
  }

  // Check rate limit
  const rateLimitResult = await ctx.runMutation(internal.rateLimit.internal.checkRateLimit, {
    userId,
    operation,
    requestCount,
  });

  if (!rateLimitResult.allowed) {
    throw new RateLimitError(
      `Rate limit exceeded for ${operation}. Try again in ${rateLimitResult.retryAfter} seconds.`,
      rateLimitResult.retryAfter,
      rateLimitResult.currentUsage,
      rateLimitResult.limit
    );
  }

  // Execute the function if rate limit passed
  return await fn();
}

// Batch rate limiting for bulk operations
export async function withBatchRateLimit<T>(
  ctx: GenericMutationCtx<DataModel>,
  operation: "searches" | "enrichment" | "ai_analysis" | "api_calls",
  batchSize: number,
  fn: () => Promise<T>,
  options: {
    userId?: string;
    maxBatchSize?: number;
  } = {}
): Promise<T> {
  const { userId, maxBatchSize = 100 } = options;

  if (batchSize > maxBatchSize) {
    throw new Error(`Batch size ${batchSize} exceeds maximum allowed ${maxBatchSize}`);
  }

  // Use the standard rate limiting with the batch size as request count
  const rateLimitOptions = {
    requestCount: batchSize,
    skipAuthCheck: !!userId,
    ...(userId && { customUserId: userId })
  };
  return await withRateLimit(ctx, operation, fn, rateLimitOptions);
}

// Smart rate limiting that adjusts based on operation cost
export async function withSmartRateLimit<T>(
  ctx: GenericMutationCtx<DataModel>,
  operations: Array<{
    type: "searches" | "enrichment" | "ai_analysis" | "api_calls";
    count: number;
    weight?: number; // Cost multiplier
  }>,
  fn: () => Promise<T>,
  userId?: string
): Promise<T> {
  // Get user
  const user = userId ? 
    await ctx.db.get(userId as Id<"users">) : 
    await getCurrentUser(ctx);

  if (!user) {
    throw new Error("Authentication required for smart rate limiting");
  }

  // Check each operation type
  for (const op of operations) {
    const weight = op.weight || 1;
    const adjustedCount = Math.ceil(op.count * weight);

    const rateLimitResult = await ctx.runMutation(internal.rateLimit.internal.checkRateLimit, {
      userId: user._id,
      operation: op.type,
      requestCount: adjustedCount,
    });

    if (!rateLimitResult.allowed) {
      throw new RateLimitError(
        `Rate limit exceeded for ${op.type} (weighted: ${adjustedCount}). Try again in ${rateLimitResult.retryAfter} seconds.`,
        rateLimitResult.retryAfter,
        rateLimitResult.currentUsage,
        rateLimitResult.limit
      );
    }
  }

  // All rate limits passed, execute function
  return await fn();
}

// Rate limit guard decorator
export function rateLimited(
  operation: "searches" | "enrichment" | "ai_analysis" | "api_calls",
  options: {
    requestCount?: number;
    skipAuthCheck?: boolean;
  } = {}
) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (ctx: GenericMutationCtx<DataModel>, ...args: any[]) {
      return await withRateLimit(
        ctx,
        operation,
        () => originalMethod.call(this, ctx, ...args),
        options
      );
    };

    return descriptor;
  };
}

// Rate limit status helper
export async function getRateLimitInfo(
  ctx: GenericMutationCtx<DataModel> | GenericActionCtx<DataModel>,
  userId?: string
): Promise<any> {
  let user;
  if (userId) {
    if ("db" in ctx) {
      user = await ctx.db.get(userId as Id<"users">);
    } else {
      // Action context - use runQuery
      user = await ctx.runQuery(internal.users.admin.getUserByIdInternal, { 
        userId: userId as Id<"users"> 
      });
    }
  } else {
    user = await getCurrentUser(ctx);
  }

  if (!user) {
    throw new Error("Authentication required");
  }

  if ("runQuery" in ctx) {
    // Action context
    return await ctx.runQuery(internal.rateLimit.internal.getRateLimitStatus, {
      userId: user._id,
    });
  } else {
    // Mutation context
    return await ctx.runQuery(internal.rateLimit.internal.getRateLimitStatus, {
      userId: user._id,
    });
  }
}

// Helper to check if operation would exceed rate limit (without recording)
export async function checkWouldExceedRateLimit(
  ctx: GenericMutationCtx<DataModel>,
  operation: "searches" | "enrichment" | "ai_analysis" | "api_calls",
  requestCount: number = 1,
  userId?: string
): Promise<{
  wouldExceed: boolean;
  currentUsage: number;
  limit: number;
  remainingRequests: number;
}> {
  const user = userId ? 
    await ctx.db.get(userId as Id<"users">) : 
    await getCurrentUser(ctx);

  if (!user) {
    throw new Error("Authentication required");
  }

  const status = await ctx.runQuery(internal.rateLimit.internal.getRateLimitStatus, {
    userId: user._id,
  });

  const operationStatus = status.status[operation];
  const wouldExceed = (operationStatus.currentUsage + requestCount) > operationStatus.limit;

  return {
    wouldExceed,
    currentUsage: operationStatus.currentUsage,
    limit: operationStatus.limit,
    remainingRequests: operationStatus.remainingRequests,
  };
}

// Emergency rate limit bypass for critical operations
export async function bypassRateLimit<T>(
  ctx: GenericMutationCtx<DataModel>,
  reason: string,
  fn: () => Promise<T>,
  userId?: string
): Promise<T> {
  const user = userId ? 
    await ctx.db.get(userId as Id<"users">) : 
    await getCurrentUser(ctx);

  if (!user) {
    throw new Error("Authentication required");
  }

  // Log the bypass for audit purposes
  console.warn(`Rate limit bypassed for user ${user._id}: ${reason}`);
  
  // Record bypass in system logs
  await ctx.db.insert("systemLogs", {
    type: "rate_limit_bypass",
    action: "bypass_granted",
    userId: user._id,
    data: {
      reason,
      timestamp: Date.now(),
      userPlan: user.plan,
      isAdmin: user.role === "admin",
    },
    timestamp: Date.now(),
  });

  return await fn();
}