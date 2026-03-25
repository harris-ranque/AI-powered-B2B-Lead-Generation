import { v } from "convex/values";

// Profile completion validation
export const profileCompletenessValidator = v.object({
  companyName: v.boolean(),
  industry: v.boolean(),
  valueProposition: v.boolean(),
  services: v.boolean(),
  targetMarkets: v.boolean(),
  keyDifferentiators: v.boolean(),
  contactEmail: v.boolean(),
  caseStudies: v.optional(v.boolean()),
  socialProfiles: v.optional(v.boolean()),
});

// Profile import validation
export const importDataValidator = v.object({
  source: v.union(
    v.literal("linkedin"),
    v.literal("website"),
    v.literal("manual"),
  ),
  companyName: v.optional(v.string()),
  industry: v.optional(v.string()),
  description: v.optional(v.string()),
  website: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  services: v.optional(v.array(v.string())),
  specialties: v.optional(v.array(v.string())),
  targetMarkets: v.optional(v.array(v.string())),
  linkedinUrl: v.optional(v.string()),
});

// Profile section update validation
export const sectionUpdateValidator = v.union(
  // Basic info section
  v.object({
    section: v.literal("basic_info"),
    companyName: v.optional(v.string()),
    industry: v.optional(v.string()),
    valueProposition: v.optional(v.string()),
  }),

  // Services section
  v.object({
    section: v.literal("services"),
    services: v.array(v.string()),
  }),

  // Targeting section
  v.object({
    section: v.literal("targeting"),
    targetMarkets: v.array(v.string()),
  }),

  // Differentiators section
  v.object({
    section: v.literal("differentiators"),
    keyDifferentiators: v.array(v.string()),
  }),

  // Case studies section
  v.object({
    section: v.literal("case_studies"),
    caseStudies: v.array(
      v.object({
        title: v.string(),
        client: v.string(),
        results: v.string(),
        metrics: v.any(),
      }),
    ),
  }),

  // Contact info section
  v.object({
    section: v.literal("contact_info"),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    signature: v.optional(v.string()),
    signatureEnabled: v.optional(v.boolean()),
  }),
);

// Profile quality scoring
export const profileQualityMetrics = v.object({
  completionScore: v.number(), // 0-100
  qualityScore: v.number(), // 0-100
  personalizationPotential: v.number(), // 0-100
  missingCriticalFields: v.array(v.string()),
  improvementSuggestions: v.array(v.string()),
});

// Industry-specific requirements
export const industryRequirements = v.object({
  industry: v.string(),
  requiredFields: v.array(v.string()),
  recommendedFields: v.array(v.string()),
  commonServices: v.array(v.string()),
  typicalTargetMarkets: v.array(v.string()),
  keyDifferentiators: v.array(v.string()),
});

// Profile analytics data
export const profileAnalytics = v.object({
  viewCount: v.number(),
  searchesUsingProfile: v.number(),
  emailsGenerated: v.number(),
  avgRelevanceScore: v.number(),
  lastUsed: v.number(),
  topPerformingElements: v.array(
    v.object({
      element: v.string(),
      impact: v.number(),
    }),
  ),
});
