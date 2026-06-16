import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import {
  createCorrelationContext,
  logWithCorrelation,
  startPerformanceTracking,
  endPerformanceTracking,
  OPERATION_TYPES,
} from "../lib/correlation";
import {
  buildLangGraphUrl,
  langGraphRequestHeaders,
  normalizeLangGraphBaseUrl,
} from "../lib/langgraphClient";
import { extractDomainFromWebsite } from "../lib/contactVerification";
import { enrichmentPool, generateBatchId } from "./workpool";

type DiscoverPeopleApiPerson = {
  name: string;
  title: string;
  matchedRole?: string;
  confidence?: number;
  source?: string;
  sourceUrl?: string;
  linkedinUrl?: string;
};

/**
 * Orchestrate people discovery for native and linked re-enrichment leads (Phase 2A).
 */
export const discoverPeopleForSearch = internalAction({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const correlation = createCorrelationContext(
      OPERATION_TYPES.LEAD_ENRICHMENT,
      "system",
      {
        searchId: args.searchId,
        metadata: { stage: "people_discovery" },
      },
    );
    const perf = startPerformanceTracking();

    const search = await ctx.runQuery(
      internal.search.internal.getSearchInternal,
      { searchId: args.searchId },
    );
    if (!search) {
      throw new Error("Search not found");
    }

    correlation.userId = search.userId;

    const leads = await ctx.runQuery(
      internal.leads.peopleDiscoveryInternal.getLeadsForPeopleDiscovery,
      { searchId: args.searchId },
    );

    if (leads.length === 0) {
      await ctx.scheduler.runAfter(0, "leads/actions:enrichLeads" as any, {
        searchId: args.searchId,
      });
      return { success: true, message: "No leads for people discovery" };
    }

    const batchId = `people_${generateBatchId(args.searchId)}`;

    logWithCorrelation(
      "info",
      correlation,
      "Starting people discovery batch",
      { totalLeads: leads.length, batchId },
    );

    await ctx.runMutation(internal.realtime.broadcaster.broadcastPipelineUpdate, {
      userId: search.userId,
      searchId: args.searchId,
      stage: "people_discovery",
      progress: 0,
      message: `Discovering decision makers for ${leads.length} businesses...`,
      data: {
        peopleDiscovery: {
          totalLeads: leads.length,
          batchId,
        },
      },
    });

    const workIds: string[] = [];
    for (const lead of leads) {
      const workId = await enrichmentPool.enqueueAction(
        ctx,
        internal.leads.asyncPeopleDiscovery.discoverPeopleForLead,
        {
          leadId: lead._id,
          searchId: args.searchId,
          userId: search.userId,
        },
        {
          context: {
            searchId: args.searchId,
            userId: search.userId,
            leadId: lead._id,
            batchId,
          },
          onComplete: internal.leads.workpool.onPeopleDiscoveryComplete,
        },
      );
      workIds.push(String(workId));
    }

    await ctx.runMutation(internal.leads.workpool.initEnrichmentBatch, {
      batchId,
      searchId: args.searchId,
      userId: search.userId,
      totalLeads: leads.length,
      workIds,
    });

    const perfData = endPerformanceTracking(perf);
    logWithCorrelation(
      "info",
      correlation,
      "People discovery batch enqueued",
      {
        batchId,
        enqueued: workIds.length,
        durationMs: perfData?.duration ?? 0,
      },
    );

    return { success: true, batchId, enqueued: workIds.length };
  },
});

/**
 * Discover people for a single lead via LangGraph /discover-people.
 */
export const discoverPeopleForLead = internalAction({
  args: {
    leadId: v.id("leads"),
    searchId: v.id("searches"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const lead = await ctx.runQuery(internal.leads.internal.getLeadInternal, {
      leadId: args.leadId,
    });
    if (!lead) {
      return { success: false, reason: "lead_not_found", prospectCount: 0 };
    }

    const search = await ctx.runQuery(
      internal.search.internal.getSearchInternal,
      { searchId: args.searchId },
    );
    if (!search) {
      return { success: false, reason: "search_not_found", prospectCount: 0 };
    }

    const domain = extractDomainFromWebsite(lead.website);
    if (!domain) {
      return { success: false, reason: "no_domain", prospectCount: 0 };
    }

    const langgraphUrl = normalizeLangGraphBaseUrl(process.env.LANGGRAPH_URL ?? "");
    const langgraphApiKey = process.env.LANGGRAPH_API_KEY;
    if (!langgraphUrl || !langgraphApiKey) {
      throw new Error("LangGraph service not configured");
    }

    const requestedRoles = Array.isArray(search.parameters?.roles)
      ? search.parameters.roles.filter(
          (role: unknown): role is string =>
            typeof role === "string" && role.trim().length > 0,
        )
      : ["CEO", "Founder", "Owner"];

    const expandedRolePatterns = Array.isArray(
      search.parameters?.expandedRolePatterns,
    )
      ? search.parameters.expandedRolePatterns.filter(
          (p: unknown): p is string =>
            typeof p === "string" && p.trim().length > 0,
        )
      : undefined;

    const user = await ctx.runQuery(internal.users.internal.getUserInternal, {
      userId: args.userId,
    });
    const isEnterpriseUser = user?.plan === "enterprise";

    let providerKeys: Record<string, string> | undefined;
    if (isEnterpriseUser) {
      try {
        const resolvedKeys = (await ctx.runAction(
          internal.userApiKeys.actions.resolveUserProviderKeys,
          {
            userId: args.userId,
            purpose: "company_research",
          },
        )) as Record<string, string>;

        if (resolvedKeys.perplexity) {
          providerKeys = { perplexity: resolvedKeys.perplexity };
        }
      } catch {
        // fall back to platform keys
      }
    }

    const response = await fetch(
      buildLangGraphUrl(langgraphUrl, "/discover-people"),
      {
        method: "POST",
        headers: langGraphRequestHeaders(langgraphApiKey),
        body: JSON.stringify({
          companyName: lead.businessName,
          domain,
          location: lead.address,
          industry: lead.category,
          requestedRoles,
          expandedRolePatterns,
          userId: args.userId,
          userTier: user?.plan ?? "free",
          providerKeys: providerKeys
            ? {
                perplexity: providerKeys.perplexity,
              }
            : undefined,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[PeopleDiscovery] Failed for ${lead.businessName}: ${response.status} ${errorText}`,
      );
      return {
        success: false,
        reason: "api_error",
        prospectCount: 0,
      };
    }

    const data = (await response.json()) as {
      people?: DiscoverPeopleApiPerson[];
      companyOverview?: string;
      rawData?: Record<string, unknown>;
      researchTier?: string;
    };

    const people = (data.people ?? []).filter(
      (p) => p.name?.trim() && p.title?.trim(),
    );

    const sanitizeOptionalString = (value: unknown): string | undefined => {
      if (typeof value !== "string") {
        return undefined;
      }
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    };

    const companyResearchPayload = {
      company_overview: data.companyOverview ?? "",
      raw_data: {
        company_overview: data.companyOverview ?? "",
        people_discovery: true,
        people: people,
        raw: data.rawData ?? {},
        research_tier: data.researchTier ?? "pro",
      },
      confidence_score: people.length > 0 ? 0.75 : 0.3,
      research_tier: data.researchTier ?? "pro",
    };

    const persistResult = await ctx.runMutation(
      internal.leads.peopleDiscoveryInternal.persistLeadProspects,
      {
        leadId: args.leadId,
        searchId: args.searchId,
        userId: args.userId,
        people: people.map((person) => ({
          name: person.name.trim(),
          title: person.title.trim(),
          matchedRole: sanitizeOptionalString(person.matchedRole),
          confidence:
            typeof person.confidence === "number" ? person.confidence : 0.7,
          source: "perplexity" as const,
          sourceUrl: sanitizeOptionalString(person.sourceUrl),
          linkedinUrl: sanitizeOptionalString(person.linkedinUrl),
          rawDiscoveryData: person,
        })),
        companyOverview: data.companyOverview,
        companyResearchPayload,
        domain,
      },
    );

    await ctx.runMutation(
      internal.leads.peopleDiscoveryInternal.markLeadPeopleDiscoveryComplete,
      {
        leadId: args.leadId,
        prospectCount: persistResult.prospectCount,
      },
    );

    return {
      success: true,
      prospectCount: persistResult.prospectCount,
      companyResearchId: persistResult.companyResearchId,
    };
  },
});
