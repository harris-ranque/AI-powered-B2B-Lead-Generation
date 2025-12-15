/**
 * Convex-test setup for integration testing
 *
 * This module provides utilities for testing Convex mutations and queries
 * against a real Convex runtime with proper code coverage.
 *
 * @module convex-test-setup
 */

import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

// Import all Convex function modules explicitly for convex-test
// Includes _generated but excludes convex.config.ts (requires runtime)
const modules = import.meta.glob([
  "../convex/**/*.*s",
  "!../convex/convex.config.ts",
], { eager: true });

// Debug: uncomment to log loaded module paths
// console.log("Loaded modules:", Object.keys(modules).length);

/**
 * Create a new test context with the Convex schema
 * Each test gets an isolated database instance
 */
export function createTestContext() {
  // Debug: show what modules are available
  // console.log("Module paths:", Object.keys(modules).filter(k => k.includes("_generated")));
  // Note: convexTest expects modules directly, not wrapped in an object
  return convexTest(schema, modules);
}

/**
 * Re-export API and internal functions for test usage
 */
export { api, internal };

/**
 * Type-safe ID helper for tests
 */
export type { Id };

/**
 * Common test data factories
 */
export const testData = {
  /**
   * Create a test user with default values
   */
  createUser: (overrides: Partial<{
    clerkId: string;
    email: string;
    name: string;
    plan: "free" | "pro" | "starter" | "professional" | "business" | "enterprise";
    credits: number;
    role: "user" | "admin";
    isActive: boolean;
  }> = {}) => ({
    clerkId: `clerk_test_${Date.now()}`,
    email: `test_${Date.now()}@example.com`,
    name: "Test User",
    plan: "free" as const,
    credits: 100,
    role: "user" as const,
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }),

  /**
   * Create a test business profile
   */
  createBusinessProfile: (userId: Id<"users">, overrides: Partial<{
    companyName: string;
    industry: string;
    valueProposition: string;
    services: string[];
    targetMarkets: string[];
    keyDifferentiators: string[];
  }> = {}) => ({
    userId,
    companyName: "Test Company Inc",
    industry: "Technology",
    valueProposition: "We provide innovative solutions that help businesses grow and succeed in the digital age through cutting-edge technology.",
    services: ["Consulting", "Development", "Support"],
    targetMarkets: ["SMB", "Enterprise"],
    keyDifferentiators: ["Expert Team", "Fast Delivery", "24/7 Support"],
    contactInfo: {
      email: "contact@testcompany.com",
      phone: "555-1234",
      website: "https://testcompany.com",
    },
    isComplete: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }),

  /**
   * Create a test search
   */
  createSearch: (userId: Id<"users">, overrides: Partial<{
    name: string;
    status: "created" | "processing" | "completed" | "failed";
    keywords: string[];
    location: string;
    radius: number;
  }> = {}) => ({
    userId,
    name: "Test Search",
    status: "created" as const,
    parameters: {
      location: "San Francisco, CA",
      radius: 10000,
      keywords: ["restaurant", "cafe"],
      targetRoles: ["Owner", "Manager"],
      maxLeads: 50,
      excludedTypes: [],
      ...(overrides.keywords && { keywords: overrides.keywords }),
      ...(overrides.location && { location: overrides.location }),
      ...(overrides.radius && { radius: overrides.radius }),
    },
    results: {
      totalFound: 0,
      enriched: 0,
      analyzed: 0,
    },
    creditsUsed: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }),
};

/**
 * Test utilities for common operations
 */
export const testUtils = {
  /**
   * Wait for a condition to be true
   */
  waitFor: async (
    condition: () => Promise<boolean>,
    timeout: number = 5000,
    interval: number = 100
  ): Promise<void> => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await condition()) return;
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    throw new Error("Timeout waiting for condition");
  },

  /**
   * Generate a unique test identifier
   */
  uniqueId: (prefix: string = "test"): string =>
    `${prefix}_${Date.now()}_${Math.random().toString(36).substring(7)}`,
};
