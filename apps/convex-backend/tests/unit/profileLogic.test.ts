import { describe, it, expect } from "vitest";
import {
  calculateProfileCompleteness,
  validateProfileData,
  isProfileComplete,
  mergeProfileData,
  PROFILE_CONSTRAINTS,
} from "../../convex/lib/profileLogic";

describe("profileLogic", () => {
  describe("calculateProfileCompleteness", () => {
    it("should return 0% for null profile", () => {
      const result = calculateProfileCompleteness(null);

      expect(result.isComplete).toBe(false);
      expect(result.completionPercentage).toBe(0);
      expect(result.missingFields).toHaveLength(7);
      expect(result.missingFields).toContain("companyName");
      expect(result.missingFields).toContain("contactInfo");
    });

    it("should return 0% for undefined profile", () => {
      const result = calculateProfileCompleteness(undefined);

      expect(result.isComplete).toBe(false);
      expect(result.completionPercentage).toBe(0);
    });

    it("should return 0% for empty profile object", () => {
      const result = calculateProfileCompleteness({});

      expect(result.isComplete).toBe(false);
      expect(result.completionPercentage).toBe(0);
      expect(result.missingFields).toHaveLength(7);
    });

    it("should calculate partial completion correctly", () => {
      const result = calculateProfileCompleteness({
        companyName: "Acme Inc",
        industry: "Technology",
        services: ["Consulting"],
      });

      expect(result.isComplete).toBe(false);
      expect(result.completionPercentage).toBe(43); // 3/7 * 100 = 42.86 -> 43
      expect(result.missingFields).toContain("valueProposition");
      expect(result.missingFields).toContain("targetMarkets");
      expect(result.missingFields).toContain("keyDifferentiators");
      expect(result.missingFields).toContain("contactInfo");
      expect(result.missingFields).not.toContain("companyName");
    });

    it("should return 100% for complete profile", () => {
      const result = calculateProfileCompleteness({
        companyName: "Acme Inc",
        industry: "Technology",
        valueProposition: "We provide excellent services",
        services: ["Consulting", "Development"],
        targetMarkets: ["SMB", "Enterprise"],
        keyDifferentiators: ["Expert team", "Fast delivery"],
        contactInfo: {
          email: "contact@acme.com",
        },
      });

      expect(result.isComplete).toBe(true);
      expect(result.completionPercentage).toBe(100);
      expect(result.missingFields).toHaveLength(0);
    });

    it("should handle whitespace-only values as missing", () => {
      const result = calculateProfileCompleteness({
        companyName: "   ",
        industry: "\t\n",
        valueProposition: "",
      });

      expect(result.missingFields).toContain("companyName");
      expect(result.missingFields).toContain("industry");
      expect(result.missingFields).toContain("valueProposition");
    });

    it("should handle empty arrays as missing", () => {
      const result = calculateProfileCompleteness({
        services: [],
        targetMarkets: [],
        keyDifferentiators: [],
      });

      expect(result.missingFields).toContain("services");
      expect(result.missingFields).toContain("targetMarkets");
      expect(result.missingFields).toContain("keyDifferentiators");
    });

    it("should require email in contactInfo", () => {
      const result = calculateProfileCompleteness({
        contactInfo: {
          phone: "555-1234",
          website: "https://example.com",
        },
      });

      expect(result.missingFields).toContain("contactInfo");
    });
  });

  describe("validateProfileData", () => {
    const validProfile = {
      companyName: "Acme Inc",
      industry: "Technology",
      valueProposition:
        "We provide excellent services that help businesses grow and succeed in the digital age.",
      services: ["Consulting", "Development"],
      targetMarkets: ["SMB", "Enterprise"],
      keyDifferentiators: ["Expert team"],
    };

    it("should return valid for complete valid data", () => {
      const result = validateProfileData(validProfile);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should require company name", () => {
      const result = validateProfileData({
        ...validProfile,
        companyName: "",
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Company name is required");
    });

    it("should enforce company name max length", () => {
      const result = validateProfileData({
        ...validProfile,
        companyName: "A".repeat(101),
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        `Company name must be less than ${PROFILE_CONSTRAINTS.COMPANY_NAME_MAX_LENGTH} characters`
      );
    });

    it("should require industry", () => {
      const result = validateProfileData({
        ...validProfile,
        industry: "   ",
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Industry is required");
    });

    it("should enforce value proposition minimum length", () => {
      const result = validateProfileData({
        ...validProfile,
        valueProposition: "Too short",
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        `Value proposition should be at least ${PROFILE_CONSTRAINTS.VALUE_PROPOSITION_MIN_LENGTH} characters`
      );
    });

    it("should enforce value proposition maximum length", () => {
      const result = validateProfileData({
        ...validProfile,
        valueProposition: "X".repeat(501),
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        `Value proposition must be less than ${PROFILE_CONSTRAINTS.VALUE_PROPOSITION_MAX_LENGTH} characters`
      );
    });

    it("should require at least one service", () => {
      const result = validateProfileData({
        ...validProfile,
        services: [],
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("At least one service is required");
    });

    it("should enforce maximum services limit", () => {
      const result = validateProfileData({
        ...validProfile,
        services: Array(21).fill("Service"),
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        `Maximum ${PROFILE_CONSTRAINTS.MAX_SERVICES} services allowed`
      );
    });

    it("should require at least one target market", () => {
      const result = validateProfileData({
        ...validProfile,
        targetMarkets: [],
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("At least one target market is required");
    });

    it("should enforce maximum target markets limit", () => {
      const result = validateProfileData({
        ...validProfile,
        targetMarkets: Array(16).fill("Market"),
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        `Maximum ${PROFILE_CONSTRAINTS.MAX_TARGET_MARKETS} target markets allowed`
      );
    });

    it("should require at least one key differentiator", () => {
      const result = validateProfileData({
        ...validProfile,
        keyDifferentiators: [],
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "At least one key differentiator is required"
      );
    });

    it("should enforce maximum differentiators limit", () => {
      const result = validateProfileData({
        ...validProfile,
        keyDifferentiators: Array(11).fill("Diff"),
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        `Maximum ${PROFILE_CONSTRAINTS.MAX_DIFFERENTIATORS} key differentiators allowed`
      );
    });

    it("should accumulate multiple errors", () => {
      const result = validateProfileData({
        companyName: "",
        industry: "",
        valueProposition: "",
        services: [],
        targetMarkets: [],
        keyDifferentiators: [],
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe("isProfileComplete", () => {
    const completeProfile = {
      companyName: "Acme Inc",
      industry: "Technology",
      valueProposition:
        "We provide excellent services that help businesses grow and succeed in the digital age.",
      services: ["Consulting"],
      targetMarkets: ["SMB"],
      keyDifferentiators: ["Expert team"],
      contactInfo: {
        email: "contact@acme.com",
      },
    };

    it("should return true for complete profile", () => {
      expect(isProfileComplete(completeProfile)).toBe(true);
    });

    it("should return false without company name", () => {
      expect(
        isProfileComplete({
          ...completeProfile,
          companyName: "",
        })
      ).toBe(false);
    });

    it("should return false without industry", () => {
      expect(
        isProfileComplete({
          ...completeProfile,
          industry: undefined,
        })
      ).toBe(false);
    });

    it("should return false when value proposition is too short", () => {
      expect(
        isProfileComplete({
          ...completeProfile,
          valueProposition: "Too short",
        })
      ).toBe(false);
    });

    it("should return false without services", () => {
      expect(
        isProfileComplete({
          ...completeProfile,
          services: [],
        })
      ).toBe(false);
    });

    it("should return false without email but use fallback", () => {
      expect(
        isProfileComplete(
          {
            ...completeProfile,
            contactInfo: { email: "" },
          },
          "fallback@example.com"
        )
      ).toBe(true);
    });

    it("should return false without any email", () => {
      expect(
        isProfileComplete({
          ...completeProfile,
          contactInfo: { email: "" },
        })
      ).toBe(false);
    });

    it("should use profile email over fallback", () => {
      expect(
        isProfileComplete(
          {
            ...completeProfile,
            contactInfo: { email: "profile@example.com" },
          },
          "fallback@example.com"
        )
      ).toBe(true);
    });
  });

  describe("mergeProfileData", () => {
    const existingProfile = {
      companyName: "Existing Corp",
      industry: "Finance",
      valueProposition: "Existing value prop",
      services: ["Service A", "Service B"],
      targetMarkets: ["Market A"],
      keyDifferentiators: ["Diff A"],
      contactInfo: {
        email: "existing@example.com",
        phone: "555-0001",
      },
    };

    it("should prefer incoming values for scalar fields", () => {
      const incoming = {
        companyName: "New Corp",
        industry: "Technology",
      };

      const result = mergeProfileData(existingProfile, incoming);

      expect(result.companyName).toBe("New Corp");
      expect(result.industry).toBe("Technology");
    });

    it("should fall back to existing values when incoming is empty", () => {
      const incoming = {
        companyName: "",
        industry: null,
      };

      const result = mergeProfileData(existingProfile, incoming);

      expect(result.companyName).toBe("Existing Corp");
      expect(result.industry).toBe("Finance");
    });

    it("should merge and deduplicate services", () => {
      const incoming = {
        services: ["Service B", "Service C"],
      };

      const result = mergeProfileData(existingProfile, incoming);

      expect(result.services).toContain("Service A");
      expect(result.services).toContain("Service B");
      expect(result.services).toContain("Service C");
      expect(result.services?.filter((s) => s === "Service B")).toHaveLength(1);
    });

    it("should merge and deduplicate target markets", () => {
      const incoming = {
        targetMarkets: ["Market A", "Market B"],
      };

      const result = mergeProfileData(existingProfile, incoming);

      expect(result.targetMarkets).toContain("Market A");
      expect(result.targetMarkets).toContain("Market B");
      expect(
        result.targetMarkets?.filter((m) => m === "Market A")
      ).toHaveLength(1);
    });

    it("should merge contact info preferring incoming", () => {
      const incoming = {
        contactInfo: {
          email: "new@example.com",
          website: "https://new.example.com",
        },
      };

      const result = mergeProfileData(existingProfile, incoming);

      expect(result.contactInfo?.email).toBe("new@example.com");
      expect(result.contactInfo?.phone).toBe("555-0001"); // From existing
      expect(result.contactInfo?.website).toBe("https://new.example.com");
    });

    it("should preserve an existing signature when incoming contact info omits it", () => {
      const existing = {
        ...existingProfile,
        contactInfo: {
          ...existingProfile.contactInfo,
          signature: "Best regards,\nExisting Sender",
        },
      };

      const result = mergeProfileData(existing, {
        contactInfo: {
          email: "updated@example.com",
        },
      });

      expect(result.contactInfo?.email).toBe("updated@example.com");
      expect(result.contactInfo?.signature).toBe(
        "Best regards,\nExisting Sender",
      );
    });

    it("should allow an incoming signature to explicitly clear the existing one", () => {
      const existing = {
        ...existingProfile,
        contactInfo: {
          ...existingProfile.contactInfo,
          signature: "Best regards,\nExisting Sender",
        },
      };

      const result = mergeProfileData(existing, {
        contactInfo: {
          signature: "",
        },
      });

      expect(result.contactInfo?.signature).toBe("");
    });

    it("should handle empty existing profile", () => {
      const incoming = {
        companyName: "New Corp",
        services: ["Service X"],
      };

      const result = mergeProfileData({}, incoming);

      expect(result.companyName).toBe("New Corp");
      expect(result.services).toEqual(["Service X"]);
    });

    it("should filter out empty strings from merged arrays", () => {
      const incoming = {
        services: ["", "  ", "Valid Service"],
      };

      const result = mergeProfileData({ services: ["Existing"] }, incoming);

      expect(result.services).toContain("Existing");
      expect(result.services).toContain("Valid Service");
      expect(result.services).not.toContain("");
      expect(result.services).not.toContain("  ");
    });

    it("should preserve existing case studies", () => {
      const existing = {
        ...existingProfile,
        caseStudies: [
          { title: "Case 1", client: "Client A", results: "Good results" },
        ],
      };
      const incoming = {
        caseStudies: [
          { title: "Case 2", client: "Client B", results: "Better results" },
        ],
      };

      const result = mergeProfileData(existing, incoming);

      // Case studies from existing are preserved (not merged from import)
      expect(result.caseStudies).toEqual(existing.caseStudies);
    });
  });
});
