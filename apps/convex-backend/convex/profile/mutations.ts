import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../auth";
import { businessProfileValidator } from "../lib/validators";
import { ERROR_CODES, BUSINESS_RULES } from "../lib/constants";
import { createError, sanitizeString, validateEmail, validateUrl, normalizeUrl } from "../lib/helpers";

// Create or update business profile
export const createOrUpdateProfile = mutation({
  args: businessProfileValidator,
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    // Validate and sanitize input data
    const sanitizedData = {
      companyName: sanitizeString(args.companyName),
      industry: sanitizeString(args.industry),
      valueProposition: sanitizeString(args.valueProposition),
      services: args.services.slice(0, BUSINESS_RULES.PROFILE.MAX_SERVICES).map(s => sanitizeString(s)),
      targetMarkets: args.targetMarkets.slice(0, BUSINESS_RULES.PROFILE.MAX_TARGET_MARKETS).map(m => sanitizeString(m)),
      keyDifferentiators: args.keyDifferentiators.slice(0, BUSINESS_RULES.PROFILE.MAX_DIFFERENTIATORS).map(d => sanitizeString(d)),
      caseStudies: args.caseStudies?.slice(0, BUSINESS_RULES.PROFILE.MAX_CASE_STUDIES).map(cs => ({
        title: sanitizeString(cs.title),
        client: sanitizeString(cs.client),
        results: sanitizeString(cs.results),
        metrics: cs.metrics,
      })) || [],
      contactInfo: {
        email: args.contactInfo.email ? (validateEmail(args.contactInfo.email) ? args.contactInfo.email : "") : (user.email || ""),
        phone: args.contactInfo.phone ? sanitizeString(args.contactInfo.phone) : "",
        website: args.contactInfo.website ? (validateUrl(args.contactInfo.website) ? normalizeUrl(args.contactInfo.website) : "") : "",
        linkedin: args.contactInfo.linkedin ? (validateUrl(args.contactInfo.linkedin) ? normalizeUrl(args.contactInfo.linkedin) : "") : "",
      },
    };

    // Additional validation
    if (!sanitizedData.companyName) {
      throw createError("Company name is required", ERROR_CODES.VALIDATION_ERROR, 400);
    }

    if (!sanitizedData.industry) {
      throw createError("Industry is required", ERROR_CODES.VALIDATION_ERROR, 400);
    }

    if (!sanitizedData.valueProposition || sanitizedData.valueProposition.length < 50) {
      throw createError("Value proposition must be at least 50 characters", ERROR_CODES.VALIDATION_ERROR, 400);
    }

    if (sanitizedData.services.length === 0) {
      throw createError("At least one service is required", ERROR_CODES.VALIDATION_ERROR, 400);
    }

    if (sanitizedData.targetMarkets.length === 0) {
      throw createError("At least one target market is required", ERROR_CODES.VALIDATION_ERROR, 400);
    }

    if (sanitizedData.keyDifferentiators.length === 0) {
      throw createError("At least one key differentiator is required", ERROR_CODES.VALIDATION_ERROR, 400);
    }

    // Check if profile already exists
    const existingProfile = await ctx.db
      .query("businessProfiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    // Determine if profile is complete
    // If contactInfo.email is empty, use the user's Clerk email as backup
    const userEmail = sanitizedData.contactInfo.email || user.email || "";
    const isComplete = !!(
      sanitizedData.companyName &&
      sanitizedData.industry &&
      sanitizedData.valueProposition &&
      sanitizedData.services.length > 0 &&
      sanitizedData.targetMarkets.length > 0 &&
      sanitizedData.keyDifferentiators.length > 0 &&
      userEmail // User has email from Clerk or manually entered
    );

    const profileData = {
      userId: user._id,
      ...sanitizedData,
      isComplete,
      updatedAt: Date.now(),
    };

    if (existingProfile) {
      // Update existing profile
      await ctx.db.patch(existingProfile._id, profileData);

      // Send notification if profile was just completed
      if (!existingProfile.isComplete && isComplete) {
        await ctx.db.insert("notifications", {
          userId: user._id,
          type: "system_alert",
          title: "Profile Completed! 🎉",
          message: "Your business profile is now complete. You can start generating highly personalized leads and emails.",
          data: { profileCompleted: true },
          read: false,
          sent: false,
          createdAt: Date.now(),
        });
      }

      return { 
        success: true, 
        profileId: existingProfile._id,
        isComplete,
        message: "Profile updated successfully",
      };
    } else {
      // Create new profile
      const profileId = await ctx.db.insert("businessProfiles", {
        ...profileData,
        createdAt: Date.now(),
      });

      // Send welcome notification
      await ctx.db.insert("notifications", {
        userId: user._id,
        type: "system_alert",
        title: isComplete ? "Profile Created! 🎉" : "Profile Saved",
        message: isComplete 
          ? "Your business profile has been created and is complete. You're ready to start generating leads!"
          : "Your business profile has been saved. Complete the remaining fields to unlock full personalization.",
        data: { 
          profileCreated: true,
          isComplete,
        },
        read: false,
        sent: false,
        createdAt: Date.now(),
      });

      return { 
        success: true, 
        profileId,
        isComplete,
        message: "Profile created successfully",
      };
    }
  },
});

// Update specific profile section
export const updateProfileSection = mutation({
  args: {
    section: v.union(
      v.literal("basic_info"),
      v.literal("services"),
      v.literal("targeting"),
      v.literal("differentiators"),
      v.literal("case_studies"),
      v.literal("contact_info")
    ),
    data: v.any(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const profile = await ctx.db
      .query("businessProfiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    if (!profile) {
      throw createError("Profile not found", ERROR_CODES.RESOURCE_NOT_FOUND, 404);
    }

    let updateData: any = { updatedAt: Date.now() };

    switch (args.section) {
      case "basic_info":
        updateData.companyName = sanitizeString(args.data.companyName || profile.companyName);
        updateData.industry = sanitizeString(args.data.industry || profile.industry);
        updateData.valueProposition = sanitizeString(args.data.valueProposition || profile.valueProposition);
        break;

      case "services":
        updateData.services = (args.data.services || [])
          .slice(0, BUSINESS_RULES.PROFILE.MAX_SERVICES)
          .map((s: string) => sanitizeString(s))
          .filter((s: string) => s.length > 0);
        break;

      case "targeting":
        updateData.targetMarkets = (args.data.targetMarkets || [])
          .slice(0, BUSINESS_RULES.PROFILE.MAX_TARGET_MARKETS)
          .map((m: string) => sanitizeString(m))
          .filter((m: string) => m.length > 0);
        break;

      case "differentiators":
        updateData.keyDifferentiators = (args.data.keyDifferentiators || [])
          .slice(0, BUSINESS_RULES.PROFILE.MAX_DIFFERENTIATORS)
          .map((d: string) => sanitizeString(d))
          .filter((d: string) => d.length > 0);
        break;

      case "case_studies":
        updateData.caseStudies = (args.data.caseStudies || [])
          .slice(0, BUSINESS_RULES.PROFILE.MAX_CASE_STUDIES)
          .map((cs: any) => ({
            title: sanitizeString(cs.title || ""),
            client: sanitizeString(cs.client || ""),
            results: sanitizeString(cs.results || ""),
            metrics: cs.metrics || {},
          }))
          .filter((cs: any) => cs.title && cs.client && cs.results);
        break;

      case "contact_info":
        updateData.contactInfo = {
          email: args.data.email && validateEmail(args.data.email) ? args.data.email : profile.contactInfo?.email || "",
          phone: args.data.phone ? sanitizeString(args.data.phone) : profile.contactInfo?.phone || "",
          website: args.data.website && validateUrl(args.data.website) ? normalizeUrl(args.data.website) : profile.contactInfo?.website || "",
          linkedin: args.data.linkedin && validateUrl(args.data.linkedin) ? normalizeUrl(args.data.linkedin) : profile.contactInfo?.linkedin || "",
        };
        break;

      default:
        throw createError("Invalid section", ERROR_CODES.VALIDATION_ERROR, 400);
    }

    // Update profile
    await ctx.db.patch(profile._id, updateData);

    // Check if profile is now complete
    const updatedProfile = await ctx.db.get(profile._id);
    if (updatedProfile) {
      // Get user for email fallback
      const currentUser = await getCurrentUser(ctx);
      const userEmail = updatedProfile.contactInfo?.email || currentUser?.email || "";
      const isComplete = !!(
        updatedProfile.companyName &&
        updatedProfile.industry &&
        updatedProfile.valueProposition &&
        updatedProfile.services?.length > 0 &&
        updatedProfile.targetMarkets?.length > 0 &&
        updatedProfile.keyDifferentiators?.length > 0 &&
        userEmail // User has email from Clerk or manually entered
      );

      if (isComplete !== updatedProfile.isComplete) {
        await ctx.db.patch(profile._id, { isComplete });

        if (isComplete) {
          await ctx.db.insert("notifications", {
            userId: user._id,
            type: "system_alert",
            title: "Profile Completed! 🎉",
            message: "Your business profile is now complete. You can start generating highly personalized leads and emails.",
            data: { profileCompleted: true },
            read: false,
            sent: false,
            createdAt: Date.now(),
          });
        }
      }
    }

    return { 
      success: true,
      message: `${args.section} updated successfully`,
    };
  },
});

// Delete business profile
export const deleteProfile = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const profile = await ctx.db
      .query("businessProfiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    if (!profile) {
      throw createError("Profile not found", ERROR_CODES.RESOURCE_NOT_FOUND, 404);
    }

    // Delete the profile
    await ctx.db.delete(profile._id);

    // Send notification
    await ctx.db.insert("notifications", {
      userId: user._id,
      type: "system_alert",
      title: "Profile Deleted",
      message: "Your business profile has been deleted. You can create a new one anytime.",
      data: { profileDeleted: true },
      read: false,
      sent: false,
      createdAt: Date.now(),
    });

    return { success: true };
  },
});

// Import profile from external source
export const importProfile = mutation({
  args: {
    source: v.union(v.literal("linkedin"), v.literal("website"), v.literal("manual")),
    data: v.any(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    // Process different import sources
    let profileData: any = {};

    switch (args.source) {
      case "linkedin":
        // Extract data from LinkedIn profile
        profileData = {
          companyName: sanitizeString(args.data.companyName || ""),
          industry: sanitizeString(args.data.industry || ""),
          valueProposition: sanitizeString(args.data.description || ""),
          services: (args.data.services || []).map((s: string) => sanitizeString(s)),
          targetMarkets: (args.data.targetMarkets || []).map((m: string) => sanitizeString(m)),
          keyDifferentiators: (args.data.specialties || []).map((d: string) => sanitizeString(d)),
          contactInfo: {
            email: "",
            phone: "",
            website: args.data.website || "",
            linkedin: args.data.linkedinUrl || "",
          },
        };
        break;

      case "website":
        // Extract data from website
        profileData = {
          companyName: sanitizeString(args.data.companyName || ""),
          industry: sanitizeString(args.data.industry || ""),
          valueProposition: sanitizeString(args.data.description || args.data.tagline || ""),
          services: (args.data.services || []).map((s: string) => sanitizeString(s)),
          targetMarkets: [],
          keyDifferentiators: [],
          contactInfo: {
            email: args.data.email || "",
            phone: args.data.phone || "",
            website: args.data.website || "",
            linkedin: "",
          },
        };
        break;

      case "manual":
        // Use manually provided data
        profileData = args.data;
        break;

      default:
        throw createError("Invalid import source", ERROR_CODES.VALIDATION_ERROR, 400);
    }

    // Check if profile already exists
    const existingProfile = await ctx.db
      .query("businessProfiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    const now = Date.now();

    if (existingProfile) {
      // Merge with existing profile
      const mergedData = {
        companyName: profileData.companyName || existingProfile.companyName,
        industry: profileData.industry || existingProfile.industry,
        valueProposition: profileData.valueProposition || existingProfile.valueProposition,
        services: Array.from(new Set([...(existingProfile.services || []), ...(profileData.services || [])])),
        targetMarkets: Array.from(new Set([...(existingProfile.targetMarkets || []), ...(profileData.targetMarkets || [])])),
        keyDifferentiators: Array.from(new Set([...(existingProfile.keyDifferentiators || []), ...(profileData.keyDifferentiators || [])])),
        contactInfo: {
          email: profileData.contactInfo?.email || existingProfile.contactInfo?.email || "",
          phone: profileData.contactInfo?.phone || existingProfile.contactInfo?.phone || "",
          website: profileData.contactInfo?.website || existingProfile.contactInfo?.website || "",
          linkedin: profileData.contactInfo?.linkedin || existingProfile.contactInfo?.linkedin || "",
        },
        updatedAt: now,
      };

      await ctx.db.patch(existingProfile._id, mergedData);

      return { 
        success: true, 
        profileId: existingProfile._id,
        message: "Profile updated with imported data",
      };
    } else {
      // Create new profile
      const userEmail = profileData.contactInfo?.email || "";
      const isComplete = !!(
        profileData.companyName &&
        profileData.industry &&
        profileData.valueProposition &&
        profileData.services?.length > 0 &&
        profileData.targetMarkets?.length > 0 &&
        profileData.keyDifferentiators?.length > 0 &&
        userEmail // User has email from profile data
      );

      const profileId = await ctx.db.insert("businessProfiles", {
        userId: user._id,
        ...profileData,
        isComplete,
        createdAt: now,
        updatedAt: now,
      });

      // Send notification
      await ctx.db.insert("notifications", {
        userId: user._id,
        type: "system_alert",
        title: "Profile Imported",
        message: `Your business profile has been imported from ${args.source}. Review and complete any missing information.`,
        data: { 
          imported: true,
          source: args.source,
          isComplete,
        },
        read: false,
        sent: false,
        createdAt: now,
      });

      return { 
        success: true, 
        profileId,
        message: "Profile created from imported data",
      };
    }
  },
});