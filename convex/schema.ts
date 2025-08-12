import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,
  // Users table - Authentication and basic user info
  users: defineTable({
    email: v.string(),
    name: v.optional(v.string()),
    avatar: v.optional(v.string()),
    plan: v.union(v.literal("free"), v.literal("pro"), v.literal("enterprise")),
    credits: v.number(),
    role: v.union(v.literal("user"), v.literal("admin")),
    isActive: v.boolean(),
    preferences: v.optional(v.object({
      emailNotifications: v.boolean(),
      language: v.string(),
      timezone: v.string(),
    })),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
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
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_status", ["status"])
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
    })),
    
    // AI Analysis from CrewAI
    aiAnalysis: v.optional(v.object({
      relevanceScore: v.number(),
      painPoints: v.array(v.string()),
      valueMatches: v.array(v.string()),
      fitAssessment: v.string(),
      recommendedApproach: v.string(),
      confidence: v.number(),
    })),
    
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
      v.literal("bonus")
    ),
    amount: v.number(),
    description: v.string(),
    relatedEntity: v.optional(v.object({
      type: v.string(),
      id: v.string(),
    })),
    stripePaymentId: v.optional(v.string()),
    balanceAfter: v.number(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_type", ["type"])
    .index("by_created", ["createdAt"]),

  // CrewAI Requests - Track AI processing requests
  crewaiRequests: defineTable({
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
    name: v.string(),
    service: v.string(),
    keyHash: v.string(), // Hashed version for security
    isActive: v.boolean(),
    lastUsed: v.optional(v.number()),
    usageCount: v.number(),
    createdAt: v.number(),
    expiresAt: v.optional(v.number()),
  })
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
});