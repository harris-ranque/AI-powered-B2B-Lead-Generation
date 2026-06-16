import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";

const DEFAULT_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
/** Skip duplicate pipeline broadcasts for the same stage within this window. */
export const PIPELINE_BROADCAST_COALESCE_MS = 1500;

type BroadcastPriority = "low" | "normal" | "high" | "urgent" | "critical";
type BroadcastStatus = "pending" | "delivered" | "failed" | "expired" | "active";

interface BroadcastDocument extends Record<string, unknown> {
  userId: Id<"users">;
  entityType: string;
  entityId?: string;
  type: string;
  title: string;
  message: string;
  data?: unknown;
  priority: BroadcastPriority;
  category: string;
  tags: string[];
  status: BroadcastStatus;
  delivered: boolean;
  acknowledged: boolean;
  requiresAck: boolean;
  createdAt: number;
  expiresAt: number;
  error?: string;
  deliveredAt?: number;
  acknowledgedAt?: number;
}

function createBroadcastDocument(args: {
  userId: Id<"users">;
  entityType: string;
  entityId?: string;
  type: string;
  title: string;
  message: string;
  data?: unknown;
  priority: BroadcastPriority;
  category: string;
  requiresAck: boolean;
  expiresAt: number;
  tags?: string[];
  status?: BroadcastStatus;
  delivered?: boolean;
  acknowledged?: boolean;
  error?: string;
}): BroadcastDocument {
  const now = Date.now();
  const status: BroadcastStatus =
    args.status ?? (args.error ? "failed" : "pending");
  const delivered = args.delivered ?? false;
  const acknowledged = args.acknowledged ?? false;

  const doc: BroadcastDocument = {
    userId: args.userId,
    entityType: args.entityType,
    entityId: args.entityId,
    type: args.type,
    title: args.title,
    message: args.message,
    data: args.data,
    priority: args.priority,
    category: args.category,
    tags: args.tags ?? [],
    status,
    delivered,
    acknowledged,
    requiresAck: args.requiresAck,
    createdAt: now,
    expiresAt: args.expiresAt,
    error: args.error,
  };

  if (delivered) {
    doc.deliveredAt = now;
  }

  if (acknowledged) {
    doc.acknowledgedAt = now;
  }

  return doc;
}

export type PipelineBroadcastArgs = {
  userId: Id<"users">;
  searchId: string;
  stage: string;
  progress: number;
  message: string;
  data?: unknown;
  error?: string;
  priority?: BroadcastPriority;
};

export function shouldCoalescePipelineBroadcast(
  latest: { createdAt: number; data?: unknown } | null,
  stage: string,
  now: number,
  coalesceMs = PIPELINE_BROADCAST_COALESCE_MS,
): boolean {
  if (!latest?.data || typeof latest.data !== "object") {
    return false;
  }
  const latestStage = (latest.data as Record<string, unknown>).stage;
  return latestStage === stage && now - latest.createdAt < coalesceMs;
}

/**
 * Insert a pipeline status broadcast. Never patches existing rows — concurrent
 * batch progress webhooks were causing OCC conflicts on a single hot document.
 * Coalesces rapid same-stage updates; search.progress holds live counters.
 */
export async function insertPipelineBroadcast(
  ctx: any,
  args: PipelineBroadcastArgs,
): Promise<void> {
  const now = Date.now();
  const hasError = Boolean(args.error);
  const priority: BroadcastPriority =
    args.priority ?? (hasError ? "high" : "normal");

  if (!hasError) {
    const latest = await ctx.db
      .query("statusBroadcasts")
      .withIndex("by_entity", (q: any) =>
        q.eq("entityType", "search").eq("entityId", args.searchId),
      )
      .filter((q: any) => q.eq(q.field("type"), "pipeline_update"))
      .order("desc")
      .first();

    if (shouldCoalescePipelineBroadcast(latest, args.stage, now)) {
      return;
    }
  }

  const baseDoc = createBroadcastDocument({
    userId: args.userId,
    entityType: "search",
    entityId: args.searchId,
    type: "pipeline_update",
    title: `Pipeline ${args.stage}`,
    message: args.message,
    data: {
      searchId: args.searchId,
      stage: args.stage,
      progress: args.progress,
      ...((args.data as Record<string, unknown>) || {}),
      error: args.error,
    },
    priority,
    category: "search_update",
    requiresAck: hasError,
    expiresAt: now + DEFAULT_EXPIRY_MS,
    error: args.error,
    tags: ["pipeline", args.stage],
    status: hasError ? "failed" : "delivered",
    delivered: !hasError,
    acknowledged: !hasError,
  });

  await ctx.db.insert("statusBroadcasts", baseDoc);
}

export const broadcastPipelineUpdate = internalMutation({
  args: {
    userId: v.id("users"),
    searchId: v.id("searches"),
    stage: v.string(),
    progress: v.number(),
    message: v.string(),
    data: v.optional(v.any()),
    error: v.optional(v.string()),
    priority: v.optional(
      v.union(
        v.literal("low"),
        v.literal("normal"),
        v.literal("high"),
        v.literal("urgent"),
        v.literal("critical"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    await insertPipelineBroadcast(ctx, {
      userId: args.userId,
      searchId: args.searchId,
      stage: args.stage,
      progress: args.progress,
      message: args.message,
      data: args.data,
      error: args.error,
      priority: args.priority,
    });
  },
});

export const broadcast = internalMutation({
  args: {
    userId: v.id("users"),
    type: v.string(),
    title: v.string(),
    message: v.string(),
    data: v.optional(v.any()),
    priority: v.optional(
      v.union(
        v.literal("low"),
        v.literal("normal"),
        v.literal("high"),
        v.literal("urgent"),
        v.literal("critical"),
      ),
    ),
    category: v.optional(v.string()),
    entityType: v.optional(v.string()),
    entityId: v.optional(v.string()),
    requiresAck: v.optional(v.boolean()),
    expiresIn: v.optional(v.number()), // milliseconds
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const expiresAt = Date.now() + (args.expiresIn ?? DEFAULT_EXPIRY_MS);
    const priority = (args.priority ?? "normal") as BroadcastPriority;
    const requiresAck = args.requiresAck ?? false;
    const requiresImmediateAttention =
      requiresAck || priority === "critical" || priority === "urgent";
    const doc = createBroadcastDocument({
      userId: args.userId,
      entityType: args.entityType || "system",
      entityId: args.entityId,
      type: args.type,
      title: args.title,
      message: args.message,
      data: args.data,
      priority,
      category: args.category || "general",
      requiresAck,
      expiresAt,
      error: undefined,
      tags: args.tags,
      status: requiresImmediateAttention ? "pending" : "delivered",
      delivered: !requiresImmediateAttention,
    });

    await ctx.db.insert("statusBroadcasts", doc);
  },
});

export const markDelivered = internalMutation({
  args: {
    broadcastId: v.id("statusBroadcasts"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.broadcastId, {
      status: "delivered",
      delivered: true,
      deliveredAt: Date.now(),
    });
  },
});

export const acknowledge = internalMutation({
  args: {
    broadcastId: v.id("statusBroadcasts"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.broadcastId, {
      acknowledged: true,
      acknowledgedAt: Date.now(),
      delivered: true,
      deliveredAt: Date.now(),
      status: "delivered",
    });
  },
});

export const cleanupExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("statusBroadcasts")
      .withIndex("by_expires")
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .take(100);

    for (const broadcast of expired) {
      await ctx.db.patch(broadcast._id, {
        status: "expired",
      });
    }

    return { cleaned: expired.length };
  },
});
