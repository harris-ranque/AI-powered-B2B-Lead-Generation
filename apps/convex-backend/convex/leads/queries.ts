import { query } from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";
import { requireAuth, getCurrentUser } from "../auth";
import {
  countExportableLeads,
  countExportableSummaryForSearch,
  computeExportReadinessForContacts,
  dedupeExportContactsByEmail,
  filterFullyExportableContacts,
  sortExportContactsForCsv,
  formatExportPhone,
  resolveContactExportTitle,
  resolveSearchExportData,
} from "../lib/exportEligibility";
import { resolveExportResearchFields } from "../lib/exportResearchFields";
import { computeAnalysisProgress } from "../lib/analysisProgress";

// Get leads for a search (FULL documents - use sparingly, prefer getLeadsListView)
export const getLeadsBySearch = query({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Verify user owns the search
    const search = await ctx.db.get(args.searchId);
    if (!search || search.userId !== user._id) {
      throw new Error("Search not found or access denied");
    }

    const leads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .order("desc")
      .collect();

    const links = await ctx.db
      .query("searchLinkedLeads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    const seen = new Set(leads.map((lead) => String(lead._id)));
    for (const link of links) {
      const key = String(link.leadId);
      if (seen.has(key)) {
        continue;
      }
      const linkedLead = await ctx.db.get(link.leadId);
      if (linkedLead) {
        seen.add(key);
        leads.push(linkedLead);
      }
    }

    return leads;
  },
});

// Get leads for list view (LIGHTWEIGHT - only fields needed for display)
// Use this for lead tables/lists, use getLead() for full details on click
export const getLeadsListView = query({
  args: {
    searchId: v.id("searches"),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Verify user owns the search
    const search = await ctx.db.get(args.searchId);
    if (!search || search.userId !== user._id) {
      throw new Error("Search not found or access denied");
    }

    const pageSize = Math.min(args.limit || 25, 100); // Default 25, max 100

    const result = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .order("desc")
      .paginate({
        numItems: pageSize,
        cursor: args.cursor as any ?? null
      });

    // Return only fields needed for list display (excludes heavy aiAnalysis)
    const leads = result.page.map(lead => ({
      _id: lead._id,
      businessName: lead.businessName,
      formattedAddress: lead.location?.formattedAddress || "",
      phone: lead.phone || "",
      website: lead.website || "",
      primaryEmail: lead.contactInfo?.emails?.[0]?.email || "",
      emailCount: lead.contactInfo?.emails?.length || 0,
      status: lead.status,
      enrichmentStatus: lead.enrichmentStatus,
      enrichmentProvider: lead.enrichmentProvider,
      // Just scores and flags, not full analysis content
      relevanceScore: lead.aiAnalysis?.relevanceScore ?? null,
      hasEmailSequence: !!(lead.generatedEmails?.length),
      hasResearch: !!lead.aiAnalysis?.leadAnalysis,
      researchTier: lead.aiAnalysis?.researchTier || null,
      rating: lead.rating,
      reviewCount: lead.reviewCount,
      createdAt: lead._creationTime,
    }));

    return {
      leads,
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

// Export leads with pagination support to avoid 16MB limit
// When searchId is provided, exports leads for that search (scoped, typically safe)
// When no searchId, uses pagination to handle users with many leads
export const exportLeads = query({
  args: {
    userId: v.id("users"),
    searchId: v.optional(v.id("searches")),
    limit: v.optional(v.number()), // Default 5000 per page for exports
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(args.limit || 5000, 5000);

    if (args.searchId) {
      const search = await ctx.db.get(args.searchId);
      if (!search) {
        throw new Error("Search not found");
      }

      const user = await getCurrentUser(ctx);
      if (!user || search.userId !== user._id) {
        throw new Error("Search not found or access denied");
      }

      const exportResolution = await resolveSearchExportData(
        ctx,
        args.searchId!,
        user._id,
      );
      const allContacts = exportResolution.contacts;
      const exportableContacts = await filterFullyExportableContacts(
        ctx,
        allContacts,
      );

      const companyNameByLeadId = new Map<string, string>();
      for (const contact of exportableContacts) {
        const leadKey = String(contact.leadId);
        if (companyNameByLeadId.has(leadKey)) {
          continue;
        }
        const lead = await ctx.db.get(contact.leadId);
        companyNameByLeadId.set(leadKey, lead?.businessName ?? "");
      }
      const sortedExportableContacts = sortExportContactsForCsv(
        exportableContacts,
        companyNameByLeadId,
      );

      const startIndex = args.cursor ? Number.parseInt(args.cursor, 10) : 0;
      const pageContacts = sortedExportableContacts.slice(
        startIndex,
        startIndex + pageSize,
      );
      const nextIndex = startIndex + pageContacts.length;
      const isDone = nextIndex >= sortedExportableContacts.length;

      const tierLabels: Record<string, string> = {
        basic: "Basic (Tavily)",
        pro: "Pro (Sonar Pro)",
        deep: "Deep (Deep Research)",
        unknown: "Not Available",
      };

      const pageCompanyResearchIds = [
        ...new Set(
          pageContacts
            .map((contact) => contact.companyResearchId)
            .filter((id): id is Id<"companyResearch"> => Boolean(id)),
        ),
      ];
      const companyResearchById = new Map<string, unknown>();
      for (const researchId of pageCompanyResearchIds) {
        const doc = await ctx.db.get(researchId);
        if (doc?.status === "completed") {
          companyResearchById.set(String(researchId), doc.researchPayload);
        }
      }

      const formattedLeads = [];
      for (const contact of pageContacts) {
        const lead = await ctx.db.get(contact.leadId);
        if (!lead) continue;

        const aiAnalysis = contact.aiAnalysis ?? lead.aiAnalysis;
        const companyData = aiAnalysis?.companyData;
        const researchTier = aiAnalysis?.researchTier || "unknown";
        const leadAnalysis = aiAnalysis?.leadAnalysis as
          | Record<string, unknown>
          | undefined;
        const companyResearchPayload = contact.companyResearchId
          ? companyResearchById.get(String(contact.companyResearchId))
          : undefined;
        const exportResearch = resolveExportResearchFields(
          leadAnalysis,
          companyResearchPayload,
        );

        formattedLeads.push({
          id: contact._id,
          leadId: lead._id,
          contactId: contact._id,
          name: lead.businessName,
          contactName: contact.name,
          title: resolveContactExportTitle(contact),
          address: lead.location.formattedAddress,
          phone: formatExportPhone(lead.phone),
          website: lead.website || "",
          email: contact.email,
          rating: lead.rating || 0,
          reviewCount: lead.reviewCount || 0,
          placeId: lead.placeId,
          enrichmentStatus: lead.enrichmentStatus,
          analysisStatus: contact.analysisStatus,
          researchTier,
          researchTierLabel: tierLabels[researchTier] || "Unknown",
          annualRevenueAmount: companyData?.annual_revenue?.amount || "",
          annualRevenueYear: companyData?.annual_revenue?.year || "",
          annualRevenueSource: companyData?.annual_revenue?.source || "",
          employeeCount: companyData?.employee_count?.count || "",
          employeeCountAsOf: companyData?.employee_count?.as_of || "",
          employeeCountSource: companyData?.employee_count?.source || "",
          leadership1Name: companyData?.leadership_names?.[0]?.name || "",
          leadership1Title: companyData?.leadership_names?.[0]?.title || "",
          leadership2Name: companyData?.leadership_names?.[1]?.name || "",
          leadership2Title: companyData?.leadership_names?.[1]?.title || "",
          leadership3Name: companyData?.leadership_names?.[2]?.name || "",
          leadership3Title: companyData?.leadership_names?.[2]?.title || "",
          recentNews1: companyData?.recent_news?.[0]?.event || "",
          recentNews1Date: companyData?.recent_news?.[0]?.date || "",
          recentNews2: companyData?.recent_news?.[1]?.event || "",
          recentNews2Date: companyData?.recent_news?.[1]?.date || "",
          recentNews3: companyData?.recent_news?.[2]?.event || "",
          recentNews3Date: companyData?.recent_news?.[2]?.date || "",
          fundingTotalRaised: companyData?.funding_details?.total_raised || "",
          fundingLatestRound: companyData?.funding_details?.latest_round || "",
          fundingSource: companyData?.funding_details?.source || "",
          fullResearchReport: exportResearch.fullResearchReport,
          perplexityCitations: JSON.stringify(exportResearch.citations),
          researchConfidenceScore: exportResearch.researchConfidenceScore,
          emailSubject: contact.emailContent?.subject || "",
          emailBody: contact.emailContent?.body || "",
          createdAt: new Date(
            contact.createdAt || contact._creationTime,
          ).toISOString(),
          updatedAt: new Date(contact.updatedAt || contact._creationTime).toISOString(),
        });
      }

      return {
        leads: formattedLeads,
        cursor: isDone ? null : String(nextIndex),
        isDone,
      };
    }

    let queryBuilder;
    if (args.searchId) {
      // Scoped to specific search - use that index
      queryBuilder = ctx.db
        .query("leads")
        .withIndex("by_search", (q) => q.eq("searchId", args.searchId!))
        .filter((q) => q.eq(q.field("userId"), args.userId));
    } else {
      // All user leads - use user index with pagination
      queryBuilder = ctx.db
        .query("leads")
        .withIndex("by_user", (q) => q.eq("userId", args.userId));
    }

    const result = await queryBuilder
      .order("desc")
      .paginate({ numItems: pageSize, cursor: args.cursor as any ?? null });

    const leads = result.page;

    // Format leads for export with enhanced research data
    const formattedLeads = leads.map((lead) => {
      const companyData = lead.aiAnalysis?.companyData;
      const researchTier = lead.aiAnalysis?.researchTier || "unknown";

      // Research tier label mapping
      const tierLabels: Record<string, string> = {
        "basic": "Basic (Tavily)",
        "pro": "Pro (Sonar Pro)",
        "deep": "Deep (Deep Research)",
        "unknown": "Not Available"
      };

      return {
        // Existing basic fields (9 columns)
        id: lead._id,
        name: lead.businessName,
        address: lead.location.formattedAddress,
        phone: lead.phone || "",
        website: lead.website || "",
        email: lead.contactInfo?.emails?.[0]?.email || "",
        rating: lead.rating || 0,
        reviewCount: lead.reviewCount || 0,
        placeId: lead.placeId,
        enrichmentStatus: lead.enrichmentStatus,

        // New research tier fields (2 columns)
        researchTier: researchTier,
        researchTierLabel: tierLabels[researchTier] || "Unknown",

        // Annual revenue fields (3 columns)
        annualRevenueAmount: companyData?.annual_revenue?.amount || "",
        annualRevenueYear: companyData?.annual_revenue?.year || "",
        annualRevenueSource: companyData?.annual_revenue?.source || "",

        // Employee count fields (3 columns)
        employeeCount: companyData?.employee_count?.count || "",
        employeeCountAsOf: companyData?.employee_count?.as_of || "",
        employeeCountSource: companyData?.employee_count?.source || "",

        // Leadership fields (6 columns - top 3 leaders)
        leadership1Name: companyData?.leadership_names?.[0]?.name || "",
        leadership1Title: companyData?.leadership_names?.[0]?.title || "",
        leadership2Name: companyData?.leadership_names?.[1]?.name || "",
        leadership2Title: companyData?.leadership_names?.[1]?.title || "",
        leadership3Name: companyData?.leadership_names?.[2]?.name || "",
        leadership3Title: companyData?.leadership_names?.[2]?.title || "",

        // Recent news fields (6 columns - top 3 news items)
        recentNews1: companyData?.recent_news?.[0]?.event || "",
        recentNews1Date: companyData?.recent_news?.[0]?.date || "",
        recentNews2: companyData?.recent_news?.[1]?.event || "",
        recentNews2Date: companyData?.recent_news?.[1]?.date || "",
        recentNews3: companyData?.recent_news?.[2]?.event || "",
        recentNews3Date: companyData?.recent_news?.[2]?.date || "",

        // Funding details fields (3 columns)
        fundingTotalRaised: companyData?.funding_details?.total_raised || "",
        fundingLatestRound: companyData?.funding_details?.latest_round || "",
        fundingSource: companyData?.funding_details?.source || "",

        // Full research report fields (3 columns)
        fullResearchReport: lead.aiAnalysis?.leadAnalysis?.research_metadata?.comprehensive_report ||
                           lead.aiAnalysis?.leadAnalysis?.comprehensive_report || "",
        perplexityCitations: JSON.stringify(lead.aiAnalysis?.leadAnalysis?.research_metadata?.citations || []),
        researchConfidenceScore: lead.aiAnalysis?.leadAnalysis?.research_metadata?.confidence_score || "",

        // Timestamps
        createdAt: new Date(lead.createdAt || lead._creationTime).toISOString(),
        updatedAt: new Date(lead.updatedAt || lead._creationTime).toISOString(),
      };
    });

    return {
      leads: formattedLeads,
      cursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

// Get user leads with pagination (FULL documents - use sparingly)
// Returns null if not authenticated (allows query during auth hydration)
export const getUserLeads = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    searchId: v.optional(v.id("searches")),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return null;
    }

    // OPTIMIZATION: Reduce default limit from 20 to 10
    const limit = Math.min(args.limit || 10, 50); // Cap at 50 leads max
    const offset = args.offset || 0;

    let query = ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", user._id));

    if (args.searchId) {
      const searchId = args.searchId;
      query = ctx.db
        .query("leads")
        .withIndex("by_search", (q) => q.eq("searchId", searchId))
        .filter((q) => q.eq(q.field("userId"), user._id));
    }

    const leads = await query.order("desc").take(limit + offset);

    return leads.slice(offset);
  },
});

// Get user leads for list view (LIGHTWEIGHT with cursor pagination)
// Use this for lead tables/history, use getLead() for full details on click
export const getUserLeadsListView = query({
  args: {
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    searchId: v.optional(v.id("searches")),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const pageSize = Math.min(args.limit || 25, 100); // Default 25, max 100

    let queryBuilder;

    if (args.searchId) {
      // Verify user owns the search
      const search = await ctx.db.get(args.searchId);
      if (!search || search.userId !== user._id) {
        throw new Error("Search not found or access denied");
      }
      queryBuilder = ctx.db
        .query("leads")
        .withIndex("by_search", (q) => q.eq("searchId", args.searchId!));
    } else {
      queryBuilder = ctx.db
        .query("leads")
        .withIndex("by_user", (q) => q.eq("userId", user._id));
    }

    const result = await queryBuilder
      .order("desc")
      .paginate({
        numItems: pageSize,
        cursor: args.cursor as any ?? null
      });

    // Return only fields needed for list display
    const leads = result.page.map(lead => ({
      _id: lead._id,
      businessName: lead.businessName,
      formattedAddress: lead.location?.formattedAddress || "",
      phone: lead.phone || "",
      website: lead.website || "",
      primaryEmail: lead.contactInfo?.emails?.[0]?.email || "",
      emailCount: lead.contactInfo?.emails?.length || 0,
      status: lead.status,
      enrichmentStatus: lead.enrichmentStatus,
      enrichmentProvider: lead.enrichmentProvider,
      relevanceScore: lead.aiAnalysis?.relevanceScore ?? null,
      hasEmailSequence: !!(lead.generatedEmails?.length),
      hasResearch: !!lead.aiAnalysis?.leadAnalysis,
      researchTier: lead.aiAnalysis?.researchTier || null,
      rating: lead.rating,
      reviewCount: lead.reviewCount,
      searchId: lead.searchId,
      createdAt: lead._creationTime,
    }));

    return {
      leads,
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

// Get single lead by ID
export const getLead = query({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.userId !== user._id) {
      throw new Error("Lead not found or access denied");
    }

    return lead;
  },
});

// Get email sequences for a lead
export const getEmailSequences = query({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Verify lead belongs to user
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.userId !== user._id) {
      throw new Error("Lead not found or access denied");
    }

    // Get email sequences (LangGraph requests) for this lead
    const emailRequests = await ctx.db
      .query("langgraphRequests")
      .withIndex("by_lead", (q) => q.eq("leadId", args.leadId))
      .filter((q) => q.eq(q.field("type"), "email_generation"))
      .order("desc")
      .collect();

    // Format as email sequences
    return emailRequests.map((request) => ({
      id: request._id,
      requestId: request.requestId,
      status: request.status,
      emailType: request.inputData?.emailType || "initial",
      subject: request.outputData?.subject || null,
      content: request.outputData?.content || null,
      createdAt: request.createdAt,
      completedAt: request.completedAt || null,
      error: request.error || null,
    }));
  },
});

// Get enrichment progress for a specific search (for user-facing status updates)
export const getEnrichmentProgress = query({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Verify user owns the search
    const search = await ctx.db.get(args.searchId);
    if (!search || search.userId !== user._id) {
      throw new Error("Search not found or access denied");
    }

    // Native leads created directly on this search
    const nativeLeads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    // Linked leads (duplicates from prior searches being re-enriched under this search)
    const linkedRows = await ctx.db
      .query("searchLinkedLeads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    // Fetch each linked lead document (deduplicated vs native set)
    const nativeIds = new Set(nativeLeads.map((l) => String(l._id)));
    const linkedLeads: (typeof nativeLeads[number])[] = [];
    for (const row of linkedRows) {
      if (nativeIds.has(String(row.leadId))) continue;
      const lead = await ctx.db.get(row.leadId);
      if (lead) linkedLeads.push(lead);
    }

    const allLeads = [...nativeLeads, ...linkedLeads];

    // For linked leads the enrichment state is on searchLinkedLeads, not the lead row.
    // Map leadId → link status so we can override enrichment counts correctly.
    const linkedStatusById = new Map(
      linkedRows.map((r) => [String(r.leadId), r.status]),
    );

    const peopleDiscoveryEnabled =
      process.env.PEOPLE_DISCOVERY_ENABLED !== "false";

    let scopedNativeLeads = nativeLeads;
    let scopedLinkedRows = linkedRows;
    let businessesWithPeople = 0;

    if (peopleDiscoveryEnabled) {
      const prospects = await ctx.db
        .query("leadProspects")
        .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
        .collect();

      const leadIdsWithProspects = new Set(
        prospects.map((prospect) => String(prospect.leadId)),
      );
      businessesWithPeople = leadIdsWithProspects.size;

      scopedNativeLeads = nativeLeads.filter((lead) =>
        leadIdsWithProspects.has(String(lead._id)),
      );
      scopedLinkedRows = linkedRows.filter((row) =>
        leadIdsWithProspects.has(String(row.leadId)),
      );
    }

    // Count native lead enrichment statuses (scoped to step-1 passers when people discovery runs)
    const nativePending = scopedNativeLeads.filter(
      (l) => l.enrichmentStatus === "pending",
    ).length;
    const nativeInProgress = scopedNativeLeads.filter(
      (l) => l.enrichmentStatus === "in_progress",
    ).length;
    const nativeCompleted = scopedNativeLeads.filter(
      (l) =>
        l.enrichmentStatus === "completed" ||
        l.enrichmentStatus === "completed_fallback",
    ).length;
    const nativeFailed = scopedNativeLeads.filter(
      (l) => l.enrichmentStatus === "failed",
    ).length;
    const nativeNoContacts = scopedNativeLeads.filter(
      (l) => l.enrichmentStatus === "no_contacts_found",
    ).length;

    // Count linked lead statuses from the searchLinkedLeads rows
    const linkedPending = scopedLinkedRows.filter(
      (r) => r.status === "pending",
    ).length;
    const linkedEnriched = scopedLinkedRows.filter(
      (r) => r.status === "enriched",
    ).length;
    const linkedFailed = scopedLinkedRows.filter(
      (r) => r.status === "failed",
    ).length;

    const pending = nativePending + linkedPending;
    const inProgress = nativeInProgress;
    const completed = nativeCompleted + linkedEnriched;
    const failed = nativeFailed + linkedFailed;
    const noContacts = nativeNoContacts;

    const scopedLeadIds = new Set([
      ...scopedNativeLeads.map((lead) => String(lead._id)),
      ...scopedLinkedRows.map((row) => String(row.leadId)),
    ]);

    // withEmail: accepted contacts created for this search (new pipeline) or lead-level emails
    const acceptedContacts = await ctx.db
      .query("leadContacts")
      .withIndex("by_search_status", (q) =>
        q.eq("searchId", args.searchId).eq("status", "accepted"),
      )
      .collect();
    const withEmail =
      acceptedContacts.length > 0
        ? new Set(
            acceptedContacts
              .filter((contact) => scopedLeadIds.has(String(contact.leadId)))
              .map((contact) => String(contact.leadId)),
          ).size
        : allLeads.filter(
            (l) =>
              scopedLeadIds.has(String(l._id)) &&
              !linkedStatusById.has(String(l._id)) &&
              (Boolean(l.primaryEmail) ||
                (l.contactInfo?.emails && l.contactInfo.emails.length > 0)),
          ).length;

    const total = peopleDiscoveryEnabled
      ? businessesWithPeople
      : nativeLeads.length + linkedRows.length;
    const processed = completed + failed + noContacts;
    const percentComplete =
      total > 0 ? Math.round((processed / total) * 100) : 0;

    const findymailCount = scopedNativeLeads.filter(
      (l) => l.enrichmentProvider === "findymail",
    ).length;

    return {
      searchId: args.searchId,
      searchStatus: search.status,
      total,
      pending,
      inProgress,
      completed,
      failed,
      noContacts,
      withEmail,
      processed,
      percentComplete,
      businessesWithPeople: peopleDiscoveryEnabled ? businessesWithPeople : undefined,
      peopleDiscoveryScoped: peopleDiscoveryEnabled,
      providers: {
        findymail: findymailCount,
      },
      isComplete: pending === 0 && inProgress === 0,
      isPaused: search.enrichmentPaused || false,
    };
  },
});

// People discovery progress (website scrape + semantic role filter) for a search
export const getPeopleDiscoveryProgress = query({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const search = await ctx.db.get(args.searchId);
    if (!search || search.userId !== user._id) {
      throw new Error("Search not found or access denied");
    }

    const peopleDiscoveryEnabled =
      process.env.PEOPLE_DISCOVERY_ENABLED !== "false";

    const nativeLeads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    const linkedRows = await ctx.db
      .query("searchLinkedLeads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    const totalBusinesses = nativeLeads.length + linkedRows.length;

    if (!peopleDiscoveryEnabled) {
      return {
        searchId: args.searchId,
        enabled: false,
        totalBusinesses,
        businessesProcessed: totalBusinesses,
        businessesWithPeople: 0,
        totalProspects: 0,
        percentComplete: 100,
        isComplete: true,
      };
    }

    const batches = await ctx.db
      .query("enrichmentBatches")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    const peopleBatch = batches
      .filter((batch) => batch.batchId.startsWith("people_"))
      .sort((a, b) => b.startedAt - a.startedAt)[0];

    const prospects = await ctx.db
      .query("leadProspects")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    const totalProspects = prospects.length;
    const businessesWithPeople = new Set(
      prospects.map((prospect) => String(prospect.leadId)),
    ).size;

    const batchTotal = peopleBatch?.totalLeads ?? totalBusinesses;
    const businessesProcessed = peopleBatch?.completedLeads ?? 0;
    const percentComplete =
      batchTotal > 0
        ? Math.round((businessesProcessed / batchTotal) * 100)
        : 0;

    const isComplete =
      peopleBatch?.status === "completed" ||
      (batchTotal > 0 && businessesProcessed >= batchTotal);

    return {
      searchId: args.searchId,
      enabled: true,
      totalBusinesses: batchTotal,
      businessesProcessed,
      businessesWithPeople,
      totalProspects,
      percentComplete,
      isComplete,
      batchStatus: peopleBatch?.status,
    };
  },
});

export const getPeopleDiscoveryLogs = query({
  args: {
    searchId: v.id("searches"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const search = await ctx.db.get(args.searchId);
    if (!search || search.userId !== user._id) {
      throw new Error("Search not found or access denied");
    }

    const limit = Math.min(Math.max(args.limit ?? 200, 1), 500);
    const logs = await ctx.db
      .query("peopleDiscoveryLogs")
      .withIndex("by_search_created", (q) => q.eq("searchId", args.searchId))
      .order("asc")
      .take(limit);

    return logs.map((log) => ({
      id: log._id,
      event: log.event,
      message: log.message,
      businessName: log.businessName,
      domain: log.domain,
      prospectCount: log.prospectCount,
      people: log.people,
      leadId: log.leadId,
      batchId: log.batchId,
      metadata: log.metadata,
      createdAt: log.createdAt,
    }));
  },
});

// Live analysis / "Write Emails" progress for a search
export const getAnalysisProgress = query({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const search = await ctx.db.get(args.searchId);
    if (!search || search.userId !== user._id) {
      throw new Error("Search not found or access denied");
    }

    const progress = await computeAnalysisProgress(ctx, args.searchId);

    return {
      ...progress,
      searchStatus: search.status,
      researchTier: search.researchTier ?? null,
    };
  },
});

// Get live exportable lead counts for a list of searches (up to one page worth).
// Mirrors isLeadExportable(): enrichmentStatus === "completed" AND analysisStatus !== "failed".
// Returns a Record<searchId, count> so the caller can look up by search ID.
export const getLeadCountsBySearchIds = query({
  args: { searchIds: v.array(v.id("searches")) },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return {};

    // Cap to prevent runaway query cost (each call is a full index scan per search)
    const idsToProcess = args.searchIds.slice(0, 50);

    const counts: Record<string, number> = {};
    for (const searchId of idsToProcess) {
      // Ownership check: silently skip searches that don't belong to this user
      const search = await ctx.db.get(searchId);
      if (!search || search.userId !== user._id) continue;
      counts[String(searchId)] = (
        await countExportableSummaryForSearch(ctx, searchId, user._id)
      ).exportableContacts;
    }
    return counts;
  },
});

// Live exportable contact + business counts for search history / dashboard labels.
export const getExportSummariesBySearchIds = query({
  args: { searchIds: v.array(v.id("searches")) },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return {};

    const idsToProcess = args.searchIds.slice(0, 50);
    const summaries: Record<
      string,
      {
        exportableContacts: number;
        exportableBusinesses: number;
        fromThisSearch: number;
        priorSearchExportable: number;
        duplicateSkips: number;
      }
    > = {};

    for (const searchId of idsToProcess) {
      const search = await ctx.db.get(searchId);
      if (!search || search.userId !== user._id) continue;
      summaries[String(searchId)] = await countExportableSummaryForSearch(
        ctx,
        searchId,
        user._id,
      );
    }

    return summaries;
  },
});

// Accepted contact counts for multi-contact pipeline UI (per search).
export const getAcceptedContactCountsBySearch = query({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const search = await ctx.db.get(args.searchId);
    if (!search || search.userId !== user._id) {
      throw new Error("Search not found or access denied");
    }

    const contacts = await ctx.db
      .query("leadContacts")
      .withIndex("by_search_status", (q) =>
        q.eq("searchId", args.searchId).eq("status", "accepted"),
      )
      .collect();

    const exportableContacts = await filterFullyExportableContacts(
      ctx,
      contacts,
    );
    const exportReadiness = await computeExportReadinessForContacts(
      ctx,
      contacts,
    );
    const exportResolution = await resolveSearchExportData(
      ctx,
      args.searchId,
      user._id,
    );
    const byLead: Record<string, number> = {};
    for (const contact of exportableContacts) {
      const key = String(contact.leadId);
      byLead[key] = (byLead[key] ?? 0) + 1;
    }

    const dedupedExportable = dedupeExportContactsByEmail(
      await filterFullyExportableContacts(ctx, exportResolution.contacts),
      args.searchId,
    );
    const totalExportableIncludingPrior = dedupedExportable.length;

    const linkedForReenrichment = (
      await ctx.db
        .query("searchLinkedLeads")
        .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
        .collect()
    ).length;

    return {
      totalAccepted: contacts.length,
      totalExportable: dedupeExportContactsByEmail(
        exportableContacts,
        args.searchId,
      ).length,
      duplicateFallbackExportable: exportResolution.priorSearchExportable,
      totalExportableIncludingPrior,
      duplicateSkips: exportResolution.duplicateSkips,
      linkedForReenrichment,
      byLead,
      multiContactEnabled: true,
      exportReadiness,
    };
  },
});

// Rejected FindyMail candidates for debugging acceptance/rejection behavior.
export const getRejectedFindyMailContactsBySearch = query({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const search = await ctx.db.get(args.searchId);
    if (!search || search.userId !== user._id) {
      throw new Error("Search not found or access denied");
    }

    const rejectedContacts = (
      await ctx.db
        .query("leadContacts")
        .withIndex("by_search_status", (q) =>
          q.eq("searchId", args.searchId).eq("status", "rejected"),
        )
        .collect()
    ).filter((contact) => contact.source === "findymail");

    const rows = [];
    for (const contact of rejectedContacts) {
      const lead = await ctx.db.get(contact.leadId);
      rows.push({
        contactId: contact._id,
        leadId: contact.leadId,
        searchId: contact.searchId,
        businessName: lead?.businessName ?? "",
        website: lead?.website ?? "",
        email: contact.email,
        normalizedEmail: contact.normalizedEmail,
        name: contact.name,
        title: contact.title ?? "",
        linkedin: contact.linkedin ?? "",
        confidence: contact.confidence,
        rejectionReason: contact.rejectionReason ?? "",
        requestedRoles: contact.requestedRoles,
        matchedRole: contact.matchedRole ?? "",
        titleMatchScore: contact.titleMatchScore ?? 0,
        titleMatchReason: contact.titleMatchReason ?? "",
        emailVerified: contact.emailVerified,
        domainMatchVerified: contact.domainMatchVerified,
        leadProspectId: contact.leadProspectId,
        createdAt: contact.createdAt,
        updatedAt: contact.updatedAt,
      });
    }

    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

// Get contact statistics for user (from leadContacts, not business count)
export const getLeadStats = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return null;
    }

    // Aggregate from searches table - MUCH lighter than loading all leads
    // Each search has pre-computed stats in results.totalFound, results.enrichedCount, etc.
    const searches = await ctx.db
      .query("searches")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    // Aggregate search-level metrics (businesses discovered, rates)
    let totalBusinessesDiscovered = 0;
    let enrichedLeads = 0;
    let analyzedLeads = 0;
    let relevanceSum = 0;
    let relevanceCount = 0;

    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    for (const search of searches) {
      const searchDiscovered = search.results?.totalFound || 0;
      const searchEnriched = search.results?.enrichedCount || 0;
      const searchAnalyzed = search.results?.analyzedCount || 0;
      const searchAvgRelevance = search.results?.avgRelevanceScore;

      totalBusinessesDiscovered += searchDiscovered;
      enrichedLeads += searchEnriched;
      analyzedLeads += searchAnalyzed;

      if (searchAvgRelevance && searchAnalyzed > 0) {
        relevanceSum += searchAvgRelevance * searchAnalyzed;
        relevanceCount += searchAnalyzed;
      }
    }

    const acceptedContacts = await ctx.db
      .query("leadContacts")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const acceptedWithEmail = acceptedContacts.filter(
      (contact) =>
        contact.status === "accepted" && contact.email.trim().length > 0,
    );

    const exportableContacts = await filterFullyExportableContacts(
      ctx,
      acceptedWithEmail,
    );

    const dedupeByEmail = <T extends { normalizedEmail: string; createdAt: number }>(
      contacts: T[],
    ): T[] => {
      const byEmail = new Map<string, T>();
      for (const contact of contacts) {
        const key = contact.normalizedEmail.toLowerCase().trim();
        if (!key) continue;
        const existing = byEmail.get(key);
        if (!existing || contact.createdAt > existing.createdAt) {
          byEmail.set(key, contact);
        }
      }
      return [...byEmail.values()];
    };

    const uniqueAccepted = dedupeByEmail(acceptedWithEmail);
    const uniqueExportable = dedupeByEmail(exportableContacts);

    const totalContacts = uniqueAccepted.length;
    const exportableCount = uniqueExportable.length;
    const thisWeekContacts = uniqueAccepted.filter(
      (contact) => contact.createdAt >= oneWeekAgo,
    ).length;

    const avgRelevanceScore =
      relevanceCount > 0 ? relevanceSum / relevanceCount : 0;

    const rateBase =
      totalBusinessesDiscovered > 0 ? totalBusinessesDiscovered : 1;

    return {
      // Dashboard: people with verified emails (multi-contact per company)
      totalLeads: totalContacts,
      totalContacts,
      totalBusinessesDiscovered,
      enrichedLeads,
      analyzedLeads,
      withEmails: exportableCount,
      thisWeek: thisWeekContacts,
      enrichmentRate:
        rateBase > 0 ? Math.round((enrichedLeads / rateBase) * 100) : 0,
      analysisRate:
        rateBase > 0 ? Math.round((analyzedLeads / rateBase) * 100) : 0,
      avgRelevanceScore: Math.round(avgRelevanceScore * 100),
      acceptedContacts: uniqueAccepted.length,
      qualifiedLeads: 0,
      contactedLeads: 0,
      conversionRate: 0,
    };
  },
});
