import { describe, it, expect } from "vitest";
import {
  sanitizeRoles,
  validateSearchParameters,
  validateEnterpriseKeys,
  formatMissingKeysError,
  DEFAULT_TARGET_ROLES,
  MAX_TARGET_ROLES,
  PLAN_LEAD_LIMITS,
} from "../../convex/lib/searchLogic";

describe("searchLogic", () => {
  describe("sanitizeRoles", () => {
    it("should return default roles for null input", () => {
      const result = sanitizeRoles(null);

      expect(result).toEqual([...DEFAULT_TARGET_ROLES]);
    });

    it("should return default roles for undefined input", () => {
      const result = sanitizeRoles(undefined);

      expect(result).toEqual([...DEFAULT_TARGET_ROLES]);
    });

    it("should return default roles for empty array", () => {
      const result = sanitizeRoles([]);

      expect(result).toEqual([...DEFAULT_TARGET_ROLES]);
    });

    it("should trim whitespace from roles", () => {
      const result = sanitizeRoles(["  CEO  ", "  CTO  "]);

      expect(result).toContain("Ceo");
      expect(result).toContain("Cto");
    });

    it("should convert to title case", () => {
      const result = sanitizeRoles(["ceo", "FOUNDER", "vp of sales"]);

      expect(result).toContain("Ceo");
      expect(result).toContain("Founder");
      expect(result).toContain("Vp Of Sales");
    });

    it("should handle multi-word roles", () => {
      const result = sanitizeRoles(["vice president"]);

      expect(result).toContain("Vice President");
    });

    it("should deduplicate roles", () => {
      const result = sanitizeRoles(["CEO", "ceo", "Ceo", "CTO"]);

      expect(result).toHaveLength(2);
      expect(result).toContain("Ceo");
      expect(result).toContain("Cto");
    });

    it("should limit to MAX_TARGET_ROLES", () => {
      const result = sanitizeRoles([
        "CEO",
        "CTO",
        "CFO",
        "COO",
        "CMO",
        "VP",
        "Director",
      ]);

      expect(result).toHaveLength(MAX_TARGET_ROLES);
      expect(result).toContain("Ceo");
      expect(result).toContain("Cto");
      expect(result).toContain("Cfo");
    });

    it("should filter out empty strings", () => {
      const result = sanitizeRoles(["CEO", "", "   ", "CTO"]);

      expect(result).not.toContain("");
      expect(result).toHaveLength(2);
    });

    it("should return defaults if all roles are invalid", () => {
      const result = sanitizeRoles(["", "   ", "\t"]);

      expect(result).toEqual([...DEFAULT_TARGET_ROLES]);
    });

    it("should handle roles with extra whitespace", () => {
      const result = sanitizeRoles(["  VP   of   Sales  "]);

      expect(result).toContain("Vp Of Sales");
    });
  });

  describe("validateSearchParameters", () => {
    describe("basic validation", () => {
      it("should reject zero maxResults", () => {
        const result = validateSearchParameters(0, "pro");

        expect(result.valid).toBe(false);
        expect(result.reason).toContain("positive");
      });

      it("should reject negative maxResults", () => {
        const result = validateSearchParameters(-10, "pro");

        expect(result.valid).toBe(false);
        expect(result.reason).toContain("positive");
      });

      it("should reject non-integer maxResults", () => {
        const result = validateSearchParameters(10.5, "pro");

        expect(result.valid).toBe(false);
        expect(result.reason).toContain("integer");
      });

      it("should reject NaN maxResults", () => {
        const result = validateSearchParameters(NaN, "pro");

        expect(result.valid).toBe(false);
      });

      it("should reject Infinity maxResults", () => {
        const result = validateSearchParameters(Infinity, "pro");

        expect(result.valid).toBe(false);
      });
    });

    describe("plan-based limits", () => {
      it("should enforce free plan limit", () => {
        const result = validateSearchParameters(100, "free");

        expect(result.valid).toBe(true);
        expect(result.adjustedMaxLeads).toBe(PLAN_LEAD_LIMITS.free);
        expect(result.reason).toContain("free");
      });

      it("should enforce starter plan limit", () => {
        const result = validateSearchParameters(100, "starter");

        expect(result.valid).toBe(true);
        expect(result.adjustedMaxLeads).toBe(PLAN_LEAD_LIMITS.starter);
      });

      it("should enforce pro plan limit", () => {
        const result = validateSearchParameters(200, "pro");

        expect(result.valid).toBe(true);
        expect(result.adjustedMaxLeads).toBe(PLAN_LEAD_LIMITS.pro);
      });

      it("should allow enterprise plan higher limits", () => {
        const result = validateSearchParameters(500, "enterprise");

        expect(result.valid).toBe(true);
        expect(result.adjustedMaxLeads).toBe(500);
      });

      it("should cap enterprise at plan limit", () => {
        const result = validateSearchParameters(1000, "enterprise");

        expect(result.valid).toBe(true);
        expect(result.adjustedMaxLeads).toBe(PLAN_LEAD_LIMITS.enterprise);
      });

      it("should not adjust if within plan limit", () => {
        const result = validateSearchParameters(20, "free");

        expect(result.valid).toBe(true);
        expect(result.adjustedMaxLeads).toBe(20);
        expect(result.reason).toBeUndefined();
      });
    });
  });

  describe("validateEnterpriseKeys", () => {
    it("should return valid with all required keys", () => {
      const result = validateEnterpriseKeys([
        { provider: "openai", isActive: true, validated: true },
        { provider: "google_places", isActive: true, validated: true },
        { provider: "findymail", isActive: true, validated: true },
        { provider: "tavily", isActive: true, validated: true },
        { provider: "perplexity", isActive: true, validated: true },
      ]);

      expect(result.isValid).toBe(true);
      expect(result.missingKeys).toHaveLength(0);
      expect(result.hasLegacyGoogleMaps).toBe(false);
    });

    it("should identify missing OpenAI key", () => {
      const result = validateEnterpriseKeys([
        { provider: "google_places", isActive: true, validated: true },
        { provider: "findymail", isActive: true, validated: true },
        { provider: "tavily", isActive: true, validated: true },
        { provider: "perplexity", isActive: true, validated: true },
      ]);

      expect(result.isValid).toBe(false);
      expect(result.missingKeys).toContain("OpenAI");
    });

    it("should identify missing Google Places key", () => {
      const result = validateEnterpriseKeys([
        { provider: "openai", isActive: true, validated: true },
        { provider: "findymail", isActive: true, validated: true },
        { provider: "tavily", isActive: true, validated: true },
        { provider: "perplexity", isActive: true, validated: true },
      ]);

      expect(result.isValid).toBe(false);
      expect(result.missingKeys).toContain("Google Places");
    });

    it("should accept legacy google_maps key", () => {
      const result = validateEnterpriseKeys([
        { provider: "openai", isActive: true, validated: true },
        { provider: "google_maps", isActive: true, validated: true },
        { provider: "findymail", isActive: true, validated: true },
        { provider: "tavily", isActive: true, validated: true },
        { provider: "perplexity", isActive: true, validated: true },
      ]);

      expect(result.isValid).toBe(true);
      expect(result.hasLegacyGoogleMaps).toBe(true);
    });

    it("should not flag legacy when google_places is present", () => {
      const result = validateEnterpriseKeys([
        { provider: "openai", isActive: true, validated: true },
        { provider: "google_places", isActive: true, validated: true },
        { provider: "google_maps", isActive: true, validated: true },
        { provider: "findymail", isActive: true, validated: true },
        { provider: "tavily", isActive: true, validated: true },
        { provider: "perplexity", isActive: true, validated: true },
      ]);

      expect(result.isValid).toBe(true);
      expect(result.hasLegacyGoogleMaps).toBe(false);
    });

    it("should ignore inactive keys", () => {
      const result = validateEnterpriseKeys([
        { provider: "openai", isActive: false, validated: true },
        { provider: "google_places", isActive: true, validated: true },
        { provider: "findymail", isActive: true, validated: true },
        { provider: "tavily", isActive: true, validated: true },
        { provider: "perplexity", isActive: true, validated: true },
      ]);

      expect(result.isValid).toBe(false);
      expect(result.missingKeys).toContain("OpenAI");
    });

    it("should ignore unvalidated keys", () => {
      const result = validateEnterpriseKeys([
        { provider: "openai", isActive: true, validated: false },
        { provider: "google_places", isActive: true, validated: true },
        { provider: "findymail", isActive: true, validated: true },
        { provider: "tavily", isActive: true, validated: true },
        { provider: "perplexity", isActive: true, validated: true },
      ]);

      expect(result.isValid).toBe(false);
      expect(result.missingKeys).toContain("OpenAI");
    });

    it("should identify all missing keys", () => {
      const result = validateEnterpriseKeys([]);

      expect(result.isValid).toBe(false);
      expect(result.missingKeys).toHaveLength(5);
      expect(result.missingKeys).toContain("OpenAI");
      expect(result.missingKeys).toContain("Google Places");
      expect(result.missingKeys).toContain("FindyMail");
      expect(result.missingKeys).toContain("Tavily");
      expect(result.missingKeys).toContain("Perplexity");
    });

    it("should handle mixed valid/invalid keys", () => {
      const result = validateEnterpriseKeys([
        { provider: "openai", isActive: true, validated: true },
        { provider: "google_places", isActive: true, validated: true },
        { provider: "findymail", isActive: false, validated: true }, // Inactive
        { provider: "tavily", isActive: true, validated: false }, // Not validated
        { provider: "perplexity", isActive: true, validated: true },
      ]);

      expect(result.isValid).toBe(false);
      expect(result.missingKeys).toContain("FindyMail");
      expect(result.missingKeys).toContain("Tavily");
      expect(result.missingKeys).not.toContain("OpenAI");
    });
  });

  describe("formatMissingKeysError", () => {
    it("should return empty string for no missing keys", () => {
      const result = formatMissingKeysError("a search", []);

      expect(result).toBe("");
    });

    it("should format single missing key", () => {
      const result = formatMissingKeysError("a search", ["OpenAI"]);

      expect(result).toContain("a search");
      expect(result).toContain("OpenAI");
    });

    it("should format multiple missing keys", () => {
      const result = formatMissingKeysError("a search", [
        "OpenAI",
        "FindyMail",
        "Tavily",
      ]);

      expect(result).toContain("a search");
      expect(result).toContain("OpenAI");
      expect(result).toContain("FindyMail");
      expect(result).toContain("Tavily");
    });

    it("should handle different operation names", () => {
      const result = formatMissingKeysError("an enrichment", ["OpenAI"]);

      expect(result).toContain("an enrichment");
    });
  });
});
