import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Users table - Authentication and basic user info
  users: defineTable({
    // Clerk integration fields
    clerkId: v.string(), // Clerk user ID for syncing
    email: v.string(),
    name: v.optional(v.string()),
    avatar: v.optional(v.string()),
    plan: v.union(v.literal("free"), v.literal("pro"), v.literal("enterprise")),
    credits: v.number(),
    role: v.union(v.literal("user"), v.literal("admin")),
    isActive: v.boolean(),
    // Stripe integration fields
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    preferences: v.optional(v.object({
      emailNotifications: v.boolean(),
      language: v.string(),
      timezone: v.string(),
    })),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_email", ["email"])
    .index("by_plan", ["plan"])
    .index("by_role", ["role"]),

  // Business Profiles - Company information for AI personalization
  businessProfiles: defineTable({
    userId: v.id("users"),
    companyName: v.string(),
    industry: v.string(),
    valueProposition: v.string(),
    services: v.array(v.string()),
    targetMarkets: v.array(v.string()),
    keyDifferentiators: v.array(v.string()),
    caseStudies: v.optional(v.array(v.object({
      title: v.string(),
      client: v.string(),
      results: v.string(),
      metrics: v.any(),
    }))),
    contactInfo: v.object({
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      website: v.optional(v.string()),
      linkedin: v.optional(v.string()),
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
      radius: v.number(),
      keywords: v.array(v.string()),
      industries: v.optional(v.array(v.string())),
      excludeTerms: v.optional(v.array(v.string())),
      minRating: v.optional(v.number()),
      maxResults: v.number(),
      filters: v.optional(v.object({
        minEmployees: v.optional(v.number()),
        maxEmployees: v.optional(v.number()),
      })),
    }),
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled")
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
      avgRelevanceScore: v.optional(v.number()),
    }),
    error: v.optional(v.string()),
    creditsUsed: v.number(),
    creditsReserved: v.optional(v.number()),
    reservationId: v.optional(v.id("creditReservations")),
    actualCosts: v.optional(v.object({
      discovery: v.number(),
      enrichment: v.number(),
      analysis: v.number(),
    })),
    creditsRefunded: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    lastOrchestrationAt: v.optional(v.number()),
    orchestrationLock: v.optional(v.string()),
    orchestrationLockExpiry: v.optional(v.number()),
    orchestrationAttempts: v.optional(v.number()),
    lastWarningAt: v.optional(v.number()),
    
    // Research progress tracking (for tiered business context research)
    researchStage: v.optional(v.union(
      v.literal("research_started"),
      v.literal("tier1_tavily"), 
      v.literal("tier2_exa"),
      v.literal("tier3_perplexity"),
      v.literal("research_completed"),
      v.literal("research_failed"),
      v.literal("research_error")
    )),
    researchTier: v.optional(v.union(
      v.literal("tavily"),
      v.literal("exa"), 
      v.literal("perplexity"),
      v.literal("error")
    )),
    researchConfidence: v.optional(v.number()),
    researchDataPoints: v.optional(v.number()),
    researchSourcesAnalyzed: v.optional(v.number()),
    researchEscalationReason: v.optional(v.string()),
    researchResults: v.optional(v.object({
      tier: v.string(),
      confidence: v.number(),
      dataPoints: v.number(),
      sourcesAnalyzed: v.number(),
      researchTime: v.number(),
      escalationReason: v.optional(v.string()),
      competitors: v.optional(v.array(v.any())),
      industryInsights: v.optional(v.string()),
      comprehensiveReport: v.optional(v.string()),
    })),
    researchCompletedAt: v.optional(v.number()),
    
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_status", ["status"])
    .index("by_created", ["createdAt"])
    .index("by_research_tier", ["researchTier"])
    .index("by_research_stage", ["researchStage"]),

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
      v.literal("failed")
    ),
    
    // Contact information from FindyMail
    contactInfo: v.optional(v.object({
      emails: v.array(v.object({
        email: v.string(),
        type: v.string(),
        confidence: v.number(),
      })),
      contacts: v.array(v.object({
        name: v.string(),
        title: v.optional(v.string()),
        email: v.optional(v.string()),
        linkedin: v.optional(v.string()),
        confidence: v.number(),
      })),
      socialProfiles: v.optional(v.object({
        linkedin: v.optional(v.string()),
        twitter: v.optional(v.string()),
        facebook: v.optional(v.string()),
      })),
      // Fallback system tracking
      fallbackUsed: v.optional(v.boolean()),
      fallbackReason: v.optional(v.string()),
    })),
    
    // Raw enrichment data from FindyMail API
    enrichmentData: v.optional(v.any()), // Flexible storage for API response data
    
    // AI Analysis from CrewAI
    aiAnalysis: v.optional(v.object({
      relevanceScore: v.number(),
      painPoints: v.array(v.string()),
      valueMatches: v.array(v.string()),
      fitAssessment: v.string(),
      recommendedApproach: v.string(),
      confidence: v.number(),
    })),
    
    // Analysis retry tracking
    analysisAttempts: v.optional(v.number()),
    lastAnalysisAttempt: v.optional(v.number()),
    analysisError: v.optional(v.string()),
    
    // Generated content
    generatedEmails: v.optional(v.array(v.id("emailSequences"))),
    
    // Lead management
    status: v.union(
      v.literal("new"),
      v.literal("qualified"),
      v.literal("contacted"),
      v.literal("nurturing"),
      v.literal("converted"),
      v.literal("unqualified")
    ),
    tags: v.array(v.string()),
    notes: v.optional(v.string()),
    
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_search", ["searchId"])
    .index("by_user", ["userId"])
    .index("by_status", ["status"])
    .index("by_place_id", ["placeId"])
    .index("by_enrichment_status", ["enrichmentStatus"]),

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
    agentResults: v.array(v.object({
      agentName: v.string(),
      role: v.string(),
      output: v.string(),
      confidenceScore: v.number(),
      executionTime: v.number(),
    })),
    
    // Quality metrics
    estimatedEffectiveness: v.number(),
    recommendations: v.array(v.string()),
    processingTime: v.number(),
    
    // Status
    status: v.union(
      v.literal("generated"),
      v.literal("reviewed"),
      v.literal("sent"),
      v.literal("responded")
    ),
    
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_lead", ["leadId"])
    .index("by_user", ["userId"])
    .index("by_request_id", ["requestId"])
    .index("by_sequence", ["sequenceType", "sequenceOrder"]),

  // Billing - Subscription and payment tracking
  billing: defineTable({
    userId: v.id("users"),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    
    // Plan details
    plan: v.union(v.literal("free"), v.literal("pro"), v.literal("enterprise")),
    billingCycle: v.union(v.literal("monthly"), v.literal("yearly")),
    amount: v.number(),
    currency: v.string(),
    
    // Status
    status: v.union(
      v.literal("active"),
      v.literal("cancelled"),
      v.literal("past_due"),
      v.literal("unpaid")
    ),
    
    // Dates
    currentPeriodStart: v.number(),
    currentPeriodEnd: v.number(),
    cancelAtPeriodEnd: v.boolean(),
    
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_stripe_customer", ["stripeCustomerId"])
    .index("by_stripe_subscription", ["stripeSubscriptionId"])
    .index("by_status", ["status"]),

  // Credit Transactions - Credit purchases and usage
  creditTransactions: defineTable({
    userId: v.id("users"),
    type: v.union(
      v.literal("purchase"),
      v.literal("usage"),
      v.literal("refund"),
      v.literal("bonus"),
      v.literal("rollback")
    ),
    amount: v.number(),
    description: v.string(),
    relatedEntity: v.optional(v.object({
      type: v.string(),
      id: v.string(),
    })),
    stripePaymentId: v.optional(v.string()),
    parentTransactionId: v.optional(v.id("creditTransactions")),
    balanceAfter: v.number(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_type", ["type"])
    .index("by_created", ["createdAt"])
    .index("by_parent", ["parentTransactionId"]),

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
      v.literal("rolled_back")
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
      v.literal("bulk_analysis")
    ),
    
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed")
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

  // Notifications - System notifications and emails
  notifications: defineTable({
    userId: v.id("users"),
    type: v.union(
      v.literal("search_completed"),
      v.literal("credits_low"),
      v.literal("plan_upgraded"),
      v.literal("plan_updated"),
      v.literal("credit_alert"),
      v.literal("system_alert"),
      v.literal("email_sent")
    ),
    title: v.string(),
    message: v.string(),
    data: v.optional(v.any()),
    
    // Status
    read: v.boolean(),
    sent: v.boolean(),
    
    // Email details (if applicable)
    emailSent: v.optional(v.object({
      to: v.string(),
      subject: v.string(),
      sentAt: v.number(),
      provider: v.string(),
    })),
    
    createdAt: v.number(),
    readAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_type", ["type"])
    .index("by_read", ["read"])
    .index("by_created", ["createdAt"]),

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
  })
    .index("by_date", ["date"]),

  // API Keys - For external service integrations
  apiKeys: defineTable({
    userId: v.id("users"), // Associate with a user
    name: v.string(),
    service: v.string(),
    keyHash: v.string(), // Hashed version for security
    isActive: v.boolean(),
    lastUsed: v.optional(v.number()),
    usageCount: v.number(),
    permissions: v.optional(v.array(v.string())), // Array of permissions
    rateLimit: v.optional(v.object({
      dailyLimit: v.number(),
      monthlyLimit: v.optional(v.number()),
    })),
    dailyUsage: v.optional(v.any()), // Record for tracking daily usage
    createdAt: v.number(),
    expiresAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_service", ["service"])
    .index("by_active", ["isActive"]),

  // System Configuration - Admin configurable settings
  systemConfiguration: defineTable({
    creditCosts: v.object({
      LEAD_DISCOVERY: v.number(),
      EMAIL_ENRICHMENT: v.number(),
      AI_ANALYSIS: v.number(),
      EMAIL_GENERATION: v.number(),
      BULK_ANALYSIS: v.number(),
    }),
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
    createdAt: v.number(),
    updatedAt: v.number(),
    updatedBy: v.id("users"),
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

  // Retry tracking for failed operations
  retryRecords: defineTable({
    operationType: v.union(
      v.literal("google_maps_search"),
      v.literal("findymail_enrichment"), 
      v.literal("langgraph_analysis"),
      v.literal("langgraph_email_generation"),
      v.literal("webhook_call"),
      v.literal("search_orchestration")
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
        v.literal("fixed")
      ),
      backoffMs: v.number(),
    }),
    metadata: v.optional(v.any()),
    status: v.union(
      v.literal("pending"),
      v.literal("executing"),
      v.literal("completed"),
      v.literal("failed")
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
      v.literal("api_calls")
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
      v.literal("api_calls")
    ),
    requestCount: v.number(),
    currentUsage: v.number(),
    limit: v.number(),
    burstUsage: v.number(),
    burstLimit: v.number(),
    timestamp: v.number(),
    userPlan: v.union(v.literal("free"), v.literal("pro"), v.literal("enterprise")),
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
      v.literal("failed")
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
      v.literal("retrying")
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
      v.literal("critical")
    ),
    category: v.string(), // Category for filtering (search_update, system_alert, etc.)
    tags: v.array(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("delivered"),
      v.literal("failed"),
      v.literal("expired")
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
      v.literal("error")
    ),
    message: v.string(),
    data: v.optional(v.any()),
    error: v.optional(v.object({
      message: v.string(),
      stack: v.optional(v.string()),
      name: v.optional(v.string()),
    })),
    performance: v.optional(v.object({
      startTime: v.number(),
      endTime: v.optional(v.number()),
      duration: v.optional(v.number()),
    })),
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

  // FindyMail domain cache to prevent duplicate API calls within same search
  findymailDomainCache: defineTable({
    domain: v.string(),
    searchId: v.id("searches"),
    enrichmentData: v.object({
      emails: v.array(v.object({
        email: v.string(),
        type: v.string(),
        confidence: v.number(),
      })),
      contacts: v.array(v.object({
        name: v.string(),
        title: v.optional(v.string()),
        email: v.optional(v.string()),
        linkedin: v.optional(v.string()),
        confidence: v.number(),
        domain: v.optional(v.string()),
      })),
      socialProfiles: v.optional(v.object({
        linkedin: v.optional(v.string()),
        twitter: v.optional(v.string()),
        facebook: v.optional(v.string()),
      })),
    }),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_domain_search", ["domain", "searchId"])
    .index("by_search", ["searchId"])
    .index("by_expires", ["expiresAt"]),

  // Research Metrics - Track tiered business context research analytics
  researchMetrics: defineTable({
    searchId: v.id("searches"),
    userId: v.id("users"),
    stage: v.union(
      v.literal("research_started"),
      v.literal("tier1_tavily"), 
      v.literal("tier2_exa"),
      v.literal("tier3_perplexity"),
      v.literal("research_completed"),
      v.literal("research_failed"),
      v.literal("research_error")
    ),
    tier: v.union(
      v.literal("tavily"),
      v.literal("exa"), 
      v.literal("perplexity"),
      v.literal("error")
    ),
    confidence: v.number(),
    dataPoints: v.number(),
    sourcesAnalyzed: v.number(),
    escalationReason: v.optional(v.string()),
    error: v.optional(v.string()),
    metadata: v.object({}),
    timestamp: v.number(),
  })
    .index("by_search_timestamp", ["searchId", "timestamp"])
    .index("by_user", ["userId"])
    .index("by_timestamp", ["timestamp"])
    .index("by_tier", ["tier"])
    .index("by_stage", ["stage"])
    .index("by_confidence", ["confidence"]),

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
});