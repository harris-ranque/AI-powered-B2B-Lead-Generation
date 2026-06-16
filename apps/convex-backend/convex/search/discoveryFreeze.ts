/**
 * Discovery freeze / replay for pipeline testing.
 *
 * Freeze Google Maps discovery on a search, then start new searches (or restart)
 * from enrichment without re-calling Google Maps or re-running role expansion AI.
 */
import { v } from "convex/values";
import { internalAction, internalMutation, mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAuth } from "../auth";
import { isAdmin } from "../lib/helpers";
import {
  buildClonedDiscoveryLeadInsert,
  canUseAsFrozenDiscoverySource,
} from "../lib/discoveryFreeze";
import { isUpdatedAtSchemaError, withUpdatedAtIfSupported } from "./utils";
import { createConvexError, ERROR_CODES } from "../lib/errorHandling";

const DISCOVERY_METADATA_FIELDS = [
  "initialSearchRadius",
  "finalSearchRadius",
  "expansionIterations",
  "duplicatesFilteredPlaceName",
  "duplicatesFilteredEmail",
  "duplicatesFilteredAddress",
  "duplicatesFilteredPlaceId",
  "discoveryMetadata",
] as const;

export const freezeSearchDiscovery = mutation({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const search = await ctx.db.get(args.searchId);

    if (!search) {
      throw createConvexError("validation", "Search not found", {
        code: ERROR_CODES.NOT_FOUND,
        severity: "medium",
        retryable: false,
      });
    }

    if (!isAdmin(user) && search.userId !== user._id) {
      throw createConvexError("authorization", "Search not found or access denied", {
        code: ERROR_CODES.FORBIDDEN,
        severity: "medium",
        retryable: false,
      });
    }

    const sampleLead = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .first();

    if (!sampleLead) {
      throw createConvexError(
        "validation",
        "Cannot freeze discovery — no leads found. Run Google Maps discovery first.",
        {
          code: ERROR_CODES.VALIDATION_FAILED,
          severity: "medium",
          retryable: false,
        },
      );
    }

    const now = Date.now();
    const patch = withUpdatedAtIfSupported(
      { discoveryFrozenAt: now },
      search,
      now,
    );

    try {
      await ctx.db.patch(args.searchId, patch);
    } catch (error) {
      if (!isUpdatedAtSchemaError(error)) {
        throw error;
      }
      await ctx.db.patch(args.searchId, { discoveryFrozenAt: now });
    }

    return {
      success: true,
      searchId: args.searchId,
      discoveryFrozenAt: now,
    };
  },
});

export const restartSearchFromEnrichment = mutation({
  args: {
    searchId: v.id("searches"),
    clearContacts: v.optional(v.boolean()),
    clearEnrichmentCache: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const search = await ctx.db.get(args.searchId);

    if (!search) {
      throw createConvexError("validation", "Search not found", {
        code: ERROR_CODES.NOT_FOUND,
        severity: "medium",
        retryable: false,
      });
    }

    if (!isAdmin(user) && search.userId !== user._id) {
      throw createConvexError("authorization", "Search not found or access denied", {
        code: ERROR_CODES.FORBIDDEN,
        severity: "medium",
        retryable: false,
      });
    }

    const clearContacts = args.clearContacts ?? true;
    const clearEnrichmentCache = args.clearEnrichmentCache ?? true;
    const now = Date.now();
    let resetLeadCount = 0;
    let deletedContacts = 0;

    for await (const lead of ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))) {
      resetLeadCount += 1;
      await ctx.db.patch(lead._id, {
        enrichmentStatus: "pending",
        enrichmentProvider: undefined,
        contactInfo: undefined,
        analysisStatus: undefined,
        updatedAt: now,
      });

      if (clearContacts) {
        const contacts = await ctx.db
          .query("leadContacts")
          .withIndex("by_lead", (q) => q.eq("leadId", lead._id))
          .collect();
        for (const contact of contacts) {
          await ctx.db.delete(contact._id);
          deletedContacts += 1;
        }
      }
    }

    if (clearEnrichmentCache) {
      const cacheEntries = await ctx.db
        .query("enrichmentCache")
        .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
        .collect();
      for (const entry of cacheEntries) {
        await ctx.db.delete(entry._id);
      }
    }

    const statusPatch = withUpdatedAtIfSupported(
      {
        status: "in_progress" as const,
        enrichmentCheckpoint: undefined,
        completionTriggered: undefined,
        completionTriggeredAt: undefined,
        progress: {
          discovered: resetLeadCount,
          enriched: 0,
          analyzed: 0,
          total: resetLeadCount,
        },
        results: {
          ...search.results,
          enrichedCount: 0,
          analyzedCount: 0,
          exportableCount: 0,
        },
        error: undefined,
        completedAt: undefined,
      },
      search,
      now,
    );

    try {
      await ctx.db.patch(args.searchId, statusPatch);
    } catch (error) {
      if (!isUpdatedAtSchemaError(error)) {
        throw error;
      }
      const { updatedAt: _unused, ...patchWithoutTimestamp } = statusPatch as typeof statusPatch & {
        updatedAt?: number;
      };
      await ctx.db.patch(args.searchId, patchWithoutTimestamp);
    }

    await ctx.scheduler.runAfter(0, "leads/actions:enrichLeads" as any, {
      searchId: args.searchId,
    });

    return {
      success: true,
      searchId: args.searchId,
      resetLeadCount,
      deletedContacts,
      enrichmentCacheCleared: clearEnrichmentCache,
    };
  },
});

export const cloneDiscoveryLeadsInternal = internalMutation({
  args: {
    targetSearchId: v.id("searches"),
    sourceSearchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const targetSearch = await ctx.db.get(args.targetSearchId);
    const sourceSearch = await ctx.db.get(args.sourceSearchId);

    if (!targetSearch || !sourceSearch) {
      throw new Error("Target or source search not found");
    }

    const maxResults = targetSearch.parameters.maxResults;
    const existingPlaceIds = new Set<string>();
    for await (const existing of ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.targetSearchId))) {
      existingPlaceIds.add(existing.placeId);
    }

    const leadIds: string[] = [];
    const now = Date.now();

    for await (const sourceLead of ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.sourceSearchId))) {
      if (leadIds.length >= maxResults) {
        break;
      }
      if (existingPlaceIds.has(sourceLead.placeId)) {
        continue;
      }

      const leadId = await ctx.db.insert(
        "leads",
        buildClonedDiscoveryLeadInsert(
          sourceLead,
          args.targetSearchId,
          targetSearch.userId,
          now,
        ),
      );
      leadIds.push(leadId);
      existingPlaceIds.add(sourceLead.placeId);
    }

    const discoveryPatch: Record<string, unknown> = {
      clonedFromSearchId: args.sourceSearchId,
      progress: {
        discovered: leadIds.length,
        enriched: 0,
        analyzed: 0,
        total: leadIds.length,
      },
      results: {
        totalFound: leadIds.length,
        enrichedCount: 0,
        analyzedCount: 0,
        avgRelevanceScore: 0,
      },
      startedAt: targetSearch.startedAt ?? now,
    };

    for (const field of DISCOVERY_METADATA_FIELDS) {
      const value = sourceSearch[field];
      if (value !== undefined) {
        discoveryPatch[field] = value;
      }
    }

    const patch = withUpdatedAtIfSupported(discoveryPatch, targetSearch, now);
    try {
      await ctx.db.patch(args.targetSearchId, patch);
    } catch (error) {
      if (!isUpdatedAtSchemaError(error)) {
        throw error;
      }
      const { updatedAt: _unused, ...patchWithoutTimestamp } = patch as typeof patch & {
        updatedAt?: number;
      };
      await ctx.db.patch(args.targetSearchId, patchWithoutTimestamp);
    }

    return {
      clonedCount: leadIds.length,
      leadIds,
      sourceSearchId: args.sourceSearchId,
    };
  },
});

export const applyFrozenDiscovery = internalAction({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const search = await ctx.runQuery(internal.search.internal.getSearchInternal, {
      searchId: args.searchId,
    });

    if (!search) {
      throw new Error(`Search ${args.searchId} not found`);
    }

    if (!search.skipDiscovery || !search.discoverySourceSearchId) {
      throw new Error("Search is not configured for frozen discovery replay");
    }

    const cloneResult = await ctx.runMutation(
      (internal as any).search.discoveryFreeze.cloneDiscoveryLeadsInternal,
      {
        targetSearchId: args.searchId,
        sourceSearchId: search.discoverySourceSearchId,
      },
    );

    if (cloneResult.clonedCount === 0) {
      await ctx.runMutation(internal.search.internal.updateSearchResults, {
        searchId: args.searchId,
        results: {
          totalFound: 0,
          enrichedCount: 0,
          analyzedCount: 0,
          avgRelevanceScore: 0,
        },
        progress: {
          discovered: 0,
          enriched: 0,
          analyzed: 0,
          total: 0,
        },
      });
      await ctx.runMutation(internal.search.internal.updateSearchStatusInternal, {
        searchId: args.searchId,
        status: "completed",
      });
      return {
        success: true,
        clonedCount: 0,
        message: "No leads cloned from frozen discovery source",
      };
    }

    await ctx.runMutation(internal.search.internal.updateSearchStatusInternal, {
      searchId: args.searchId,
      status: "in_progress",
    });

    await ctx.scheduler.runAfter(0, "leads/actions:enrichLeads" as any, {
      searchId: args.searchId,
    });

    return {
      success: true,
      clonedCount: cloneResult.clonedCount,
      leadIds: cloneResult.leadIds,
      sourceSearchId: cloneResult.sourceSearchId,
    };
  },
});
