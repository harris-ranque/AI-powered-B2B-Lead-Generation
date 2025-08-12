import { action } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../auth";
import { API_CONFIG, ERROR_CODES, CREDIT_COSTS } from "../lib/constants";
import { createError, generateRequestId, hasCredits } from "../lib/helpers";
import { emailRequirementsValidator } from "../lib/validators";
import { internal } from "../_generated/api";

// Types for CrewAI API responses
interface CrewAIResponse {
  status: "processing" | "completed" | "failed";
  result?: any;
  error?: string;
  request_id?: string;
  analysis?: {
    relevance_score?: number;
    pain_points?: string[];
    value_matches?: string[];
    fit_assessment?: string;
    recommended_approach?: string;
    confidence?: number;
  };
  // Health check properties
  services?: Record<string, any>;
  timestamp?: string;
  version?: string;
  // Information endpoint properties
  agents?: any[];
  workflow?: any;
  capabilities?: string[];
}

// Generate personalized email for a lead
export const generateEmail = action({
  args: {
    leadId: v.id("leads"),
    requirements: emailRequirementsValidator,
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    if (!hasCredits(user, CREDIT_COSTS.EMAIL_GENERATION)) {
      throw createError(
        `Insufficient credits. Email generation requires ${CREDIT_COSTS.EMAIL_GENERATION} credits.`,
        ERROR_CODES.INSUFFICIENT_CREDITS,
        400
      );
    }

    // Get lead and verify ownership
    const lead = await ctx.runQuery(internal.leads.internal.getLeadForProcessing, {
      leadId: args.leadId,
    });

    if (!lead || lead.userId !== user._id) {
      throw createError("Lead not found or access denied", ERROR_CODES.FORBIDDEN, 403);
    }

    // Get business profile for personalization
    const profile = await ctx.runQuery(internal.profile.queries.getProfileByUserId, {
      userId: user._id,
    });
    if (!profile || !profile.isComplete) {
      throw createError(
        "Complete business profile required for email generation",
        ERROR_CODES.VALIDATION_ERROR,
        400
      );
    }

    const requestId = generateRequestId();
    const crewaiUrl = process.env.CREWAI_URL;
    const apiKey = process.env.CREWAI_API_KEY;

    if (!crewaiUrl || !apiKey) {
      throw createError("CrewAI service not configured", ERROR_CODES.INTERNAL_ERROR, 500);
    }

    try {
      // Create CrewAI request record
      await ctx.runMutation(internal.crewai.internal.createRequest, {
        userId: user._id,
        leadId: args.leadId,
        requestId,
        type: "email_generation",
        inputData: {
          lead,
          businessProfile: profile,
          requirements: args.requirements,
        },
        creditsUsed: CREDIT_COSTS.EMAIL_GENERATION,
      });

      // Prepare payload for CrewAI worker
      const payload = {
        request_id: requestId,
        lead: {
          id: lead._id,
          company_name: lead.businessName,
          contact_name: lead.contactInfo?.contacts?.[0]?.name,
          title: lead.contactInfo?.contacts?.[0]?.title,
          industry: lead.category,
          location: lead.location.formattedAddress,
          description: `${lead.businessName} - ${lead.category || 'Business'}`,
          website: lead.website,
          contact_info: {
            email: lead.contactInfo?.emails?.[0]?.email,
            phone: lead.phone,
            linkedin: lead.contactInfo?.socialProfiles?.linkedin,
          },
          pain_points: lead.aiAnalysis?.painPoints || [],
          technologies: [],
          revenue: null,
          company_size: null,
          source: "google_maps",
        },
        business_profile: {
          company_name: profile.companyName,
          industry: profile.industry,
          value_proposition: profile.valueProposition,
          services: profile.services,
          target_markets: profile.targetMarkets,
          key_differentiators: profile.keyDifferentiators,
          case_studies: profile.caseStudies || [],
          contact_info: profile.contactInfo,
        },
        requirements: {
          tone: args.requirements.tone,
          length: args.requirements.length,
          call_to_action: args.requirements.callToAction,
          include_case_study: args.requirements.includeCaseStudy,
          personalization_level: args.requirements.personalizationLevel,
          follow_up_sequence: args.requirements.followUpSequence,
        },
      };

      // Send request to CrewAI worker
      const response = await fetch(`${crewaiUrl}/generate-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(API_CONFIG.CREWAI_WORKER.TIMEOUT),
      });

      if (!response.ok) {
        throw new Error(`CrewAI API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as CrewAIResponse;

      // Update request status
      await ctx.runMutation(internal.crewai.internal.updateRequestStatus, {
        requestId,
        status: result.status === "processing" ? "processing" : "completed",
        outputData: result.status === "completed" ? result.result : undefined,
        error: result.error || undefined,
      });

      // Deduct credits immediately for processing request
      await ctx.runMutation(internal.users.mutations.deductCredits, {
        amount: CREDIT_COSTS.EMAIL_GENERATION,
        description: `Email generation for ${lead.businessName}`,
        relatedEntity: {
          type: "crewai_request",
          id: requestId,
        },
      });

      return {
        success: true,
        requestId,
        status: result.status,
        message: result.status === "processing" 
          ? "Email generation started. You'll be notified when complete."
          : "Email generated successfully!",
        result: result.status === "completed" ? result.result : undefined,
      };

    } catch (error) {
      console.error("CrewAI email generation error:", error);
      
      // Update request as failed
      await ctx.runMutation(internal.crewai.internal.updateRequestStatus, {
        requestId,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });

      throw createError(
        "Failed to generate email. Please try again.",
        ERROR_CODES.CREWAI_ERROR,
        500
      );
    }
  },
});

// Analyze lead relevance and fit
export const analyzeLead = action({
  args: {
    leadId: v.id("leads"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    if (!hasCredits(user, CREDIT_COSTS.AI_ANALYSIS)) {
      throw createError(
        `Insufficient credits. Lead analysis requires ${CREDIT_COSTS.AI_ANALYSIS} credits.`,
        ERROR_CODES.INSUFFICIENT_CREDITS,
        400
      );
    }

    // Get lead and verify ownership
    const lead = await ctx.runQuery(internal.leads.internal.getLeadForProcessing, {
      leadId: args.leadId,
    });

    if (!lead || lead.userId !== user._id) {
      throw createError("Lead not found or access denied", ERROR_CODES.FORBIDDEN, 403);
    }

    // Get business profile
    const profile = await ctx.runQuery(internal.profile.queries.getProfileByUserId, {
      userId: user._id,
    });
    if (!profile) {
      throw createError("Business profile required for analysis", ERROR_CODES.VALIDATION_ERROR, 400);
    }

    const requestId = generateRequestId();
    const crewaiUrl = process.env.CREWAI_URL;
    const apiKey = process.env.CREWAI_API_KEY;

    if (!crewaiUrl || !apiKey) {
      throw createError("CrewAI service not configured", ERROR_CODES.INTERNAL_ERROR, 500);
    }

    try {
      // Create CrewAI request record
      await ctx.runMutation(internal.crewai.internal.createRequest, {
        userId: user._id,
        leadId: args.leadId,
        requestId,
        type: "lead_analysis",
        inputData: {
          lead,
          businessProfile: profile,
        },
        creditsUsed: CREDIT_COSTS.AI_ANALYSIS,
      });

      // Prepare payload for CrewAI worker
      const payload = {
        request_id: requestId,
        lead: {
          id: lead._id,
          company_name: lead.businessName,
          industry: lead.category,
          location: lead.location.formattedAddress,
          description: `${lead.businessName} - ${lead.category || 'Business'}`,
          website: lead.website,
          rating: lead.rating,
          review_count: lead.reviewCount,
        },
        business_profile: {
          company_name: profile.companyName,
          industry: profile.industry,
          value_proposition: profile.valueProposition,
          services: profile.services,
          target_markets: profile.targetMarkets,
          key_differentiators: profile.keyDifferentiators,
        },
      };

      // Send request to CrewAI worker
      const response = await fetch(`${crewaiUrl}/analyze-lead`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(API_CONFIG.CREWAI_WORKER.TIMEOUT),
      });

      if (!response.ok) {
        throw new Error(`CrewAI API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as CrewAIResponse;

      // Update request status
      await ctx.runMutation(internal.crewai.internal.updateRequestStatus, {
        requestId,
        status: "completed",
        outputData: result,
      });

      // Store analysis results in lead
      if (result.analysis) {
        await ctx.runMutation(internal.leads.internal.updateLeadAnalysis, {
          leadId: args.leadId,
          aiAnalysis: {
            relevanceScore: result.analysis.relevance_score || 0,
            painPoints: result.analysis.pain_points || [],
            valueMatches: result.analysis.value_matches || [],
            fitAssessment: result.analysis.fit_assessment || "",
            recommendedApproach: result.analysis.recommended_approach || "",
            confidence: result.analysis.confidence || 0,
          },
        });
      }

      // Deduct credits
      await ctx.runMutation(internal.users.mutations.deductCredits, {
        amount: CREDIT_COSTS.AI_ANALYSIS,
        description: `Lead analysis for ${lead.businessName}`,
        relatedEntity: {
          type: "crewai_request",
          id: requestId,
        },
      });

      return {
        success: true,
        requestId,
        analysis: result.analysis,
        message: "Lead analysis completed successfully!",
      };

    } catch (error) {
      console.error("CrewAI lead analysis error:", error);
      
      // Update request as failed
      await ctx.runMutation(internal.crewai.internal.updateRequestStatus, {
        requestId,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });

      throw createError(
        "Failed to analyze lead. Please try again.",
        ERROR_CODES.CREWAI_ERROR,
        500
      );
    }
  },
});

// Get CrewAI service status
export const getServiceStatus = action({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const crewaiUrl = process.env.CREWAI_URL;
    const apiKey = process.env.CREWAI_API_KEY;

    if (!crewaiUrl || !apiKey) {
      return {
        status: "unavailable",
        error: "CrewAI service not configured",
      };
    }

    try {
      const response = await fetch(`${crewaiUrl}/health`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(5000), // 5 second timeout for health check
      });

      if (!response.ok) {
        return {
          status: "error",
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const result = await response.json() as CrewAIResponse;

      return {
        status: "healthy",
        services: result.services || {},
        timestamp: result.timestamp,
        version: result.version,
      };

    } catch (error) {
      return {
        status: "unreachable",
        error: error instanceof Error ? error.message : "Connection failed",
      };
    }
  },
});

// Get information about available AI agents
export const getAgentsInfo = action({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const crewaiUrl = process.env.CREWAI_URL;
    const apiKey = process.env.CREWAI_API_KEY;

    if (!crewaiUrl || !apiKey) {
      throw createError("CrewAI service not configured", ERROR_CODES.INTERNAL_ERROR, 500);
    }

    try {
      const response = await fetch(`${crewaiUrl}/agents/info`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json() as CrewAIResponse;

      return {
        agents: result.agents || [],
        workflow: result.workflow || "",
        capabilities: result.capabilities || {},
      };

    } catch (error) {
      console.error("Get agents info error:", error);
      throw createError(
        "Failed to get agents information",
        ERROR_CODES.CREWAI_ERROR,
        500
      );
    }
  },
});