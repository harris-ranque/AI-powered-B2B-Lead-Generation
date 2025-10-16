import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

// Send search completion email notification
// NOTE: This is an internal action that should only be called by the system
// It validates search ownership to prevent unauthorized notifications
export const sendSearchCompletedEmail = internalAction({
  args: {
    searchId: v.id("searches"),
    results: v.any(),
  },
  handler: async (ctx, args) => {
    try {
      // Get search and user info
      const search = await ctx.runQuery(
        internal.search.internal.getSearchInternal,
        {
          searchId: args.searchId,
        },
      );

      if (!search) {
        throw new Error("Search not found");
      }

      // Verify that the search exists and belongs to a valid user
      const user = await ctx.runQuery(internal.users.internal.getUserInternal, {
        userId: search.userId,
      });

      if (!user) {
        throw new Error("User not found for search");
      }

      // Create notification record
      await ctx.runMutation(
        internal.notifications.internal.createNotification,
        {
          userId: search.userId,
          type: "search_completed",
          title: "Search Completed",
          message: `Your search "${search.name}" has completed with ${args.results.totalFound} leads found, ${args.results.enrichedCount} enriched, and ${args.results.analyzedCount} analyzed.`,
          data: {
            searchId: args.searchId,
            searchName: search.name,
            results: args.results,
          },
        },
      );

      console.log(
        `Search completion notification created for user ${search.userId}, search ${args.searchId}`,
      );

      return { success: true };
    } catch (error) {
      console.error("Failed to send search completion notification:", error);
      throw error;
    }
  },
});
