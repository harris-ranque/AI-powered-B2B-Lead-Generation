import { v } from "convex/values";

// User validators
export const createUserValidator = v.object({
  email: v.string(),
  name: v.optional(v.string()),
  avatar: v.optional(v.string()),
});

export const updateUserValidator = v.object({
  name: v.optional(v.string()),
  avatar: v.optional(v.string()),
  preferences: v.optional(v.object({
    emailNotifications: v.boolean(),
    language: v.string(),
    timezone: v.string(),
  })),
});

// Business profile validators
export const businessProfileValidator = v.object({
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
});

// Search validators
export const searchParametersValidator = v.object({
  location: v.string(),
  radius: v.number(),
  keywords: v.array(v.string()),
  industries: v.optional(v.array(v.string())),
  excludeTerms: v.optional(v.array(v.string())),
  minRating: v.optional(v.number()),
  maxResults: v.number(),
});

export const createSearchValidator = v.object({
  name: v.string(),
  parameters: searchParametersValidator,
});

// Lead validators
export const leadBasicInfoValidator = v.object({
  businessName: v.string(),
  address: v.string(),
  phone: v.optional(v.string()),
  website: v.optional(v.string()),
  rating: v.optional(v.number()),
  reviewCount: v.optional(v.number()),
  category: v.optional(v.string()),
  placeId: v.string(),
  location: v.object({
    lat: v.number(),
    lng: v.number(),
    formattedAddress: v.string(),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    country: v.optional(v.string()),
    postalCode: v.optional(v.string()),
  }),
});

export const enrichmentDataValidator = v.object({
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
});

export const aiAnalysisValidator = v.object({
  relevanceScore: v.number(),
  painPoints: v.array(v.string()),
  valueMatches: v.array(v.string()),
  fitAssessment: v.string(),
  recommendedApproach: v.string(),
  confidence: v.number(),
});

// Email generation validators
export const emailRequirementsValidator = v.object({
  tone: v.union(v.literal("professional"), v.literal("casual"), v.literal("friendly")),
  length: v.union(v.literal("short"), v.literal("medium"), v.literal("long")),
  callToAction: v.string(),
  includeCaseStudy: v.boolean(),
  personalizationLevel: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
  followUpSequence: v.boolean(),
});

export const agentResultValidator = v.object({
  agentName: v.string(),
  role: v.string(),
  output: v.string(),
  confidenceScore: v.number(),
  executionTime: v.number(),
});

// Billing validators
export const creditTransactionValidator = v.object({
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
});

// Notification validators
export const notificationValidator = v.object({
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
});

// CrewAI request validators
export const crewaiRequestValidator = v.object({
  type: v.union(
    v.literal("email_generation"),
    v.literal("lead_analysis"),
    v.literal("bulk_analysis")
  ),
  inputData: v.any(),
  creditsUsed: v.number(),
});