import { query } from "../_generated/server";
import { v } from "convex/values";
import { auth } from "../auth.config";
import { ERROR_CODES } from "../lib/constants";
import { createError } from "../lib/helpers";

// Get current user's business profile
export const getCurrentProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    
    if (!userId) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const profile = await ctx.db
      .query("businessProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    return profile;
  },
});

// Check if profile is complete
export const getProfileCompleteness = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    
    if (!userId) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const profile = await ctx.db
      .query("businessProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    if (!profile) {
      return {
        isComplete: false,
        completionPercentage: 0,
        missingFields: [
          "companyName",
          "industry",
          "valueProposition",
          "services",
          "targetMarkets",
          "keyDifferentiators",
          "contactInfo",
        ],
      };
    }

    const requiredFields = [
      "companyName",
      "industry", 
      "valueProposition",
      "services",
      "targetMarkets",
      "keyDifferentiators",
      "contactInfo",
    ];

    const missingFields = [];
    let completedFields = 0;

    // Check required fields
    if (!profile.companyName?.trim()) missingFields.push("companyName");
    else completedFields++;

    if (!profile.industry?.trim()) missingFields.push("industry");
    else completedFields++;

    if (!profile.valueProposition?.trim()) missingFields.push("valueProposition");
    else completedFields++;

    if (!profile.services?.length) missingFields.push("services");
    else completedFields++;

    if (!profile.targetMarkets?.length) missingFields.push("targetMarkets");
    else completedFields++;

    if (!profile.keyDifferentiators?.length) missingFields.push("keyDifferentiators");
    else completedFields++;

    // Check contact info (at least email should be provided)
    if (!profile.contactInfo?.email?.trim()) missingFields.push("contactInfo");
    else completedFields++;

    const completionPercentage = Math.round((completedFields / requiredFields.length) * 100);
    const isComplete = missingFields.length === 0;

    return {
      isComplete,
      completionPercentage,
      missingFields,
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
      "Technology": {
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
        valueProposition: "We leverage cutting-edge technology to transform businesses and drive growth through innovative digital solutions.",
      },
      
      "Marketing": {
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
        valueProposition: "We create compelling marketing strategies that drive measurable results and accelerate business growth.",
      },
      
      "Consulting": {
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
        valueProposition: "We partner with organizations to optimize performance, drive efficiency, and achieve sustainable growth.",
      },
      
      "Healthcare": {
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
        valueProposition: "We improve patient outcomes and healthcare efficiency through innovative, compliant technology solutions.",
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
        valueProposition: "We provide secure, compliant financial solutions that protect and grow our clients' wealth.",
      },
    };

    return templates[args.industry] || {
      services: [],
      targetMarkets: [],
      keyDifferentiators: [],
      valueProposition: "",
    };
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
    const errors = [];

    // Validate company name
    if (!args.companyName.trim()) {
      errors.push("Company name is required");
    } else if (args.companyName.length > 100) {
      errors.push("Company name must be less than 100 characters");
    }

    // Validate industry
    if (!args.industry.trim()) {
      errors.push("Industry is required");
    }

    // Validate value proposition
    if (!args.valueProposition.trim()) {
      errors.push("Value proposition is required");
    } else if (args.valueProposition.length < 50) {
      errors.push("Value proposition should be at least 50 characters");
    } else if (args.valueProposition.length > 500) {
      errors.push("Value proposition must be less than 500 characters");
    }

    // Validate services
    if (args.services.length === 0) {
      errors.push("At least one service is required");
    } else if (args.services.length > 20) {
      errors.push("Maximum 20 services allowed");
    }

    // Validate target markets
    if (args.targetMarkets.length === 0) {
      errors.push("At least one target market is required");
    } else if (args.targetMarkets.length > 15) {
      errors.push("Maximum 15 target markets allowed");
    }

    // Validate key differentiators
    if (args.keyDifferentiators.length === 0) {
      errors.push("At least one key differentiator is required");
    } else if (args.keyDifferentiators.length > 10) {
      errors.push("Maximum 10 key differentiators allowed");
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  },
});