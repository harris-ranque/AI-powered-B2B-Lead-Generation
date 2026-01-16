import { query } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../auth";
import { ERROR_CODES } from "../lib/constants";
import { createError } from "../lib/helpers";
import {
  calculateProfileCompleteness,
  validateProfileData as validateProfileDataPure,
} from "../lib/profileLogic";

// Get current user's business profile
// Returns null if not authenticated (allows query during auth hydration)
export const getCurrentProfile = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);

    // Return null instead of throwing - allows query during auth token hydration
    if (!user) {
      return null;
    }

    const profile = await ctx.db
      .query("businessProfiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    return profile;
  },
});

// Check if profile is complete
// Returns null if not authenticated (allows query during auth hydration)
export const getProfileCompleteness = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);

    // Return null instead of throwing - allows query during auth token hydration
    if (!user) {
      return null;
    }

    const profile = await ctx.db
      .query("businessProfiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    // Use extracted pure function for completeness calculation
    const completeness = calculateProfileCompleteness(profile);

    return {
      ...completeness,
      profile,
    };
  },
});

// Get profile by company name (for public display)
export const getProfileByCompany = query({
  args: { companyName: v.string() },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("businessProfiles")
      .withIndex("by_company", (q) => q.eq("companyName", args.companyName))
      .unique();

    if (!profile) {
      return null;
    }

    // Return only public information
    return {
      companyName: profile.companyName,
      industry: profile.industry,
      valueProposition: profile.valueProposition,
      services: profile.services,
      targetMarkets: profile.targetMarkets,
      keyDifferentiators: profile.keyDifferentiators,
      caseStudies: profile.caseStudies,
      contactInfo: {
        website: profile.contactInfo?.website,
        linkedin: profile.contactInfo?.linkedin,
      },
    };
  },
});

// Get profile template based on industry
export const getProfileTemplate = query({
  args: { industry: v.string() },
  handler: async (ctx, args) => {
    // Return industry-specific templates to help users get started
    const templates = {
      Technology: {
        services: [
          "Software Development",
          "Cloud Solutions",
          "Data Analytics",
          "Cybersecurity",
          "Digital Transformation",
        ],
        targetMarkets: [
          "Small to Medium Businesses",
          "Enterprise Clients",
          "Startups",
          "E-commerce Companies",
        ],
        keyDifferentiators: [
          "Cutting-edge Technology",
          "24/7 Support",
          "Scalable Solutions",
          "Rapid Implementation",
        ],
        valueProposition:
          "We leverage cutting-edge technology to transform businesses and drive growth through innovative digital solutions.",
      },

      Marketing: {
        services: [
          "Digital Marketing",
          "Content Creation",
          "SEO/SEM",
          "Social Media Management",
          "Brand Strategy",
        ],
        targetMarkets: [
          "B2B Companies",
          "E-commerce Brands",
          "Professional Services",
          "Healthcare Providers",
        ],
        keyDifferentiators: [
          "Data-Driven Approach",
          "Creative Excellence",
          "ROI-Focused Campaigns",
          "Industry Expertise",
        ],
        valueProposition:
          "We create compelling marketing strategies that drive measurable results and accelerate business growth.",
      },

      Consulting: {
        services: [
          "Strategic Planning",
          "Process Optimization",
          "Change Management",
          "Business Analysis",
          "Performance Improvement",
        ],
        targetMarkets: [
          "Fortune 500 Companies",
          "Government Agencies",
          "Non-Profit Organizations",
          "Growing Businesses",
        ],
        keyDifferentiators: [
          "Proven Methodology",
          "Industry Expertise",
          "Measurable Results",
          "Long-term Partnership",
        ],
        valueProposition:
          "We partner with organizations to optimize performance, drive efficiency, and achieve sustainable growth.",
      },

      Healthcare: {
        services: [
          "Healthcare IT Solutions",
          "Medical Device Development",
          "Clinical Research",
          "Healthcare Consulting",
          "Telemedicine Platforms",
        ],
        targetMarkets: [
          "Hospitals & Health Systems",
          "Medical Practices",
          "Pharmaceutical Companies",
          "Healthcare Startups",
        ],
        keyDifferentiators: [
          "HIPAA Compliance",
          "Clinical Expertise",
          "Evidence-Based Solutions",
          "Patient-Centered Approach",
        ],
        valueProposition:
          "We improve patient outcomes and healthcare efficiency through innovative, compliant technology solutions.",
      },

      "Financial Services": {
        services: [
          "Financial Planning",
          "Investment Management",
          "Risk Assessment",
          "Regulatory Compliance",
          "Fintech Solutions",
        ],
        targetMarkets: [
          "Individual Investors",
          "Small Businesses",
          "Corporate Clients",
          "Financial Institutions",
        ],
        keyDifferentiators: [
          "Regulatory Expertise",
          "Risk Management",
          "Personalized Service",
          "Advanced Analytics",
        ],
        valueProposition:
          "We provide secure, compliant financial solutions that protect and grow our clients' wealth.",
      },
    };

    return (
      templates[args.industry as keyof typeof templates] || {
        services: [],
        targetMarkets: [],
        keyDifferentiators: [],
        valueProposition: "",
      }
    );
  },
});

// Get industry suggestions
export const getIndustrySuggestions = query({
  args: {},
  handler: async (ctx) => {
    return [
      "Technology",
      "Marketing",
      "Consulting",
      "Healthcare",
      "Financial Services",
      "E-commerce",
      "Real Estate",
      "Education",
      "Manufacturing",
      "Retail",
      "Professional Services",
      "Non-Profit",
      "Government",
      "Agriculture",
      "Construction",
      "Transportation",
      "Entertainment",
      "Hospitality",
      "Energy",
      "Legal",
    ];
  },
});

// Validate profile data
export const validateProfileData = query({
  args: {
    companyName: v.string(),
    industry: v.string(),
    valueProposition: v.string(),
    services: v.array(v.string()),
    targetMarkets: v.array(v.string()),
    keyDifferentiators: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // Use extracted pure function for validation
    return validateProfileDataPure(args);
  },
});

// Get business profile by user ID (for internal use)
export const getProfileByUserId = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("businessProfiles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();

    return profile;
  },
});

// Alias for getCurrentProfile to maintain compatibility
export const getBusinessProfile = getCurrentProfile;
