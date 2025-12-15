import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  calculateNewBalance,
  isReservationExpired,
  canCommitReservation,
  calculateReservationExpiry,
  hasSufficientCredits,
  formatCreditAmount,
  validateCreditAmount,
  CREDIT_ADD_OPERATIONS,
  CREDIT_DEDUCT_OPERATIONS,
} from "../../convex/lib/creditLogic";

describe("creditLogic", () => {
  describe("calculateNewBalance", () => {
    describe("purchase operations", () => {
      it("should add credits for purchase", () => {
        const result = calculateNewBalance(100, "purchase", 50);

        expect(result.newBalance).toBe(150);
        expect(result.wasAdjusted).toBe(false);
      });

      it("should add to zero balance", () => {
        const result = calculateNewBalance(0, "purchase", 100);

        expect(result.newBalance).toBe(100);
      });
    });

    describe("usage operations", () => {
      it("should subtract credits for usage", () => {
        const result = calculateNewBalance(100, "usage", 30);

        expect(result.newBalance).toBe(70);
        expect(result.wasAdjusted).toBe(false);
      });

      it("should clamp to zero for negative result", () => {
        const result = calculateNewBalance(10, "usage", 30);

        expect(result.newBalance).toBe(0);
        expect(result.wasAdjusted).toBe(true);
        expect(result.originalCalculation).toBe(-20);
      });

      it("should handle exact balance usage", () => {
        const result = calculateNewBalance(50, "usage", 50);

        expect(result.newBalance).toBe(0);
        expect(result.wasAdjusted).toBe(false);
      });
    });

    describe("refund operations", () => {
      it("should add credits for refund", () => {
        const result = calculateNewBalance(100, "refund", 25);

        expect(result.newBalance).toBe(125);
        expect(result.wasAdjusted).toBe(false);
      });
    });

    describe("bonus operations", () => {
      it("should add credits for bonus", () => {
        const result = calculateNewBalance(100, "bonus", 50);

        expect(result.newBalance).toBe(150);
      });
    });

    describe("rollback operations", () => {
      it("should add credits for rollback", () => {
        const result = calculateNewBalance(50, "rollback", 30);

        expect(result.newBalance).toBe(80);
      });
    });

    describe("edge cases", () => {
      it("should handle zero current balance", () => {
        const result = calculateNewBalance(0, "usage", 10);

        expect(result.newBalance).toBe(0);
        expect(result.wasAdjusted).toBe(true);
      });

      it("should handle negative current balance (treat as zero)", () => {
        const result = calculateNewBalance(-50, "purchase", 100);

        expect(result.newBalance).toBe(100);
      });

      it("should handle zero amount", () => {
        const result = calculateNewBalance(100, "usage", 0);

        expect(result.newBalance).toBe(100);
      });

      it("should handle null/undefined balance", () => {
        const result = calculateNewBalance(null as any, "purchase", 50);

        expect(result.newBalance).toBe(50);
      });

      it("should handle negative amount (treat as positive)", () => {
        const result = calculateNewBalance(100, "usage", -30);

        expect(result.newBalance).toBe(70);
      });
    });
  });

  describe("isReservationExpired", () => {
    it("should return true for past expiration", () => {
      const past = Date.now() - 1000;

      expect(isReservationExpired(past)).toBe(true);
    });

    it("should return false for future expiration", () => {
      const future = Date.now() + 60000;

      expect(isReservationExpired(future)).toBe(false);
    });

    it("should return true for exact current time", () => {
      const now = Date.now();

      expect(isReservationExpired(now, now + 1)).toBe(true);
    });

    it("should accept custom now parameter", () => {
      const expiresAt = 1000;
      const now = 500;

      expect(isReservationExpired(expiresAt, now)).toBe(false);
    });
  });

  describe("canCommitReservation", () => {
    const validReservation = {
      amount: 100,
      status: "pending" as const,
      expiresAt: Date.now() + 60000,
      createdAt: Date.now(),
    };

    it("should allow committing valid pending reservation", () => {
      const result = canCommitReservation(validReservation);

      expect(result.canCommit).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should reject already committed reservation", () => {
      const result = canCommitReservation({
        ...validReservation,
        status: "committed",
      });

      expect(result.canCommit).toBe(false);
      expect(result.reason).toContain("committed");
    });

    it("should reject rolled back reservation", () => {
      const result = canCommitReservation({
        ...validReservation,
        status: "rolled_back",
      });

      expect(result.canCommit).toBe(false);
      expect(result.reason).toContain("rolled_back");
    });

    it("should reject expired reservation", () => {
      const result = canCommitReservation({
        ...validReservation,
        expiresAt: Date.now() - 1000,
      });

      expect(result.canCommit).toBe(false);
      expect(result.reason).toContain("expired");
    });

    it("should accept custom now parameter", () => {
      const reservation = {
        ...validReservation,
        expiresAt: 1000,
      };

      const resultNotExpired = canCommitReservation(reservation, 500);
      expect(resultNotExpired.canCommit).toBe(true);

      const resultExpired = canCommitReservation(reservation, 1500);
      expect(resultExpired.canCommit).toBe(false);
    });
  });

  describe("calculateReservationExpiry", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should default to 30 minutes", () => {
      const now = Date.now();
      const result = calculateReservationExpiry(undefined, now);

      expect(result).toBe(now + 30 * 60 * 1000);
    });

    it("should calculate correct expiry for custom minutes", () => {
      const now = Date.now();
      const result = calculateReservationExpiry(15, now);

      expect(result).toBe(now + 15 * 60 * 1000);
    });

    it("should clamp minimum to 1 minute", () => {
      const now = Date.now();
      const result = calculateReservationExpiry(0, now);

      expect(result).toBe(now + 1 * 60 * 1000);
    });

    it("should clamp maximum to 24 hours", () => {
      const now = Date.now();
      const result = calculateReservationExpiry(2000, now);

      expect(result).toBe(now + 1440 * 60 * 1000);
    });

    it("should handle negative minutes", () => {
      const now = Date.now();
      const result = calculateReservationExpiry(-10, now);

      expect(result).toBe(now + 1 * 60 * 1000);
    });
  });

  describe("hasSufficientCredits", () => {
    it("should return sufficient for balance >= required", () => {
      const result = hasSufficientCredits(100, 50);

      expect(result.sufficient).toBe(true);
      expect(result.deficit).toBe(0);
    });

    it("should return sufficient for exact balance", () => {
      const result = hasSufficientCredits(50, 50);

      expect(result.sufficient).toBe(true);
      expect(result.deficit).toBe(0);
    });

    it("should return insufficient for balance < required", () => {
      const result = hasSufficientCredits(30, 50);

      expect(result.sufficient).toBe(false);
      expect(result.deficit).toBe(20);
    });

    it("should return insufficient for zero balance", () => {
      const result = hasSufficientCredits(0, 50);

      expect(result.sufficient).toBe(false);
      expect(result.deficit).toBe(50);
    });

    it("should handle negative balance (treat as zero)", () => {
      const result = hasSufficientCredits(-50, 30);

      expect(result.sufficient).toBe(false);
      expect(result.deficit).toBe(30);
    });

    it("should handle zero required amount", () => {
      const result = hasSufficientCredits(100, 0);

      expect(result.sufficient).toBe(true);
      expect(result.deficit).toBe(0);
    });

    it("should handle null/undefined values", () => {
      const result = hasSufficientCredits(null as any, undefined as any);

      expect(result.sufficient).toBe(true);
      expect(result.deficit).toBe(0);
    });
  });

  describe("formatCreditAmount", () => {
    it("should format purchase with plus sign", () => {
      expect(formatCreditAmount(50, "purchase")).toBe("+50");
    });

    it("should format usage with minus sign", () => {
      expect(formatCreditAmount(30, "usage")).toBe("-30");
    });

    it("should format refund with plus sign", () => {
      expect(formatCreditAmount(25, "refund")).toBe("+25");
    });

    it("should format bonus with plus sign", () => {
      expect(formatCreditAmount(100, "bonus")).toBe("+100");
    });

    it("should format rollback with plus sign", () => {
      expect(formatCreditAmount(20, "rollback")).toBe("+20");
    });

    it("should handle negative amounts", () => {
      expect(formatCreditAmount(-50, "purchase")).toBe("+50");
      expect(formatCreditAmount(-30, "usage")).toBe("-30");
    });
  });

  describe("validateCreditAmount", () => {
    it("should accept valid positive integer", () => {
      const result = validateCreditAmount(100);

      expect(result.valid).toBe(true);
    });

    it("should reject zero", () => {
      const result = validateCreditAmount(0);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("positive");
    });

    it("should reject negative numbers", () => {
      const result = validateCreditAmount(-50);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("positive");
    });

    it("should reject non-integers", () => {
      const result = validateCreditAmount(10.5);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("whole number");
    });

    it("should reject NaN", () => {
      const result = validateCreditAmount(NaN);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("valid number");
    });

    it("should reject Infinity", () => {
      const result = validateCreditAmount(Infinity);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("valid number");
    });

    it("should reject amounts over 1 million", () => {
      const result = validateCreditAmount(1_000_001);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("maximum");
    });

    it("should accept exactly 1 million", () => {
      const result = validateCreditAmount(1_000_000);

      expect(result.valid).toBe(true);
    });
  });

  describe("operation type arrays", () => {
    it("should include all add operations", () => {
      expect(CREDIT_ADD_OPERATIONS).toContain("purchase");
      expect(CREDIT_ADD_OPERATIONS).toContain("refund");
      expect(CREDIT_ADD_OPERATIONS).toContain("bonus");
      expect(CREDIT_ADD_OPERATIONS).toContain("rollback");
    });

    it("should include all deduct operations", () => {
      expect(CREDIT_DEDUCT_OPERATIONS).toContain("usage");
    });

    it("should not overlap", () => {
      const overlap = CREDIT_ADD_OPERATIONS.filter((op) =>
        CREDIT_DEDUCT_OPERATIONS.includes(op as any)
      );

      expect(overlap).toHaveLength(0);
    });
  });
});
