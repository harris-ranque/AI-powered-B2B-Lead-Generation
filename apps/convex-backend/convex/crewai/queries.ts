import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";

// Get email generation statistics
export const getEmailGenerationStats = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const now = Date.now();
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);

    try {
      // Get LangGraph requests for email generation
      const allRequests = await ctx.db
        .query("langgraphRequests")
        .filter((q) => q.eq(q.field("userId"), user._id))
        .collect();

      const emailRequests = allRequests.filter(req => 
        req.type === "email_generation"
      );

      const successfulEmails = emailRequests.filter(req => req.status === "completed");
      const failedEmails = emailRequests.filter(req => req.status === "failed");
      
      const recentEmails = emailRequests.filter(req => req.createdAt > sevenDaysAgo);
      const monthlyEmails = emailRequests.filter(req => req.createdAt > thirtyDaysAgo);

      // Calculate success rate
      const successRate = emailRequests.length > 0 
        ? Math.round((successfulEmails.length / emailRequests.length) * 100) 
        : 0;

      // Calculate average generation time based on timestamps
      const completedWithTiming = successfulEmails.filter(req => req.startedAt && req.completedAt);
      const avgGenerationTime = completedWithTiming.length > 0
        ? Math.round(completedWithTiming.reduce((sum, req) => sum + ((req.completedAt || 0) - (req.startedAt || 0)), 0) / completedWithTiming.length)
        : 0;

      // Get email types distribution based on request type
      const emailTypes = emailRequests.reduce((acc, req) => {
        const emailType = req.type || 'email_generation';
        acc[emailType] = (acc[emailType] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return {
        totalEmails: emailRequests.length,
        successfulEmails: successfulEmails.length,
        failedEmails: failedEmails.length,
        successRate,
        avgGenerationTime,
        recentEmails: recentEmails.length,
        monthlyEmails: monthlyEmails.length,
        emailTypes,
        lastGenerated: emailRequests.length > 0 
          ? Math.max(...emailRequests.map(req => req.createdAt))
          : null,
      };
    } catch (error) {
      // If tables don't exist or other issues, return default stats
      return {
        totalEmails: 0,
        successfulEmails: 0,
        failedEmails: 0,
        successRate: 0,
        avgGenerationTime: 0,
        recentEmails: 0,
        monthlyEmails: 0,
        emailTypes: {},
        lastGenerated: null,
      };
    }
  },
});

// Get AI agent performance stats
export const getAgentPerformanceStats = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    try {
      // Get all LangGraph requests for this user
      const requests = await ctx.db
        .query("langgraphRequests")
        .filter((q) => q.eq(q.field("userId"), user._id))
        .collect();

      // Group by agent type or operation type
      const agentStats = requests.reduce((acc, req) => {
        const agentType = req.type || 'unknown';
        
        if (!acc[agentType]) {
          acc[agentType] = {
            totalRequests: 0,
            successful: 0,
            failed: 0,
            avgDuration: 0,
            totalDuration: 0,
          };
        }
        
        acc[agentType].totalRequests++;
        
        if (req.status === 'completed') {
          acc[agentType].successful++;
        } else if (req.status === 'failed') {
          acc[agentType].failed++;
        }
        
        if (req.startedAt && req.completedAt) {
          acc[agentType].totalDuration += (req.completedAt - req.startedAt);
        }
        
        return acc;
      }, {} as Record<string, any>);

      // Calculate averages
      Object.keys(agentStats).forEach(agentType => {
        const stats = agentStats[agentType];
        stats.avgDuration = stats.successful > 0 
          ? Math.round(stats.totalDuration / stats.successful)
          : 0;
        stats.successRate = stats.totalRequests > 0
          ? Math.round((stats.successful / stats.totalRequests) * 100)
          : 0;
        delete stats.totalDuration; // Remove internal calculation field
      });

      return {
        agents: agentStats,
        totalRequests: requests.length,
        overallSuccessRate: requests.length > 0
          ? Math.round((requests.filter(r => r.status === 'completed').length / requests.length) * 100)
          : 0,
      };
    } catch (error) {
      return {
        agents: {},
        totalRequests: 0,
        overallSuccessRate: 0,
      };
    }
  },
});

// Get recent AI processing activity
export const getRecentAIActivity = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const limit = args.limit || 10;

    try {
      const recentRequests = await ctx.db
        .query("langgraphRequests")
        .filter((q) => q.eq(q.field("userId"), user._id))
        .order("desc")
        .take(limit);

      return recentRequests.map(req => ({
        id: req._id,
        type: req.type,
        status: req.status,
        createdAt: req.createdAt,
        duration: req.startedAt && req.completedAt ? req.completedAt - req.startedAt : null,
        error: req.error,
        inputData: req.inputData,
        outputData: req.outputData,
      }));
    } catch (error) {
      return [];
    }
  },
});