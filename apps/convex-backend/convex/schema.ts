import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const themePreferenceValidator = v.union(
  v.literal("harborlight"),
  v.literal("neon-pulse"),
);

export default defineSchema({
  // Users table - Authentication and basic user info
  users: defineTable({
    // Clerk integration fields
    clerkId: v.optional(v.string()), // Clerk user ID for syncing (optional for admin-created subscription users)
    email: v.string(),
    name: v.optional(v.string()),
    avatar: v.optional(v.string()),
    plan: v.union(
      v.literal("free"),
      v.literal("pro"),
      v.literal("starter"),
      v.literal("professional"),
      v.literal("business"),
      v.literal("enterprise"),
      v.literal("custom"), // Custom subscription created by admin
    ),
    credits: v.number(),
    // Subscription credits (separate from purchased credits, use-it-or-lose-it monthly)
    subscriptionCredits: v.optional(v.number()),
    role: v.union(v.literal("user"), v.literal("admin")),
    isActive: v.boolean(),
    // Per-user processing pause (admin-controlled)
    processingPaused: v.optional(v.boolean()),
    pauseReason: v.optional(v.string()),
    pausedAt: v.optional(v.number()),
    pausedBy: v.optional(v.id("users")),
    // FastSpring integration fields (legacy)
    fastspringAccountId: v.optional(v.string()),
    fastspringSubscriptionId: v.optional(v.string()),
    // Stripe integration fields
    stripeCustomerId: v.optional(v.string()),
    preferences: v.optional(
      v.object({
        emailNotifications: v.boolean(),
        language: v.string(),
        timezone: v.string(),
        theme: v.optional(themePreferenceValidator),
        // Deduplication preferences
        enablePlaceNameDedup: v.optional(v.boolean()), // Search-level place name dedup
        enableEmailDedup: v.optional(v.boolean()),     // User-level email dedup (default: ON)
        enableAddressDedup: v.optional(v.boolean()),   // User-level address dedup (default: ON)
        maxSearchExpansionIterations: v.optional(v.number()), // Max automatic radius expansions (default 5)
        searchExpansionMultiplier: v.optional(v.number()),    // Radius multiplier per expansion (default 1.5)
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_email", ["email"])
    .index("by_plan", ["plan"])
    .index("by_role", ["role"])
    .index("by_created", ["createdAt"])
    .index("by_stripe_customer", ["stripeCustomerId"])
    .index("by_active", ["isActive"])
    .index("by_active_created", ["isActive", "createdAt"]),

  // Business Profiles - Company information for AI personalization
  businessProfiles: defineTable({
    userId: v.id("users"),
    companyName: v.string(),
    industry: v.string(),
    valueProposition: v.string(),
    services: v.array(v.string()),
    targetMarkets: v.array(v.string()),
    keyDifferentiators: v.array(v.string()),
    caseStudies: v.optional(
      v.array(
        v.object({
          title: v.string(),
          client: v.string(),
          results: v.string(),
          metrics: v.any(),
        }),
      ),
    ),
    contactInfo: v.object({
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      website: v.optional(v.string()),
      linkedin: v.optional(v.string()),
      signature: v.optional(v.string()),
      signatureEnabled: v.optional(v.boolean()),
    }),
    isComplete: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_company", ["companyName"]),

  // Searches - Lead search sessions and parameters
  searches: defineTable({
    userId: v.id("users"),
    name: v.string(),
    parameters: v.object({
      location: v.string(),
      locationPlaceId: v.optional(v.string()), // Google Places place_id for accurate geocoding
      radius: v.number(),
      keywords: v.array(v.string()),
      industries: v.optional(v.array(v.string())),
      excludeTerms: v.optional(v.array(v.string())),
      roles: v.optional(v.array(v.string())),
      expandRelatedRoles: v.optional(v.boolean()),
      minRating: v.optional(v.number()),
      maxResults: v.number(),
      // Legacy filters field for backwards compatibility with old search records
      filters: v.optional(
        v.object({
          minEmployees: v.optional(v.number()),
          maxEmployees: v.optional(v.number()),
        }),
      ),
      deduplication: v.optional(
        v.object({
          enablePlaceNameDedup: v.optional(v.boolean()),
          enableEmailDedup: v.optional(v.boolean()),
          enableAddressDedup: v.optional(v.boolean()),
        }),
      ),
    }),
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    progress: v.object({
      discovered: v.number(),
      enriched: v.number(),
      analyzed: v.number(),
      total: v.number(),
    }),
    results: v.object({
      totalFound: v.number(),
      enrichedCount: v.number(),
      exportableCount: v.optional(v.number()),
      analyzedCount: v.optional(v.number()),
      avgRelevanceScore: v.optional(v.number()),
    }),
    error: v.optional(v.string()),
    creditsUsed: v.number(),
    creditsReserved: v.optional(v.number()),
    reservationId: v.optional(v.id("creditReservations")),
    actualCosts: v.optional(
      v.object({
        discovery: v.number(),
        enrichment: v.number(),
        analysis: v.number(),
      }),
    ),
    creditsRefunded: v.optional(v.number()),
    partialResults: v.optional(v.boolean()),
    requestedCount: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    lastOrchestrationAt: v.optional(v.number()),
    orchestrationLock: v.optional(v.string()),
    orchestrationLockExpiry: v.optional(v.number()),
    orchestrationAttempts: v.optional(v.number()),
    lastWarningAt: v.optional(v.number()),

    // Search completion tracking (prevents race conditions in batch completion)
    completionTriggered: v.optional(v.boolean()),
    completionTriggeredAt: v.optional(v.number()),

    // Research progress tracking (for tiered business context research)
    researchStage: v.optional(
      v.union(
        v.literal("research_started"),
        v.literal("tier1_tavily"),
        v.literal("tier2_perplexity"),
        v.literal("research_completed"),
        v.literal("research_failed"),
        v.literal("research_error"),
      ),
    ),
    researchTier: v.optional(
      v.union(
        v.literal("tavily"),
        v.literal("perplexity"),
        v.literal("error"),
      ),
    ),
    researchConfidence: v.optional(v.number()),
    researchDataPoints: v.optional(v.number()),
    researchSourcesAnalyzed: v.optional(v.number()),
    researchEscalationReason: v.optional(v.string()),
    researchResults: v.optional(
      v.object({
        tier: v.string(),
        confidence: v.number(),
        dataPoints: v.number(),
        sourcesAnalyzed: v.number(),
        researchTime: v.number(),
        escalationReason: v.optional(v.string()),
        competitors: v.optional(v.array(v.any())),
        industryInsights: v.optional(v.string()),
        comprehensiveReport: v.optional(v.string()),
      }),
    ),
    researchCompletedAt: v.optional(v.number()),

    // Admin controls for enrichment pause/resume
    enrichmentPaused: v.optional(v.boolean()),
    pausedBy: v.optional(v.id("users")),
    pausedAt: v.optional(v.number()),

    // Enrichment checkpoint tracking (for pipeline-blocking error recovery)
    enrichmentCheckpoint: v.optional(
      v.object({
        // Last successfully processed lead index
        lastProcessedIndex: v.number(),
        // Total leads at time of checkpoint
        totalLeads: v.number(),
        // Leads successfully enriched before error
        enrichedCount: v.number(),
        // Leads with no contacts found
        noContactsCount: v.number(),
        // Leads that failed
        failedCount: v.number(),
        // Error that caused checkpoint
        errorCode: v.optional(v.string()),
        errorMessage: v.optional(v.string()),
        // Timestamp of checkpoint
        checkpointedAt: v.number(),
        // Whether this checkpoint can be resumed
        resumable: v.boolean(),
      }),
    ),

    // Discovery diagnostics & dedup metrics
    initialSearchRadius: v.optional(v.number()), // In meters
    finalSearchRadius: v.optional(v.number()),   // In meters
    expansionIterations: v.optional(v.number()),
    duplicatesFilteredPlaceName: v.optional(v.number()),
    duplicatesFilteredEmail: v.optional(v.number()),
    duplicatesFilteredAddress: v.optional(v.number()),
    duplicatesFilteredPlaceId: v.optional(v.number()),
    discoveryMetadata: v.optional(
      v.object({
        requested: v.number(),
        delivered: v.number(),
        shortfall: v.number(),
        expanded: v.boolean(),
        originalAreaLeads: v.number(),
        expansionAreaLeads: v.number(),
        expansionMessage: v.string(),
      }),
    ),

    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_status", ["status"])
    .index("by_created", ["createdAt"])
    .index("by_research_tier", ["researchTier"])
    .index("by_research_stage", ["researchStage"])
    // Compound indexes for search queries
    .index("by_user_status", ["userId", "status"])
    .index("by_user_status_created", ["userId", "status", "createdAt"]),

  "place_suppressions": defineTable({
    userId: v.string(),
    placeId: v.string(),
    status: v.union(
      v.literal("skipped"),
      v.literal("no_email"),
      v.literal("converted"),
    ),
    firstSeenAt: v.number(),
    lastTriedAt: v.optional(v.number()),
    reason: v.optional(v.string()),
  }).index("by_user_place", ["userId", "placeId"]),

  "place_leads": defineTable({
    userId: v.string(),
    placeId: v.string(),
    email: v.string(),
    domain: v.optional(v.string()),
    source: v.literal("google_places"),
    meta: v.any(),
    createdAt: v.number(),
  })
    .index("by_user_place", ["userId", "placeId"])
    .index("by_user_email", ["userId", "email"]),

  // CSV Imports - Track uploaded CSV files and import results
  csvImports: defineTable({
    userId: v.id("users"),
    searchId: v.id("searches"),

    // File metadata
    fileName: v.string(),
    fileSize: v.number(), // in bytes

    // Import statistics
    totalRows: v.number(),
    validRows: v.number(),
    invalidRows: v.number(),
    skippedRows: v.number(), // Rows with missing required data

    // Cost breakdown
    estimatedCost: v.number(),
    actualCost: v.optional(v.number()), // After processing
    leadsWithEmail: v.number(), // 1 credit each (skip enrichment)
    leadsNeedingEnrichment: v.number(), // 2 credits each

    // Processing status
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("partial_success"),
    ),

    // Error tracking
    errorReport: v.optional(
      v.array(
        v.object({
          rowNumber: v.number(),
          companyName: v.optional(v.string()),
          errors: v.array(v.string()),
          warnings: v.optional(v.array(v.string())),
          rawData: v.optional(v.any()),
        }),
      ),
    ),

    // Column mapping used (csvColumn -> leadField)
    columnMapping: v.optional(v.record(v.string(), v.string())),

    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_search", ["searchId"])
    .index("by_status", ["status"])
    .index("by_user_status", ["userId", "status"])
    .index("by_created", ["createdAt"]),

  // Leads - Individual business leads with enrichment data
  leads: defineTable({
    searchId: v.id("searches"),
    userId: v.id("users"),

    // Basic business info from Google Maps
    businessName: v.string(),
    address: v.string(),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
    rating: v.optional(v.number()),
    reviewCount: v.optional(v.number()),
    category: v.optional(v.string()),
    placeId: v.string(),

    // Data source tracking
    dataSource: v.optional(
      v.union(
        v.literal("google_maps"),
        v.literal("csv_upload"),
        v.literal("manual")
      )
    ),

    // Location data
    location: v.object({
      lat: v.number(),
      lng: v.number(),
      formattedAddress: v.string(),
      city: v.optional(v.string()),
      state: v.optional(v.string()),
      country: v.optional(v.string()),
      postalCode: v.optional(v.string()),
    }),

    // Enrichment status
    enrichmentStatus: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("completed_fallback"),
      v.literal("no_contacts_found"), // API succeeded but no discoverable contacts
      v.literal("failed"),
    ),

    // Enrichment provider used
    enrichmentProvider: v.optional(
      v.union(
        v.literal("findymail"),
        v.literal("csv_import") // CSV imports with existing emails
      )
    ),

    // Contact information from enrichment provider
    contactInfo: v.optional(
      v.object({
        emails: v.array(
          v.object({
            email: v.string(),
            type: v.string(),
            confidence: v.number(),
          }),
        ),
        contacts: v.array(
          v.object({
            name: v.string(),
            title: v.optional(v.string()),
            email: v.optional(v.string()),
            linkedin: v.optional(v.string()),
            confidence: v.number(),
          }),
        ),
        socialProfiles: v.optional(
          v.object({
            linkedin: v.optional(v.string()),
            twitter: v.optional(v.string()),
            facebook: v.optional(v.string()),
          }),
        ),
        // Fallback system tracking
        fallbackUsed: v.optional(v.boolean()),
        fallbackReason: v.optional(v.string()),
      }),
    ),

    // Raw enrichment data from enrichment provider API
    enrichmentData: v.optional(v.any()), // Flexible storage for API response data

    // AI Analysis from LangGraph
    aiAnalysis: v.optional(
      v.object({
        relevanceScore: v.number(),
        painPoints: v.array(v.string()),
        valueMatches: v.array(v.string()),
        recommendations: v.optional(v.array(v.string())),
        leadAnalysis: v.optional(v.any()), // Full analysis object from LangGraph
        processingTime: v.optional(v.number()),
        confidence: v.optional(v.number()),
        // Research tier tracking ("basic" = Tavily, "pro" = Sonar Pro, "deep" = Deep Research)
        researchTier: v.optional(v.string()),
        // Structured company data extracted from research
        companyData: v.optional(
          v.object({
            annual_revenue: v.optional(
              v.object({
                amount: v.string(),
                year: v.string(),
                source: v.string(),
              })
            ),
            employee_count: v.optional(
              v.object({
                count: v.string(),
                as_of: v.string(),
                source: v.string(),
              })
            ),
            leadership_names: v.optional(
              v.array(
                v.object({
                  name: v.string(),
                  title: v.string(),
                  source: v.string(),
                })
              )
            ),
            recent_news: v.optional(
              v.array(
                v.object({
                  event: v.string(),
                  date: v.string(),
                  source: v.string(),
                })
              )
            ),
            funding_details: v.optional(
              v.object({
                total_raised: v.string(),
                latest_round: v.string(),
                investors: v.array(v.string()),
                source: v.string(),
              })
            ),
          })
        ),
        // Legacy fields for backward compatibility
        fitAssessment: v.optional(v.string()),
        recommendedApproach: v.optional(v.string()),
      }),
    ),

    // Primary email content from LangGraph
    emailContent: v.optional(
      v.object({
        subject: v.string(),
        body: v.string(),
        personalizationNotes: v.array(v.string()),
        estimatedEffectiveness: v.number(),
      }),
    ),

    // Follow-up email sequence from LangGraph
    followUpEmails: v.optional(
      v.array(
        v.object({
          subject: v.string(),
          body: v.string(),
          delay_days: v.optional(v.number()),
        }),
      ),
    ),

    // Enrichment retry tracking (circuit breaker support)
    enrichmentAttempts: v.optional(v.number()),
    enrichmentRateLimitRetries: v.optional(v.number()), // Tracks rate-limit-specific retries
    lastEnrichmentAttempt: v.optional(v.number()),
    enrichmentError: v.optional(v.string()),

    // Enrichment timing (for stuck detection and monitoring)
    enrichmentStartedAt: v.optional(v.number()),    // When enrichment began
    enrichmentCompletedAt: v.optional(v.number()),  // When enrichment finished

    // Analysis retry tracking
    analysisAttempts: v.optional(v.number()),
    lastAnalysisAttempt: v.optional(v.number()),
    analysisError: v.optional(v.string()),

    // Batch processing retry tracking (for failed lead retry system)
    analysisRetryCount: v.optional(v.number()),
    lastRetryAttempt: v.optional(v.number()),

    // Async analysis tracking (for scalable webhook-based processing)
    analysisStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("scheduled"),
        v.literal("processing"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("timeout"),
        v.literal("skipped"), // Leads with no contacts found - nothing to analyze
      ),
    ),
    analysisScheduledAt: v.optional(v.number()),
    analysisStartedAt: v.optional(v.number()),
    analysisCompletedAt: v.optional(v.number()),
    analysisRequestId: v.optional(v.string()), // LangGraph request ID for correlation

    // Generated content
    generatedEmails: v.optional(v.array(v.id("emailSequences"))),

    // Lead management
    status: v.union(
      v.literal("new"),
      v.literal("qualified"),
      v.literal("contacted"),
      v.literal("nurturing"),
      v.literal("converted"),
      v.literal("unqualified"),
    ),
    tags: v.array(v.string()),
    notes: v.optional(v.string()),

    // Deep research tracking
    deepResearchUsed: v.optional(v.boolean()),
    deepResearchReason: v.optional(v.string()),
    deepResearchTimestamp: v.optional(v.number()),
    deepResearchDataPoints: v.optional(v.array(v.string())),
    deepResearchCreditsCharged: v.optional(v.number()),
    deepResearchProvider: v.optional(
      v.union(
        v.literal("tavily"),
        v.literal("perplexity"),
      ),
    ),

    // Lead quality tier classification (based on research data availability)
    leadTier: v.optional(v.union(v.literal("A"), v.literal("B"))),
    leadTierReason: v.optional(v.string()),

    // Denormalized fields for efficient deduplication lookups (O(1) vs O(n))
    primaryEmail: v.optional(v.string()), // Extracted from contactInfo.emails[0], lowercase
    normalizedAddress: v.optional(v.string()), // normalizeAddress(address) for consistent matching

    // Enrichment queue management (OCC-safe: each lead tracks its own queue position)
    enrichmentQueuedAt: v.optional(v.number()),        // When this lead was queued for enrichment
    enrichmentSearchQueuedAt: v.optional(v.number()), // Denormalized: search.createdAt for FIFO ordering
    enrichmentApiKeyHash: v.optional(v.string()),     // For tenant isolation (API key partitioning)

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_search", ["searchId"])
    .index("by_user", ["userId"])
    .index("by_status", ["status"])
    .index("by_place_id", ["placeId"])
    .index("by_lead_tier", ["leadTier"])
    .index("by_user_place", ["userId", "placeId"]) // User-level deduplication (across all searches)
    .index("by_search_place", ["searchId", "placeId"]) // Per-search deduplication (for spatial tiling)
    .index("by_user_address", ["userId", "address"]) // User-level address deduplication
    .index("by_enrichment_status", ["enrichmentStatus"])
    .index("by_enrichment_status_time", ["enrichmentStatus", "enrichmentStartedAt"]) // For stuck detection
    .index("by_analysis_status", ["analysisStatus"])
    .index("by_analysis_scheduled", ["analysisScheduledAt"])
    .index("by_search_analysis_status", ["searchId", "analysisStatus"])
    .index("by_search_enrichment", ["searchId", "enrichmentStatus"])
    .index("by_user_primary_email", ["userId", "primaryEmail"]) // O(1) email deduplication
    .index("by_user_normalized_address", ["userId", "normalizedAddress"]) // O(1) address deduplication
    .index("by_created", ["createdAt"]) // Time-range queries for admin metrics
    // OCC-safe enrichment queue index: tenant → status → oldest search first → oldest lead first
    .index("by_enrichment_queue", ["enrichmentApiKeyHash", "enrichmentStatus", "enrichmentSearchQueuedAt", "enrichmentQueuedAt"]),

  // Accepted contacts per company lead (multi-contact pipeline)
  leadContacts: defineTable({
    leadId: v.id("leads"),
    searchId: v.id("searches"),
    userId: v.id("users"),

    // Contact identity
    name: v.string(),
    title: v.optional(v.string()),
    email: v.string(),
    normalizedEmail: v.string(),
    linkedin: v.optional(v.string()),
    confidence: v.number(),

    // Provider provenance
    source: v.union(v.literal("findymail"), v.literal("csv_import"), v.literal("manual")),
    providerContactId: v.optional(v.string()),
    rawProviderData: v.optional(v.any()),

    // Request / acceptance context
    requestedRoles: v.array(v.string()),
    matchedRole: v.optional(v.string()),
    titleMatchScore: v.optional(v.number()),
    titleMatchReason: v.optional(v.string()),
    emailVerified: v.boolean(),
    domainMatchVerified: v.boolean(),

    // Lifecycle
    status: v.union(
      v.literal("candidate"),
      v.literal("accepted"),
      v.literal("rejected"),
    ),
    rejectionReason: v.optional(
      v.union(
        v.literal("title_mismatch"),
        v.literal("domain_mismatch"),
        v.literal("email_unverified"),
        v.literal("duplicate_email"),
        v.literal("missing_email"),
      ),
    ),

    // Shared company research reference
    companyResearchId: v.optional(v.id("companyResearch")),

    // AI analysis (per contact)
    analysisStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("scheduled"),
        v.literal("processing"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("timeout"),
        v.literal("skipped"),
      ),
    ),
    analysisScheduledAt: v.optional(v.number()),
    analysisStartedAt: v.optional(v.number()),
    analysisCompletedAt: v.optional(v.number()),
    analysisRequestId: v.optional(v.string()),
    analysisAttempts: v.optional(v.number()),
    analysisError: v.optional(v.string()),

    aiAnalysis: v.optional(
      v.object({
        relevanceScore: v.number(),
        painPoints: v.array(v.string()),
        valueMatches: v.array(v.string()),
        recommendations: v.optional(v.array(v.string())),
        leadAnalysis: v.optional(v.any()),
        processingTime: v.optional(v.number()),
        confidence: v.optional(v.number()),
        researchTier: v.optional(v.string()),
        companyData: v.optional(v.any()),
        fitAssessment: v.optional(v.string()),
        recommendedApproach: v.optional(v.string()),
      }),
    ),

    emailContent: v.optional(
      v.object({
        subject: v.string(),
        body: v.string(),
        personalizationNotes: v.array(v.string()),
        estimatedEffectiveness: v.number(),
      }),
    ),

    followUpEmails: v.optional(
      v.array(
        v.object({
          subject: v.string(),
          body: v.string(),
          delay_days: v.optional(v.number()),
        }),
      ),
    ),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_lead", ["leadId"])
    .index("by_lead_status", ["leadId", "status"])
    .index("by_search_status", ["searchId", "status"])
    .index("by_search_email", ["searchId", "normalizedEmail"])
    .index("by_search_analysis", ["searchId", "analysisStatus"])
    .index("by_user", ["userId"]),

  // Company-level research cache (reused across contacts for same domain)
  companyResearch: defineTable({
    searchId: v.id("searches"),
    userId: v.id("users"),
    leadId: v.optional(v.id("leads")),
    domain: v.string(),

    researchPayload: v.any(),
    confidence: v.optional(v.number()),
    citations: v.optional(v.array(v.string())),
    provider: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("completed"),
      v.literal("failed"),
    ),

    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.optional(v.number()),
  })
    .index("by_search_domain", ["searchId", "domain"])
    .index("by_lead", ["leadId"]),

  // Email Sequences - AI-generated personalized emails
  emailSequences: defineTable({
    leadId: v.id("leads"),
    userId: v.id("users"),
    requestId: v.string(),

    // Email content
    subject: v.string(),
    body: v.string(),
    tone: v.string(),
    personalizationNotes: v.array(v.string()),

    // Follow-up sequence
    sequenceType: v.union(v.literal("primary"), v.literal("follow_up")),
    sequenceOrder: v.number(),

    // AI metadata
    agentResults: v.array(
      v.object({
        agentName: v.string(),
        role: v.string(),
        output: v.string(),
        confidenceScore: v.number(),
        executionTime: v.number(),
      }),
    ),

    // Quality metrics
    estimatedEffectiveness: v.number(),
    recommendations: v.array(v.string()),
    processingTime: v.number(),

    // Status
    status: v.union(
      v.literal("generated"),
      v.literal("reviewed"),
      v.literal("sent"),
      v.literal("responded"),
    ),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_lead", ["leadId"])
    .index("by_user", ["userId"])
    .index("by_request_id", ["requestId"])
    .index("by_sequence", ["sequenceType", "sequenceOrder"]),

  // Billing - Enhanced subscription and payment tracking
  billing: defineTable({
    userId: v.id("users"),
    // FastSpring integration fields
    fastspringAccountId: v.optional(v.string()),
    fastspringSubscriptionId: v.optional(v.string()),
    fastspringProductPath: v.optional(v.string()),
    fastspringOrderId: v.optional(v.string()),

    // Enhanced plan details
    plan: v.union(
      v.literal("free"),
      v.literal("pro"),
      v.literal("starter"),
      v.literal("professional"),
      v.literal("business"),
      v.literal("enterprise"),
    ),
    billingCycle: v.union(v.literal("monthly"), v.literal("yearly")),
    amount: v.number(),
    currency: v.string(),

    // Trial information
    trialStart: v.optional(v.number()),
    trialEnd: v.optional(v.number()),
    isTrialing: v.boolean(),

    // Enhanced status
    status: v.union(
      v.literal("active"),
      v.literal("trialing"),
      v.literal("cancelled"),
      v.literal("past_due"),
      v.literal("unpaid"),
      v.literal("incomplete"),
      v.literal("incomplete_expired"),
      v.literal("paused"),
    ),

    // Dates
    currentPeriodStart: v.number(),
    currentPeriodEnd: v.number(),
    cancelAtPeriodEnd: v.boolean(),
    cancelAt: v.optional(v.number()),
    canceledAt: v.optional(v.number()),

    // Usage limits based on plan
    planLimits: v.object({
      monthlySearches: v.number(),
      maxLeadsPerSearch: v.number(),
      monthlyEnrichments: v.number(),
      monthlyExports: v.number(),
      emailGeneration: v.boolean(),
      bulkOperations: v.boolean(),
      apiAccess: v.boolean(),
      requiresOwnApiKeys: v.boolean(),
    }),

    // Billing metadata
    lastInvoiceDate: v.optional(v.number()),
    nextInvoiceDate: v.optional(v.number()),
    upcomingInvoiceTotal: v.optional(v.number()),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_fastspring_account", ["fastspringAccountId"])
    .index("by_fastspring_subscription", ["fastspringSubscriptionId"])
    .index("by_fastspring_product", ["fastspringProductPath"])
    .index("by_plan", ["plan"])
    .index("by_status", ["status"])
    .index("by_trial", ["isTrialing"])
    .index("by_period_end", ["currentPeriodEnd"])
    // Compound indexes for billing webhooks optimization
    .index("by_fastspring_account_status", ["fastspringAccountId", "status"])
    .index("by_status_created", ["status", "createdAt"])
    .index("by_plan_status", ["plan", "status"]),

  // Credit Transactions - Credit purchases and usage
  creditTransactions: defineTable({
    userId: v.id("users"),
    type: v.union(
      v.literal("purchase"),
      v.literal("usage"),
      v.literal("refund"),
      v.literal("bonus"),
      v.literal("rollback"),
    ),
    amount: v.number(),
    description: v.string(),
    relatedEntity: v.optional(
      v.object({
        type: v.string(),
        id: v.string(),
      }),
    ),
    // FastSpring order reference for purchases
    fastspringOrderId: v.optional(v.string()),
    fastspringOrderReference: v.optional(v.string()),
    parentTransactionId: v.optional(v.id("creditTransactions")),
    balanceAfter: v.number(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_type", ["type"])
    .index("by_created", ["createdAt"])
    .index("by_parent", ["parentTransactionId"])
    // Compound indexes for credit transaction queries
    .index("by_user_type", ["userId", "type"])
    .index("by_user_type_created", ["userId", "type", "createdAt"])
    .index("by_type_created", ["type", "createdAt"]),

  // Credit Reservations - Two-phase commit for credit operations
  creditReservations: defineTable({
    userId: v.id("users"),
    amount: v.number(),
    operationType: v.string(),
    operationId: v.string(),
    description: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("committed"),
      v.literal("rolled_back"),
    ),
    actualAmount: v.optional(v.number()),
    expiresAt: v.number(),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_status", ["status"])
    .index("by_operation", ["operationType", "operationId"])
    .index("by_expires", ["expiresAt"]),

  // LangGraph Requests - Track AI processing requests
  langgraphRequests: defineTable({
    userId: v.id("users"),
    leadId: v.optional(v.id("leads")),
    requestId: v.string(),

    type: v.union(
      v.literal("email_generation"),
      v.literal("lead_analysis"),
      v.literal("bulk_analysis"),
    ),

    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
    ),

    // Request data
    inputData: v.any(),
    outputData: v.optional(v.any()),
    error: v.optional(v.string()),

    // Metrics
    processingTime: v.optional(v.number()),
    creditsUsed: v.number(),

    // Timestamps
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_request_id", ["requestId"])
    .index("by_status", ["status"])
    .index("by_lead", ["leadId"]),

  // Admin Metrics - Aggregated data for admin dashboard
  adminMetrics: defineTable({
    date: v.string(), // YYYY-MM-DD format
    metrics: v.object({
      // User metrics
      totalUsers: v.number(),
      newUsers: v.number(),
      activeUsers: v.number(),

      // Plan distribution
      freeUsers: v.number(),
      proUsers: v.number(),
      enterpriseUsers: v.number(),

      // Usage metrics
      totalSearches: v.number(),
      totalLeads: v.number(),
      totalEmails: v.number(),
      totalCreditsUsed: v.number(),

      // Revenue metrics
      totalRevenue: v.number(),
      newRevenue: v.number(),

      // Quality metrics
      avgRelevanceScore: v.number(),
      avgProcessingTime: v.number(),
      errorRate: v.number(),
    }),
    createdAt: v.number(),
  }).index("by_date", ["date"]),

  // System Configuration - Admin configurable settings
  adminSettings: defineTable({
    maintenanceMode: v.boolean(),
    systemNotifications: v.boolean(),
    debugMode: v.boolean(),
    rateLimitEnabled: v.boolean(),
    registrationEnabled: v.boolean(),
    maxDailySearches: v.number(),
    systemMessage: v.optional(v.string()),
    updatedAt: v.number(),
    updatedBy: v.id("users"),
  }),

  systemConfiguration: defineTable({
    creditCosts: v.object({
      LEAD_DISCOVERY: v.number(),
      EMAIL_ENRICHMENT: v.number(),
      AI_ANALYSIS: v.number(),
      EMAIL_GENERATION: v.number(),
      BULK_ANALYSIS: v.number(),
    }),
    creditPacks: v.optional(
      v.array(
        v.object({
          id: v.string(),
          credits: v.number(),
          priceCents: v.number(),
          bonus: v.optional(v.number()),
          active: v.boolean(),
          fastspringProductPath: v.optional(v.string()),
        }),
      ),
    ),
    planLimits: v.object({
      free: v.object({
        monthlyCredits: v.number(),
        maxSearches: v.number(),
        maxLeadsPerSearch: v.number(),
        emailGeneration: v.boolean(),
        bulkOperations: v.boolean(),
        apiAccess: v.boolean(),
      }),
      pro: v.object({
        monthlyCredits: v.number(),
        maxSearches: v.number(),
        maxLeadsPerSearch: v.number(),
        emailGeneration: v.boolean(),
        bulkOperations: v.boolean(),
        apiAccess: v.boolean(),
      }),
      enterprise: v.object({
        monthlyCredits: v.number(),
        maxSearches: v.number(),
        maxLeadsPerSearch: v.number(),
        emailGeneration: v.boolean(),
        bulkOperations: v.boolean(),
        apiAccess: v.boolean(),
      }),
    }),
    orchestrationSettings: v.optional(
      v.object({
        leadGenerationEnabled: v.boolean(), // Emergency stop flag
        maintenanceMode: v.boolean(),
        maxConcurrentSearches: v.number(),
        pauseReason: v.optional(v.string()),
        pausedAt: v.optional(v.number()),
        pausedBy: v.optional(v.id("users")),
        langGraphHealth: v.optional(
          v.object({
            status: v.union(
              v.literal("healthy"),
              v.literal("degraded"),
              v.literal("unavailable"),
              v.literal("unknown"),
            ),
            lastCheckedAt: v.number(),
            lastSuccessAt: v.number(),
            consecutiveFailures: v.number(),
            lastError: v.union(v.string(), v.null()),
            services: v.union(
              v.object({
                fastapi: v.string(),
                langgraph: v.string(),
                openai: v.string(),
                convex: v.string(),
              }),
              v.object({
                fastapi: v.string(),
                langgraph: v.string(),
                openrouter: v.string(),
                convex: v.string(),
              }),
              v.null(),
            ),
            performance: v.union(
              v.object({
                activeTasksCount: v.number(),
                queueSize: v.number(),
                memoryUsageMb: v.number(),
                memoryPercent: v.number(),
              }),
              v.null(),
            ),
          }),
        ),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    updatedBy: v.optional(v.id("users")), // Optional for system-automated creation
  }),

  // System Logs - Track administrative actions
  systemLogs: defineTable({
    type: v.string(),
    action: v.string(),
    userId: v.id("users"),
    data: v.any(),
    timestamp: v.number(),
  })
    .index("by_type", ["type"])
    .index("by_user", ["userId"])
    .index("by_timestamp", ["timestamp"]),

  // Notifications - User notification records
  notifications: defineTable({
    userId: v.id("users"),
    type: v.union(
      v.literal("search_completed"),
      v.literal("credits_low"),
      v.literal("plan_upgraded"),
      v.literal("plan_updated"),
      v.literal("credit_alert"),
      v.literal("system_alert"),
      v.literal("email_sent"),
    ),
    title: v.string(),
    message: v.string(),
    data: v.optional(v.any()),
    read: v.boolean(),
    readAt: v.optional(v.number()),
    sent: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_read", ["userId", "read"]),

  // Retry tracking for failed operations
  retryRecords: defineTable({
    operationType: v.union(
      v.literal("google_maps_search"),
      v.literal("findymail_enrichment"),
      v.literal("langgraph_analysis"),
      v.literal("langgraph_email_generation"),
      v.literal("webhook_call"),
      v.literal("search_orchestration"),
    ),
    relatedId: v.string(), // searchId, leadId, requestId, etc.
    error: v.string(),
    retryConfig: v.object({
      maxAttempts: v.number(),
      currentAttempt: v.number(),
      nextRetryAt: v.number(),
      strategy: v.union(
        v.literal("exponential"),
        v.literal("linear"),
        v.literal("fixed"),
      ),
      backoffMs: v.number(),
    }),
    metadata: v.optional(v.any()),
    status: v.union(
      v.literal("pending"),
      v.literal("executing"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_related_id", ["relatedId"])
    .index("by_operation_type", ["operationType"])
    .index("by_next_retry", ["retryConfig.nextRetryAt"]),

  // Rate limiting records
  rateLimitRecords: defineTable({
    userId: v.id("users"),
    operation: v.union(
      v.literal("searches"),
      v.literal("enrichment"),
      v.literal("ai_analysis"),
      v.literal("api_calls"),
    ),
    requestCount: v.number(),
    timestamp: v.number(),
    windowStart: v.number(),
    withinLimits: v.boolean(),
    usedBurst: v.boolean(),
  })
    .index("by_user_operation", ["userId", "operation"])
    .index("by_timestamp", ["timestamp"])
    .index("by_window", ["windowStart"]),

  // Rate limit violations
  rateLimitViolations: defineTable({
    userId: v.id("users"),
    operation: v.union(
      v.literal("searches"),
      v.literal("enrichment"),
      v.literal("ai_analysis"),
      v.literal("api_calls"),
    ),
    requestCount: v.number(),
    currentUsage: v.number(),
    limit: v.number(),
    burstUsage: v.number(),
    burstLimit: v.number(),
    timestamp: v.number(),
    userPlan: v.union(
      v.literal("starter"),
      v.literal("professional"),
      v.literal("business"),
      v.literal("enterprise"),
    ),
    isAdmin: v.boolean(),
  })
    .index("by_user", ["userId"])
    .index("by_timestamp", ["timestamp"])
    .index("by_operation", ["operation"]),

  // Adaptive rate limits
  adaptiveRateLimits: defineTable({
    userId: v.id("users"),
    limits: v.object({
      searches: v.number(),
      enrichment: v.number(),
      ai_analysis: v.number(),
      api_calls: v.number(),
    }),
    adjustmentFactor: v.number(),
    reason: v.string(),
    createdAt: v.number(),
    lastUpdated: v.number(),
    analysisWindow: v.object({
      start: v.number(),
      end: v.number(),
    }),
    metrics: v.object({
      totalRequests: v.number(),
      violationCount: v.number(),
      violationRate: v.number(),
    }),
  })
    .index("by_user", ["userId"])
    .index("by_last_updated", ["lastUpdated"]),

  // Batch processing plans
  batchPlans: defineTable({
    searchId: v.id("searches"),
    userId: v.id("users"),
    totalItems: v.number(),
    batchSize: v.number(),
    totalBatches: v.number(),
    estimatedTimePerBatch: v.number(),
    priorityScore: v.number(),
    systemLoad: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    createdBatches: v.number(),
    completedBatches: v.number(),
    failedBatches: v.number(),
    processingDelay: v.number(),
    maxConcurrentBatches: v.number(),
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_search", ["searchId"])
    .index("by_user", ["userId"])
    .index("by_status", ["status"])
    .index("by_priority", ["priorityScore"])
    .index("by_created", ["createdAt"]),

  // Individual search batches
  searchBatches: defineTable({
    batchPlanId: v.id("batchPlans"),
    searchId: v.id("searches"),
    userId: v.id("users"),
    batchNumber: v.number(),
    startIndex: v.number(),
    endIndex: v.number(),
    itemCount: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("retrying"),
    ),
    priorityScore: v.number(),
    estimatedProcessingTime: v.number(),
    attempts: v.number(),
    maxAttempts: v.number(),
    createdAt: v.number(),
    scheduledAt: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    result: v.optional(v.any()),
  })
    .index("by_batch_plan", ["batchPlanId"])
    .index("by_search", ["searchId"])
    .index("by_user", ["userId"])
    .index("by_status", ["status"])
    .index("by_priority", ["priorityScore"])
    .index("by_scheduled", ["scheduledAt"]),

  // Real-time status broadcasts
  statusBroadcasts: defineTable({
    userId: v.id("users"),
    entityType: v.string(), // Type of entity (search, lead, system, etc.)
    entityId: v.optional(v.string()), // ID of related entity
    type: v.string(),
    title: v.string(),
    message: v.string(),
    data: v.optional(v.any()),
    priority: v.union(
      v.literal("low"),
      v.literal("normal"),
      v.literal("high"),
      v.literal("urgent"),
      v.literal("critical"),
    ),
    category: v.string(), // Category for filtering (search_update, system_alert, etc.)
    tags: v.array(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("delivered"),
      v.literal("failed"),
      v.literal("expired"),
    ),
    delivered: v.boolean(),
    acknowledged: v.boolean(),
    requiresAck: v.boolean(),
    metadata: v.optional(v.any()), // Additional metadata
    createdAt: v.number(),
    expiresAt: v.number(),
    deliveredAt: v.optional(v.number()),
    acknowledgedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_entity", ["entityType", "entityId"])
    .index("by_status", ["status"])
    .index("by_priority", ["priority"])
    .index("by_category", ["category"])
    .index("by_expires", ["expiresAt"])
    .index("by_type", ["type"])
    .index("by_delivered", ["delivered"])
    .index("by_acknowledged", ["acknowledged"]),

  // Correlation tracking for enhanced logging
  correlationLogs: defineTable({
    correlationId: v.string(),
    operationType: v.string(),
    parentId: v.optional(v.string()),
    userId: v.id("users"),
    searchId: v.optional(v.id("searches")),
    leadId: v.optional(v.id("leads")),
    batchId: v.optional(v.string()),
    level: v.union(
      v.literal("debug"),
      v.literal("info"),
      v.literal("warn"),
      v.literal("error"),
    ),
    message: v.string(),
    data: v.optional(v.any()),
    error: v.optional(
      v.object({
        message: v.string(),
        stack: v.optional(v.string()),
        name: v.optional(v.string()),
      }),
    ),
    performance: v.optional(
      v.object({
        startTime: v.number(),
        endTime: v.optional(v.number()),
        duration: v.optional(v.number()),
      }),
    ),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_correlation_id", ["correlationId"])
    .index("by_operation_type", ["operationType"])
    .index("by_parent_id", ["parentId"])
    .index("by_user", ["userId"])
    .index("by_search", ["searchId"])
    .index("by_lead", ["leadId"])
    .index("by_level", ["level"])
    .index("by_created", ["createdAt"]),

  // FindyMail domain cache to prevent duplicate API calls within same search (legacy)
  findymailDomainCache: defineTable({
    domain: v.string(),
    searchId: v.id("searches"),
    enrichmentData: v.object({
      emails: v.array(
        v.object({
          email: v.string(),
          type: v.string(),
          confidence: v.number(),
        }),
      ),
      contacts: v.array(
        v.object({
          name: v.string(),
          title: v.optional(v.string()),
          email: v.optional(v.string()),
          linkedin: v.optional(v.string()),
          confidence: v.number(),
          domain: v.optional(v.string()),
        }),
      ),
      socialProfiles: v.optional(
        v.object({
          linkedin: v.optional(v.string()),
          twitter: v.optional(v.string()),
          facebook: v.optional(v.string()),
        }),
      ),
    }),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_domain_search", ["domain", "searchId"])
    .index("by_search", ["searchId"])
    .index("by_expires", ["expiresAt"]),

  // Enrichment cache for all providers (replaces findymailDomainCache)
  enrichmentCache: defineTable({
    provider: v.literal("findymail"),
    domain: v.string(),
    searchId: v.id("searches"),
    enrichmentData: v.any(), // Flexible storage for different provider response formats
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_provider_domain_search", ["provider", "domain", "searchId"])
    .index("by_search", ["searchId"])
    .index("by_expires", ["expiresAt"])
    .index("by_provider", ["provider"]),

  // System Control State - Emergency admin controls for lead generation
  systemControlState: defineTable({
    systemPaused: v.boolean(),
    leadGenerationDisabled: v.boolean(),
    maintenanceMode: v.boolean(),
    pausedAt: v.optional(v.number()),
    pausedBy: v.optional(v.id("users")),
    reason: v.optional(v.string()),
    resumedAt: v.optional(v.number()),
    resumedBy: v.optional(v.id("users")),
    resumeReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),

  // User API Keys - For Starter tier users who bring their own API keys
  userApiKeys: defineTable({
    userId: v.id("users"),
    provider: v.union(
      v.literal("openai"),
      v.literal("tavily"),
      v.literal("perplexity"),
      v.literal("google_places"),
      // Legacy enrichment providers still supported for backwards compatibility
      v.literal("google_maps"),
      v.literal("findymail"),
      v.literal("apify"),
      // Email sending platform
      v.literal("instantly"),
    ),
    keyName: v.string(), // User-friendly name for the key
    encryptedKey: v.string(), // Encrypted API key
    keyHash: v.string(), // Hash for quick lookup/validation

    // Validation status
    validated: v.boolean(),
    validatedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),

    // Usage tracking
    usageCount: v.number(),
    lastUsed: v.optional(v.number()),

    // Key metadata
    isActive: v.boolean(),
    expiresAt: v.optional(v.number()),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_provider", ["userId", "provider"])
    .index("by_hash", ["keyHash"])
    .index("by_provider", ["provider"])
    .index("by_active", ["isActive"])
    // Compound indexes for API key validation queries
    .index("by_user_provider_active", ["userId", "provider", "isActive"])
    .index("by_user_active_valid", ["userId", "isActive", "validated"]),

  // API Key Audit Log - Security audit trail for API key access
  apiKeyAuditLog: defineTable({
    userId: v.id("users"),
    keyId: v.id("userApiKeys"),
    action: v.union(
      v.literal("decrypted"),
      v.literal("validated"),
      v.literal("created"),
      v.literal("deleted"),
    ),
    purpose: v.string(), // e.g., "system_use", "enrichment", "validation"
    success: v.boolean(),
    errorMessage: v.optional(v.string()),
    timestamp: v.number(),
  })
    .index("by_key", ["keyId"])
    .index("by_user", ["userId"])
    .index("by_action", ["action"])
    .index("by_timestamp", ["timestamp"])
    .index("by_user_action", ["userId", "action"]),

  // Duplicate Metrics - Track prevented duplicates for analytics
  duplicateMetrics: defineTable({
    userId: v.id("users"),
    searchId: v.id("searches"),
    placeId: v.string(),
    duplicateType: v.union(
      v.literal("search_level"), // Duplicate within same search (spatial tiling)
      v.literal("user_level"),   // Duplicate across user's searches
      v.literal("place_name"),   // Duplicate place name within search
      v.literal("email"),        // Duplicate email across user's searches
      v.literal("address"),      // Duplicate address across user's searches
    ),
    preventedAt: v.number(),
    originalLeadId: v.optional(v.id("leads")), // Reference to original lead
    businessName: v.string(), // For reporting purposes
  })
    .index("by_user", ["userId"])
    .index("by_search", ["searchId"])
    .index("by_date", ["preventedAt"])
    .index("by_type", ["duplicateType"])
    .index("by_user_type", ["userId", "duplicateType"]),

  // Usage Tracking - Track user activity per billing period
  usageTracking: defineTable({
    userId: v.id("users"),
    billingPeriodStart: v.number(),
    billingPeriodEnd: v.number(),

    // Core usage metrics
    searchesUsed: v.number(),
    leadsEnriched: v.number(),
    emailsGenerated: v.number(),
    exportsCompleted: v.number(),
    apiCallsMade: v.number(),

    // Detailed breakdown
    usageByDate: v.optional(
      v.object({
        // Daily usage tracking as a map
        // Format: "YYYY-MM-DD": { searches: number, enrichments: number, ... }
      }),
    ),

    // Cost tracking
    creditsUsed: v.number(),
    costByService: v.optional(
      v.object({
        googleMaps: v.number(),
        findymail: v.number(),
        openai: v.number(),
        apify: v.number(),
      }),
    ),

    // Status
    isCurrentPeriod: v.boolean(),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_period", ["userId", "billingPeriodStart"])
    .index("by_current", ["isCurrentPeriod"])
    .index("by_period", ["billingPeriodStart"])
    // Critical compound indexes for query optimization
    .index("by_user_current", ["userId", "isCurrentPeriod"])
    .index("by_user_period_current", ["userId", "billingPeriodStart", "isCurrentPeriod"]),

  // Subscription Events - Track important subscription lifecycle events
  subscriptionEvents: defineTable({
    userId: v.id("users"),
    // FastSpring integration fields
    fastspringSubscriptionId: v.optional(v.string()),
    fastspringAccountId: v.optional(v.string()),
    fastspringOrderId: v.optional(v.string()),

    eventType: v.union(
      v.literal("subscription_created"),
      v.literal("subscription_updated"),
      v.literal("subscription_cancelled"),
      v.literal("subscription_reactivated"),
      v.literal("trial_started"),
      v.literal("trial_ended"),
      v.literal("payment_succeeded"),
      v.literal("payment_failed"),
      v.literal("invoice_created"),
      v.literal("plan_changed"),
      v.literal("usage_limit_exceeded"),
    ),

    // Event data
    oldPlan: v.optional(v.string()),
    newPlan: v.optional(v.string()),
    amount: v.optional(v.number()),
    currency: v.optional(v.string()),

    // Additional metadata
    metadata: v.optional(v.any()),
    fastspringEventId: v.optional(v.string()),

    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_subscription", ["fastspringSubscriptionId"])
    .index("by_event_type", ["eventType"])
    .index("by_created", ["createdAt"]),

  // Plan Configurations - Admin-configurable plan limits and pricing
  planConfigurations: defineTable({
    planId: v.string(), // starter, professional, business, enterprise
    planName: v.string(),

    // Pricing
    monthlyPrice: v.number(),
    yearlyPrice: v.number(),
    // FastSpring product paths
    fastspringProductPathMonthly: v.optional(v.string()),
    fastspringProductPathYearly: v.optional(v.string()),

    // Limits
    limits: v.object({
      monthlySearches: v.number(),
      maxLeadsPerSearch: v.number(),
      monthlyEnrichments: v.number(),
      monthlyExports: v.number(),
      emailGeneration: v.boolean(),
      bulkOperations: v.boolean(),
      apiAccess: v.boolean(),
      requiresOwnApiKeys: v.boolean(),
      supportLevel: v.string(),
    }),

    // Features
    features: v.array(v.string()),

    // Status
    isActive: v.boolean(),
    isVisible: v.boolean(), // Show in pricing page
    sortOrder: v.number(),

    createdAt: v.number(),
    updatedAt: v.number(),
    updatedBy: v.id("users"),
  })
    .index("by_plan_id", ["planId"])
    .index("by_active", ["isActive"])
    .index("by_visible", ["isVisible"])
    .index("by_sort_order", ["sortOrder"]),

  // Audit Logs - Comprehensive audit trail for BYOK and credit operations
  auditLogs: defineTable({
    userId: v.id("users"),
    eventType: v.string(), // credit_bypass, api_key_used, search_started, etc.
    operation: v.string(), // Operation name (e.g., "lead_search", "email_enrichment")

    // Credit information
    bypassedCredits: v.optional(v.boolean()),
    creditsSkipped: v.optional(v.number()),
    creditsCharged: v.optional(v.number()),

    // Provider information
    providers: v.optional(v.array(v.string())), // Which providers were used

    // Related entity
    relatedEntityType: v.optional(v.string()), // "search", "lead", "enrichment"
    relatedEntityId: v.optional(v.string()), // ID of related entity

    // Operation result
    success: v.optional(v.boolean()),
    errorMessage: v.optional(v.string()),

    // Additional metadata
    metadata: v.optional(v.any()), // Flexible metadata storage

    timestamp: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_event_type", ["eventType"])
    .index("by_timestamp", ["timestamp"])
    .index("by_user_and_event", ["userId", "eventType"])
    .index("by_user_and_timestamp", ["userId", "timestamp"]),

  // Instantly Integration - User settings for auto-push to Instantly.ai
  instantlySettings: defineTable({
    userId: v.id("users"),
    autoPushEnabled: v.boolean(),
    defaultSenderEmail: v.optional(v.string()),
    defaultSenderAccountId: v.optional(v.string()),
    cachedAccounts: v.optional(
      v.array(
        v.object({
          id: v.string(),
          email: v.string(),
          displayName: v.optional(v.string()),
          status: v.optional(v.string()),
        })
      )
    ),
    cachedAccountsAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // Instantly Campaigns - Track campaigns pushed to Instantly.ai
  instantlyCampaigns: defineTable({
    userId: v.id("users"),
    searchId: v.id("searches"),
    instantlyCampaignId: v.string(),
    instantlyCampaignName: v.string(),
    senderEmail: v.string(),
    leadsCount: v.number(),
    pushedAt: v.number(),
    autoPushed: v.boolean(),
  })
    .index("by_user", ["userId"])
    .index("by_search", ["searchId"])
    .index("by_user_search", ["userId", "searchId"]),

  // API Error Logs - Track external API errors for debugging and analytics
  // Retention: 7 days (cleaned up by cron job)
  apiErrorLogs: defineTable({
    userId: v.id("users"),
    searchId: v.optional(v.id("searches")),
    leadId: v.optional(v.id("leads")),

    // Error identification
    errorCode: v.string(), // e.g., "FINDYMAIL_CREDITS_EXHAUSTED"
    provider: v.string(), // e.g., "findymail", "google_places", "perplexity"
    category: v.string(), // e.g., "quota_exhausted", "authentication", "rate_limited"
    severity: v.string(), // "info", "warning", "error", "critical"

    // User-facing message
    userMessage: v.string(),
    technicalMessage: v.optional(v.string()),

    // Original error data
    originalStatus: v.optional(v.number()), // HTTP status code
    operationType: v.optional(v.string()), // What operation failed

    // Resolution tracking
    resolved: v.boolean(),
    resolvedAt: v.optional(v.number()),
    resolvedBy: v.optional(
      v.union(v.literal("retry"), v.literal("user"), v.literal("system"))
    ),

    // Tracing
    correlationId: v.optional(v.string()),

    createdAt: v.number(),
    expiresAt: v.number(), // For 7-day retention cleanup
  })
    .index("by_user", ["userId"])
    .index("by_provider", ["provider"])
    .index("by_category", ["category"])
    .index("by_error_code", ["errorCode"])
    .index("by_search", ["searchId"])
    .index("by_created", ["createdAt"])
    .index("by_unresolved", ["resolved", "createdAt"])
    .index("by_expires", ["expiresAt"])
    .index("by_user_provider", ["userId", "provider"])
    .index("by_user_category", ["userId", "category"]),

  // ============================================================================
  // STRIPE CUSTOM SUBSCRIPTIONS
  // ============================================================================

  // Stripe Customers - Maps users to Stripe customer objects
  stripeCustomers: defineTable({
    userId: v.id("users"),
    stripeCustomerId: v.string(),
    email: v.string(),
    defaultPaymentMethodId: v.optional(v.string()),
    defaultPaymentMethodType: v.optional(
      v.union(v.literal("card"), v.literal("us_bank_account"))
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_stripe_customer", ["stripeCustomerId"]),

  // Custom Subscriptions - Admin-created custom subscriptions per customer
  customSubscriptions: defineTable({
    // Customer link
    userId: v.id("users"),
    stripeCustomerId: v.string(),

    // Stripe subscription details
    stripeSubscriptionId: v.optional(v.string()), // Set after customer completes checkout
    stripePriceIdAch: v.string(), // ACH price (no convenience fee)
    stripePriceIdCard: v.string(), // Card price (includes 3% convenience fee)
    stripeProductId: v.string(), // Genni Custom Subscription product

    // Custom subscription configuration (set by admin)
    monthlyPriceCents: v.number(), // Base price in cents (e.g., 100000 = $1000)
    monthlyCredits: v.number(), // Credits included per month
    allowExtraCredits: v.boolean(), // Can customer buy additional credits?
    extraCreditPriceCents: v.optional(v.number()), // Price per extra credit pack
    extraCreditPackSize: v.optional(v.number()), // Credits per extra pack

    // Payment method tracking
    paymentMethodType: v.optional(
      v.union(v.literal("card"), v.literal("us_bank_account"))
    ),
    convenienceFeeCents: v.optional(v.number()), // Card convenience fee if applicable

    // Status
    status: v.union(
      v.literal("pending_checkout"), // Admin created, awaiting customer payment
      v.literal("active"),
      v.literal("past_due"),
      v.literal("cancelled"),
      v.literal("paused")
    ),
    // Checkout URLs (dual pricing - ACH vs Card with 3% fee)
    checkoutUrl: v.optional(v.string()), // Legacy: single checkout URL (deprecated)
    checkoutUrlAch: v.optional(v.string()), // ACH checkout URL (lower price)
    checkoutUrlCard: v.optional(v.string()), // Card checkout URL (includes 3% fee)
    checkoutSessionId: v.optional(v.string()), // Legacy: single session ID (deprecated)
    checkoutSessionIdAch: v.optional(v.string()), // ACH session ID
    checkoutSessionIdCard: v.optional(v.string()), // Card session ID
    checkoutExpiresAt: v.optional(v.number()),

    // Billing period
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    creditsAllocatedAt: v.optional(v.number()), // Last credit allocation

    // Admin notes
    adminNotes: v.optional(v.string()),
    createdBy: v.id("users"), // Admin who created

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_stripe_subscription", ["stripeSubscriptionId"])
    .index("by_stripe_customer", ["stripeCustomerId"])
    .index("by_checkout_session", ["checkoutSessionId"])
    .index("by_status", ["status"])
    .index("by_created_by", ["createdBy"]),

  // Subscription Credit Allocations - Monthly credit allocations (use-it-or-lose-it)
  subscriptionCreditAllocations: defineTable({
    userId: v.id("users"),
    subscriptionId: v.id("customSubscriptions"),

    // Period info
    periodStart: v.number(),
    periodEnd: v.number(),

    // Credits
    creditsAllocated: v.number(),
    creditsUsed: v.number(),
    creditsExpired: v.number(), // Set when period ends

    // Status
    status: v.union(
      v.literal("active"),
      v.literal("expired")
    ),

    expiredAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_subscription", ["subscriptionId"])
    .index("by_user_status", ["userId", "status"])
    .index("by_period_end", ["periodEnd"]),

  // Extra Credit Purchases - Self-service credit purchases by customers
  extraCreditPurchases: defineTable({
    userId: v.id("users"),
    subscriptionId: v.id("customSubscriptions"),

    // Stripe payment
    stripePaymentIntentId: v.optional(v.string()),
    stripeCheckoutSessionId: v.optional(v.string()),

    // Purchase details
    creditsPurchased: v.number(),
    basePriceCents: v.number(),
    convenienceFeeCents: v.number(), // 3% for cards, 0 for ACH
    totalPriceCents: v.number(),
    paymentMethodType: v.union(v.literal("card"), v.literal("us_bank_account")),

    // Status
    status: v.union(
      v.literal("pending"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("refunded")
    ),

    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_subscription", ["subscriptionId"])
    .index("by_payment_intent", ["stripePaymentIntentId"])
    .index("by_checkout_session", ["stripeCheckoutSessionId"])
    .index("by_status", ["status"]),

  // Processed Webhooks - Idempotency tracking to prevent duplicate event processing
  processedWebhooks: defineTable({
    eventId: v.string(), // Stripe event ID (e.g., evt_...)
    eventType: v.string(), // Event type (e.g., checkout.session.completed)
    processedAt: v.number(),
    // "processing" = claimed but not yet completed (prevents race conditions)
    result: v.union(
      v.literal("processing"),
      v.literal("success"),
      v.literal("skipped"),
      v.literal("failed")
    ),
    error: v.optional(v.string()),
  })
    .index("by_event_id", ["eventId"])
    .index("by_event_type", ["eventType"])
    .index("by_processed_at", ["processedAt"]),

  // Enrichment API Key Semaphores - Per-API-key concurrency limiting (5 concurrent per FindyMail key)
  // DEPRECATED: This table caused OCC failures due to single-document contention.
  // Kept for backward compatibility during migration. Use enrichmentApiKeySlots instead.
  enrichmentApiKeySemaphores: defineTable({
    apiKeyHash: v.string(),        // SHA256 hash of API key (system or user-provided)
    activeRequests: v.number(),     // Current number of active enrichment requests
    maxConcurrency: v.number(),     // Maximum concurrent requests (always 5 for FindyMail)
    waitingRequests: v.number(),    // Number of requests waiting for a slot
    lastUpdated: v.number(),        // Timestamp of last update
  })
    .index("by_key_hash", ["apiKeyHash"])
    .index("by_active", ["activeRequests"]),

  // Enrichment API Key Slots - Distributed slot-based concurrency limiting
  // Each API key has 5 slots (0-4). Actions claim individual slots to avoid OCC contention.
  // This approach eliminates hot-spot contention by distributing claims across 5 documents per key.
  enrichmentApiKeySlots: defineTable({
    apiKeyHash: v.string(),        // SHA256 hash of API key
    slotIndex: v.number(),          // Slot index 0-4 (5 slots per key)
    claimedBy: v.optional(v.string()), // Lead ID or unique request ID that claimed this slot
    claimedAt: v.optional(v.number()), // Timestamp when slot was claimed
    expiresAt: v.optional(v.number()), // Auto-expiration for stuck claims (e.g., 10 minutes)
  })
    .index("by_key_hash", ["apiKeyHash"])
    .index("by_key_and_slot", ["apiKeyHash", "slotIndex"])
    .index("by_expires", ["expiresAt"]),

  // Enrichment Slot Queue - Queue for leads waiting for an API key slot
  // When all 5 slots are in use, leads are queued here instead of failing
  // When a slot is released, the next queued lead is automatically triggered
  enrichmentSlotQueue: defineTable({
    apiKeyHash: v.string(),           // SHA256 hash of API key (for queue partitioning)
    leadId: v.id("leads"),            // Lead waiting to be enriched
    searchId: v.id("searches"),       // Associated search
    userId: v.id("users"),            // User who owns the lead
    userApiKey: v.string(),           // User's FindyMail API key (needed for re-triggering)
    correlationId: v.optional(v.string()), // Correlation ID for logging
    queuedAt: v.number(),             // When the lead was queued
    priority: v.number(),             // Priority (lower = higher priority, default 0)
    status: v.union(
      v.literal("pending"),           // Waiting for a slot
      v.literal("processing"),        // Slot acquired, being processed
      v.literal("completed"),         // Successfully processed
      v.literal("cancelled")          // Cancelled (search stopped, etc.)
    ),
    processedAt: v.optional(v.number()), // When processing started
  })
    .index("by_api_key_status", ["apiKeyHash", "status", "queuedAt"])
    .index("by_lead", ["leadId"])
    .index("by_search", ["searchId", "status"])
    .index("by_status_queued", ["status", "queuedAt"]),

  // Cron Locks - Mutex for cron job execution to prevent overlapping runs
  // Used by single-consumer crons like the enrichment queue processor
  // Prevents OCC failures from multiple concurrent cron executions
  cronLocks: defineTable({
    key: v.string(),            // Unique identifier for the cron job (e.g., "enrichment_queue_processor")
    acquiredAt: v.number(),     // When the lock was acquired
    expiresAt: v.number(),      // Auto-expiration for stuck locks (e.g., 30 seconds)
  })
    .index("by_key", ["key"])
    .index("by_expires", ["expiresAt"]),

  // Enrichment Batches - Tracks Workpool enrichment batches for progress and completion
  // Used by the Workpool onComplete handler to track when all leads are enriched
  enrichmentBatches: defineTable({
    batchId: v.string(),              // Unique batch identifier
    searchId: v.id("searches"),       // Associated search
    userId: v.id("users"),            // User who initiated the search
    totalLeads: v.number(),           // Total leads in this batch
    completedLeads: v.number(),       // Leads that have finished (success or fail)
    successfulLeads: v.number(),      // Leads that enriched successfully
    failedLeads: v.number(),          // Leads that failed enrichment
    workIds: v.array(v.string()),     // Workpool work IDs for cancellation
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed")
    ),
    startedAt: v.number(),            // When the batch started
    completedAt: v.optional(v.number()), // When the batch completed
  })
    .index("by_batch_id", ["batchId"])
    .index("by_search", ["searchId"])
    .index("by_status", ["status"]),

  // ============================================================================
  // FAILED OPERATIONS - Dead Letter Queue for Pipeline Recovery
  // ============================================================================
  // Tracks failed pipeline operations (completion handlers, phase transitions)
  // for automatic retry with exponential backoff
  failedOperations: defineTable({
    // Operation identification
    operationType: v.union(
      v.literal("enrichment_completion"),
      v.literal("analysis_trigger"),
      v.literal("batch_finalization"),
      v.literal("slot_release")
    ),

    // Reference IDs
    searchId: v.id("searches"),
    leadId: v.optional(v.id("leads")),

    // Error context
    error: v.string(),
    errorCode: v.optional(v.string()),
    context: v.optional(v.any()), // Serialized operation context (batchId, workId, etc.)

    // Retry tracking
    retryCount: v.number(),
    maxRetries: v.number(),
    lastAttemptAt: v.number(),
    nextRetryAt: v.optional(v.number()),

    // Status
    status: v.union(
      v.literal("pending"),   // Ready for retry
      v.literal("retrying"),  // Currently being retried
      v.literal("resolved"),  // Successfully recovered
      v.literal("exhausted")  // Max retries exceeded
    ),
    resolvedAt: v.optional(v.number()),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_search", ["searchId", "status"])
    .index("by_operation_type", ["operationType", "status"])
    .index("by_next_retry", ["status", "nextRetryAt"]),
});
