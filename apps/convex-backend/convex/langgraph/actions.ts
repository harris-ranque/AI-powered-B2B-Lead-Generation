import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { v } from "convex/values";
import { requireAuth } from "../auth";
import { REQUIRED_ENTERPRISE_PROVIDERS } from "../userApiKeys/queries";

type ProviderKeyMap = Record<string, string>;

function normalizeProviderKeyMap(
  rawKeys: ProviderKeyMap,
  userId: string,
): ProviderKeyMap {
  const normalized: ProviderKeyMap = {};

  for (const [provider, key] of Object.entries(rawKeys)) {
    if (!key) {
      continue;
    }
    normalized[provider] = key;
  }

  if (
    normalized.google_maps &&
    !normalized.google_places
  ) {
    console.warn(
      `BYOK: User ${userId} has legacy google_maps key only; ask them to re-save as google_places.`,
    );
    normalized.google_places = normalized.google_maps;
  }

  delete normalized.google_maps;

  return normalized;
}

function serializeProviderKeysForWorker(
  keys: ProviderKeyMap,
): Record<string, string> | undefined {
  const entries = Object.entries(keys);
  if (entries.length === 0) {
    return undefined;
  }

  const serialized: Record<string, string> = {};
  for (const [provider, key] of entries) {
    if (!key) {
      continue;
    }
    if (provider === "google_places") {
      serialized.googlePlaces = key;
    } else {
      serialized[provider] = key;
    }
  }

  return Object.keys(serialized).length > 0 ? serialized : undefined;
}

// Generate personalized email using LangGraph
export const generateEmail: unknown = action({
  args: {
    leadId: v.id("leads"),
    emailType: v.optional(
      v.union(v.literal("initial"), v.literal("follow_up"), v.literal("final")),
    ),
    customInstructions: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Get lead data using scheduler
    const lead: {
      businessName: string;
      category?: string | null;
      website?: string | null;
      contactInfo?: {
        emails?: { email: string }[];
        socialProfiles?: { linkedin?: string };
      };
      searchId?: string;
    } | null = await ctx.runQuery(api.leads.queries.getLead, {
      leadId: args.leadId,
    });

    // Verify lead access (already checked in getLead query)
    if (!lead) {
      throw new Error("Lead not found or access denied");
    }

    // Get user's business profile for context
    const profile = await ctx.runQuery(
      api.profile.queries.getBusinessProfile,
      {},
    );

    if (!profile) {
      throw new Error("Business profile required for email generation");
    }

    const contactInfo = {
      name:
        (profile.contactInfo as { name?: string } | undefined)?.name ||
        user.name ||
        "",
      email: profile.contactInfo?.email || user.email || "",
      phone: profile.contactInfo?.phone || "",
      website: profile.contactInfo?.website || "",
      linkedin: profile.contactInfo?.linkedin || "",
    };

    // Create LangGraph-compatible request id: searchId_leadId_attempt
    const requestId: string = `${lead?.searchId ?? ""}_${args.leadId}_ui1`;

    const request = await ctx.runMutation(
      api.langgraph.mutations.createRequest,
      {
        leadId: args.leadId,
        requestId,
        type: "email_generation",
        inputData: {
          lead: {
            name: lead.businessName,
            company: lead.businessName, // Same as business name for now
            email: lead.contactInfo?.emails?.[0]?.email || "",
            title: "", // Not available in current schema
            industry: lead.category || "",
            websiteUrl: lead.website || "",
            linkedinUrl: lead.contactInfo?.socialProfiles?.linkedin || "",
            description: "", // Not available in current schema
          },
          businessProfile: {
            companyName: profile.companyName,
            industry: profile.industry,
            valueProposition: profile.valueProposition,
            services: profile.services,
            targetMarkets: profile.targetMarkets,
            keyDifferentiators: profile.keyDifferentiators,
            contactInfo,
          },
          emailType: args.emailType || "initial",
          customInstructions: args.customInstructions,
        },
      },
    );

    let enterpriseProviderKeys: ProviderKeyMap = {};
    if (user.plan === "enterprise") {
      const rawProviderKeys =
        (await ctx.runAction(
          internal.userApiKeys.actions.resolveUserProviderKeys,
          {
            userId: user._id,
            purpose: "langgraph_email_generation",
          },
        )) as ProviderKeyMap;

      enterpriseProviderKeys = normalizeProviderKeyMap(
        rawProviderKeys,
        user._id,
      );

      const missingProviders = REQUIRED_ENTERPRISE_PROVIDERS.filter(
        (provider) => {
          if (provider === "google_places") {
            return !enterpriseProviderKeys.google_places;
          }
          return !enterpriseProviderKeys[provider];
        },
      );

      if (missingProviders.length > 0) {
        const readable = missingProviders
          .map((provider) => provider.replace("_", " "))
          .join(", ");
        throw new Error(
          `Enterprise plans require your own API keys. Missing: ${readable}. Please configure them in Settings.`,
        );
      }
    }

    const serializedProviderKeys = serializeProviderKeysForWorker(
      enterpriseProviderKeys,
    );

    // Call LangGraph worker service
    try {
      const langgraphUrl = process.env.LANGGRAPH_URL;
      const apiKey = process.env.LANGGRAPH_API_KEY;

      if (!langgraphUrl || !apiKey) {
        throw new Error("LangGraph service configuration missing");
      }

      const response = await fetch(`${langgraphUrl}/generate-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-Request-ID": requestId,
        },
        body: JSON.stringify({
          requestId,
          // Worker expects snake_case model but accepts aliases; build a rich payload
          lead: {
            id: args.leadId,
            company: lead.businessName,
            title: "",
            industry: lead.category ?? "",
            websiteUrl: lead.website ?? "",
            contactInfo: {
              email: lead.contactInfo?.emails?.[0]?.email ?? "",
              linkedinUrl: lead.contactInfo?.socialProfiles?.linkedin ?? "",
              website: lead.website ?? "",
            },
          },
          businessProfile: {
            companyName: profile.companyName,
            industry: profile.industry,
            valueProposition: profile.valueProposition,
            services: profile.services,
            targetMarkets: profile.targetMarkets,
            keyDifferentiators: profile.keyDifferentiators,
            contactInfo,
          },
          // Map request options to requirements with sensible defaults
          requirements: {
            tone: "professional",
            length: "medium",
            callToAction: "Schedule a 15-minute demo call",
            includeCaseStudy: true,
            personalization_level: "high",
            followUpSequence: (args.emailType ?? "initial") !== "final",
          },
          providerKeys: serializedProviderKeys,
          userId: user._id,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `LangGraph service error: ${response.status} ${response.statusText}`,
        );
      }

      // Update request status to processing
      await ctx.runMutation(api.langgraph.mutations.updateRequestStatus, {
        requestId,
        status: "processing",
      });

      return {
        requestId,
        status: "processing",
        message: "Email generation started",
      };
    } catch (error) {
      console.error("LangGraph email generation error:", error);

      // Update request status to failed
      await ctx.runMutation(api.langgraph.mutations.updateRequestStatus, {
        requestId,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });

      throw new Error("Failed to start email generation");
    }
  },
});

// Analyze lead using LangGraph
export const analyzeLead = action({
  args: {
    leadId: v.id("leads"),
    analysisType: v.optional(
      v.union(
        v.literal("relevance"),
        v.literal("pain_points"),
        v.literal("value_match"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Get lead data using scheduler
    const lead = await ctx.runQuery(api.leads.queries.getLead, {
      leadId: args.leadId,
    });

    if (!lead) {
      throw new Error("Lead not found or access denied");
    }

    // Get user's business profile for context
    const profile = await ctx.runQuery(
      api.profile.queries.getBusinessProfile,
      {},
    );

    if (!profile) {
      throw new Error("Business profile required for lead analysis");
    }

    const contactInfo = {
      name:
        (profile.contactInfo as { name?: string } | undefined)?.name ||
        user.name ||
        "",
      email: profile.contactInfo?.email || user.email || "",
      phone: profile.contactInfo?.phone || "",
      website: profile.contactInfo?.website || "",
      linkedin: profile.contactInfo?.linkedin || "",
    };

    // Create LangGraph request using scheduler
    const requestId = `analysis_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const request = await ctx.runMutation(
      api.langgraph.mutations.createRequest,
      {
        leadId: args.leadId,
        requestId,
        type: "lead_analysis",
        inputData: {
          lead: {
            name: lead.businessName,
            company: lead.businessName, // Same as business name for now
            email: lead.contactInfo?.emails?.[0]?.email || "",
            title: "", // Not available in current schema
            industry: lead.category || "",
            websiteUrl: lead.website || "",
            linkedinUrl: lead.contactInfo?.socialProfiles?.linkedin || "",
            description: "", // Not available in current schema
          },
          businessProfile: {
            companyName: profile.companyName,
            industry: profile.industry,
            valueProposition: profile.valueProposition,
            services: profile.services,
            targetMarkets: profile.targetMarkets,
            keyDifferentiators: profile.keyDifferentiators,
            contactInfo,
          },
          analysisType: args.analysisType || "relevance",
        },
      },
    );

    let enterpriseProviderKeys: ProviderKeyMap = {};
    if (user.plan === "enterprise") {
      const rawProviderKeys =
        (await ctx.runAction(
          internal.userApiKeys.actions.resolveUserProviderKeys,
          {
            userId: user._id,
            purpose: "langgraph_lead_analysis",
          },
        )) as ProviderKeyMap;

      enterpriseProviderKeys = normalizeProviderKeyMap(
        rawProviderKeys,
        user._id,
      );

      if (!enterpriseProviderKeys.openai) {
        throw new Error(
          "Enterprise plans require your OpenAI API key before running lead analysis. Please configure it in Settings.",
        );
      }
    }

    const serializedProviderKeys = serializeProviderKeysForWorker(
      enterpriseProviderKeys,
    );

    // Call LangGraph worker service
    try {
      const langgraphUrl = process.env.LANGGRAPH_URL;
      const apiKey = process.env.LANGGRAPH_API_KEY;

      if (!langgraphUrl || !apiKey) {
        throw new Error("LangGraph service configuration missing");
      }

      const response = await fetch(`${langgraphUrl}/analyze-lead`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-Request-ID": requestId,
        },
        // Worker expects a lead payload; provider keys are optional for BYOK users
        body: JSON.stringify({
          lead: {
            id: args.leadId,
            company: lead.businessName,
            title: "",
            industry: lead.category ?? "",
            websiteUrl: lead.website ?? "",
            contactInfo: {
              email: lead.contactInfo?.emails?.[0]?.email ?? "",
              linkedinUrl: lead.contactInfo?.socialProfiles?.linkedin ?? "",
              website: lead.website ?? "",
            },
          },
          providerKeys: serializedProviderKeys,
          userId: user._id,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `LangGraph service error: ${response.status} ${response.statusText}`,
        );
      }

      // Update request status to processing
      await ctx.runMutation(api.langgraph.mutations.updateRequestStatus, {
        requestId,
        status: "processing",
      });

      return {
        requestId,
        status: "processing",
        message: "Lead analysis started",
      };
    } catch (error) {
      console.error("LangGraph lead analysis error:", error);

      // Update request status to failed
      await ctx.runMutation(api.langgraph.mutations.updateRequestStatus, {
        requestId,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });

      throw new Error("Failed to start lead analysis");
    }
  },
});
