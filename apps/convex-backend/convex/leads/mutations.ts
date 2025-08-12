import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../auth";
import { ERROR_CODES, STATUS } from "../lib/constants";
import { createError } from "../lib/helpers";

// Update lead status
export const updateLeadStatus = mutation({
  args: {
    leadId: v.id("leads"),
    status: v.union(
      v.literal("new"),
      v.literal("qualified"),
      v.literal("contacted"),
      v.literal("nurturing"),
      v.literal("converted"),
      v.literal("unqualified")
    ),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const lead = await ctx.db.get(args.leadId);
    
    if (!lead || lead.userId !== user._id) {
      throw createError("Lead not found or access denied", ERROR_CODES.FORBIDDEN, 403);
    }

    const updateData: any = {
      status: args.status,
      updatedAt: Date.now(),
    };

    if (args.notes) {
      updateData.notes = args.notes;
    }

    await ctx.db.patch(args.leadId, updateData);

    // Send notification for important status changes
    if (args.status === "converted") {
      await ctx.db.insert("notifications", {
        userId: user._id,
        type: "system_alert",
        title: "Lead Converted! 🎉",
        message: `${lead.businessName} has been marked as converted. Congratulations on closing the deal!`,
        data: { 
          leadId: args.leadId,
          businessName: lead.businessName,
          status: args.status,
        },
        read: false,
        sent: false,
        createdAt: Date.now(),
      });
    }

    return { success: true };
  },
});

// Add tags to a lead
export const addLeadTags = mutation({
  args: {
    leadId: v.id("leads"),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const lead = await ctx.db.get(args.leadId);
    
    if (!lead || lead.userId !== user._id) {
      throw createError("Lead not found or access denied", ERROR_CODES.FORBIDDEN, 403);
    }

    // Merge new tags with existing ones (remove duplicates)
    const currentTags = lead.tags || [];
    const newTags = [...new Set([...currentTags, ...args.tags])];

    await ctx.db.patch(args.leadId, {
      tags: newTags,
      updatedAt: Date.now(),
    });

    return { success: true, tags: newTags };
  },
});

// Remove tags from a lead
export const removeLeadTags = mutation({
  args: {
    leadId: v.id("leads"),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const lead = await ctx.db.get(args.leadId);
    
    if (!lead || lead.userId !== user._id) {
      throw createError("Lead not found or access denied", ERROR_CODES.FORBIDDEN, 403);
    }

    // Remove specified tags
    const currentTags = lead.tags || [];
    const newTags = currentTags.filter(tag => !args.tags.includes(tag));

    await ctx.db.patch(args.leadId, {
      tags: newTags,
      updatedAt: Date.now(),
    });

    return { success: true, tags: newTags };
  },
});

// Add or update notes for a lead
export const updateLeadNotes = mutation({
  args: {
    leadId: v.id("leads"),
    notes: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const lead = await ctx.db.get(args.leadId);
    
    if (!lead || lead.userId !== user._id) {
      throw createError("Lead not found or access denied", ERROR_CODES.FORBIDDEN, 403);
    }

    await ctx.db.patch(args.leadId, {
      notes: args.notes.trim(),
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Bulk update lead statuses
export const bulkUpdateLeadStatus = mutation({
  args: {
    leadIds: v.array(v.id("leads")),
    status: v.union(
      v.literal("new"),
      v.literal("qualified"),
      v.literal("contacted"),
      v.literal("nurturing"),
      v.literal("converted"),
      v.literal("unqualified")
    ),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    if (args.leadIds.length === 0) {
      throw createError("No leads specified", ERROR_CODES.VALIDATION_ERROR, 400);
    }

    if (args.leadIds.length > 100) {
      throw createError("Cannot update more than 100 leads at once", ERROR_CODES.VALIDATION_ERROR, 400);
    }

    let updatedCount = 0;
    const errors: string[] = [];

    for (const leadId of args.leadIds) {
      try {
        const lead = await ctx.db.get(leadId);
        
        if (!lead || lead.userId !== user._id) {
          errors.push(`Lead ${leadId}: not found or access denied`);
          continue;
        }

        await ctx.db.patch(leadId, {
          status: args.status,
          updatedAt: Date.now(),
        });

        updatedCount++;
      } catch (error) {
        errors.push(`Lead ${leadId}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

    // Send notification for bulk operations
    if (updatedCount > 0) {
      await ctx.db.insert("notifications", {
        userId: user._id,
        type: "system_alert",
        title: "Bulk Update Complete",
        message: `${updatedCount} leads have been updated to "${args.status}" status.`,
        data: { 
          updatedCount,
          status: args.status,
          errors: errors.length > 0 ? errors : undefined,
        },
        read: false,
        sent: false,
        createdAt: Date.now(),
      });
    }

    return { 
      success: true,
      updatedCount,
      errors: errors.length > 0 ? errors : undefined,
    };
  },
});

// Delete a lead
export const deleteLead = mutation({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const lead = await ctx.db.get(args.leadId);
    
    if (!lead || lead.userId !== user._id) {
      throw createError("Lead not found or access denied", ERROR_CODES.FORBIDDEN, 403);
    }

    // Delete associated email sequences
    if (lead.generatedEmails) {
      for (const emailId of lead.generatedEmails) {
        const email = await ctx.db.get(emailId);
        if (email) {
          await ctx.db.delete(emailId);
        }
      }
    }

    // Delete the lead
    await ctx.db.delete(args.leadId);

    return { success: true };
  },
});

// Retry enrichment for a failed lead
export const retryEnrichment = mutation({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const lead = await ctx.db.get(args.leadId);
    
    if (!lead || lead.userId !== user._id) {
      throw createError("Lead not found or access denied", ERROR_CODES.FORBIDDEN, 403);
    }

    if (lead.enrichmentStatus !== "failed") {
      throw createError("Lead enrichment has not failed", ERROR_CODES.VALIDATION_ERROR, 400);
    }

    // Reset enrichment status to pending
    await ctx.db.patch(args.leadId, {
      enrichmentStatus: STATUS.ENRICHMENT.PENDING,
      contactInfo: undefined, // Clear any partial data
      updatedAt: Date.now(),
    });

    // Send notification
    await ctx.db.insert("notifications", {
      userId,
      type: "system_alert",
      title: "Enrichment Retry Queued",
      message: `Enrichment for ${lead.businessName} has been queued for retry.`,
      data: { 
        leadId: args.leadId,
        businessName: lead.businessName,
      },
      read: false,
      sent: false,
      createdAt: Date.now(),
    });

    return { success: true };
  },
});

// Mark email sequence as sent
export const markEmailAsSent = mutation({
  args: {
    emailSequenceId: v.id("emailSequences"),
    sentAt: v.optional(v.number()),
    recipient: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const emailSequence = await ctx.db.get(args.emailSequenceId);
    
    if (!emailSequence || emailSequence.userId !== user._id) {
      throw createError("Email sequence not found or access denied", ERROR_CODES.FORBIDDEN, 403);
    }

    await ctx.db.patch(args.emailSequenceId, {
      status: "sent",
      updatedAt: Date.now(),
    });

    // Update lead status to contacted if it's still new or qualified
    const lead = await ctx.db.get(emailSequence.leadId);
    if (lead && (lead.status === "new" || lead.status === "qualified")) {
      await ctx.db.patch(emailSequence.leadId, {
        status: "contacted",
        updatedAt: Date.now(),
      });
    }

    // Send notification
    await ctx.db.insert("notifications", {
      userId,
      type: "email_sent",
      title: "Email Sent Successfully! 📧",
      message: `Your personalized email has been sent${args.recipient ? ` to ${args.recipient}` : ""}.`,
      data: { 
        emailSequenceId: args.emailSequenceId,
        leadId: emailSequence.leadId,
        recipient: args.recipient,
        sentAt: args.sentAt || Date.now(),
      },
      read: false,
      sent: false,
      createdAt: Date.now(),
    });

    return { success: true };
  },
});

// Update email sequence
export const updateEmailSequence = mutation({
  args: {
    emailSequenceId: v.id("emailSequences"),
    subject: v.optional(v.string()),
    body: v.optional(v.string()),
    tone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const emailSequence = await ctx.db.get(args.emailSequenceId);
    
    if (!emailSequence || emailSequence.userId !== user._id) {
      throw createError("Email sequence not found or access denied", ERROR_CODES.FORBIDDEN, 403);
    }

    const updateData: any = {
      updatedAt: Date.now(),
    };

    if (args.subject !== undefined) {
      updateData.subject = args.subject;
    }

    if (args.body !== undefined) {
      updateData.body = args.body;
    }

    if (args.tone !== undefined) {
      updateData.tone = args.tone;
    }

    await ctx.db.patch(args.emailSequenceId, updateData);

    return { success: true };
  },
});

// Bulk delete leads
export const bulkDeleteLeads = mutation({
  args: { leadIds: v.array(v.id("leads")) },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    if (args.leadIds.length === 0) {
      throw createError("No leads specified", ERROR_CODES.VALIDATION_ERROR, 400);
    }

    if (args.leadIds.length > 50) {
      throw createError("Cannot delete more than 50 leads at once", ERROR_CODES.VALIDATION_ERROR, 400);
    }

    let deletedCount = 0;
    const errors: string[] = [];

    for (const leadId of args.leadIds) {
      try {
        const lead = await ctx.db.get(leadId);
        
        if (!lead || lead.userId !== user._id) {
          errors.push(`Lead ${leadId}: not found or access denied`);
          continue;
        }

        // Delete associated email sequences
        if (lead.generatedEmails) {
          for (const emailId of lead.generatedEmails) {
            const email = await ctx.db.get(emailId);
            if (email) {
              await ctx.db.delete(emailId);
            }
          }
        }

        // Delete the lead
        await ctx.db.delete(leadId);
        deletedCount++;

      } catch (error) {
        errors.push(`Lead ${leadId}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

    // Send notification
    if (deletedCount > 0) {
      await ctx.db.insert("notifications", {
        userId: user._id,
        type: "system_alert",
        title: "Bulk Delete Complete",
        message: `${deletedCount} leads have been deleted.`,
        data: { 
          deletedCount,
          errors: errors.length > 0 ? errors : undefined,
        },
        read: false,
        sent: false,
        createdAt: Date.now(),
      });
    }

    return { 
      success: true,
      deletedCount,
      errors: errors.length > 0 ? errors : undefined,
    };
  },
});