import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";

// Create a new lead
export const createLead = mutation({
  args: {
    searchId: v.id("searches"),
    leadData: v.object({
      businessName: v.string(),
      address: v.string(),
      placeId: v.string(),
      location: v.object({
        lat: v.number(),
        lng: v.number(),
        formattedAddress: v.string(),
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        country: v.optional(v.string()),
        postalCode: v.optional(v.string()),
      }),
      phone: v.optional(v.string()),
      website: v.optional(v.string()),
      rating: v.optional(v.number()),
      reviewCount: v.optional(v.number()),
      category: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Verify search belongs to user
    const search = await ctx.db.get(args.searchId);
    if (!search || search.userId !== user._id) {
      throw new Error("Search not found or access denied");
    }

    // Check for duplicate placeId within this search
    const existingLead = await ctx.db
      .query("leads")
      .withIndex("by_place_id", (q) => q.eq("placeId", args.leadData.placeId))
      .filter((q) => q.eq(q.field("searchId"), args.searchId))
      .first();

    if (existingLead) {
      throw new Error(
        `Lead with this location already exists in this search. Cannot create duplicate.`
      );
    }

    const leadId = await ctx.db.insert("leads", {
      userId: user._id,
      searchId: args.searchId,
      businessName: args.leadData.businessName,
      address: args.leadData.address,
      placeId: args.leadData.placeId,
      location: args.leadData.location,
      phone: args.leadData.phone,
      website: args.leadData.website,
      rating: args.leadData.rating,
      reviewCount: args.leadData.reviewCount,
      category: args.leadData.category,
      enrichmentStatus: "pending", // Set to valid enum value
      status: "new", // Set to valid status enum
      tags: [], // Initialize empty tags array
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return leadId;
  },
});

// Update lead information
export const updateLead = mutation({
  args: {
    leadId: v.id("leads"),
    updates: v.object({
      status: v.optional(
        v.union(
          v.literal("new"),
          v.literal("qualified"),
          v.literal("contacted"),
          v.literal("nurturing"),
          v.literal("converted"),
          v.literal("unqualified"),
        ),
      ),
      tags: v.optional(v.array(v.string())),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Verify user owns the lead
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.userId !== user._id) {
      throw new Error("Lead not found or access denied");
    }

    await ctx.db.patch(args.leadId, {
      ...args.updates,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Update lead status specifically
export const updateLeadStatus = mutation({
  args: {
    leadId: v.id("leads"),
    status: v.union(
      v.literal("new"),
      v.literal("qualified"),
      v.literal("contacted"),
      v.literal("nurturing"),
      v.literal("converted"),
      v.literal("unqualified"),
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Verify user owns the lead
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.userId !== user._id) {
      throw new Error("Lead not found or access denied");
    }

    await ctx.db.patch(args.leadId, {
      status: args.status,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Add notes to a lead
export const addLeadNotes = mutation({
  args: {
    leadId: v.id("leads"),
    notes: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Verify user owns the lead
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.userId !== user._id) {
      throw new Error("Lead not found or access denied");
    }

    const currentNotes = lead.notes || "";
    const timestamp = new Date().toISOString();
    const newNote = `[${timestamp}] ${args.notes}`;
    const updatedNotes = currentNotes
      ? `${currentNotes}\n\n${newNote}`
      : newNote;

    await ctx.db.patch(args.leadId, {
      notes: updatedNotes,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Delete a lead
export const deleteLead = mutation({
  args: {
    leadId: v.id("leads"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Verify user owns the lead
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.userId !== user._id) {
      throw new Error("Lead not found or access denied");
    }

    await ctx.db.delete(args.leadId);

    return { success: true };
  },
});
