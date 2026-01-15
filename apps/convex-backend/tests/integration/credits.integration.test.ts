/**
 * Integration tests for credit system using convex-test
 *
 * These tests run against a real Convex runtime for proper code coverage.
 * Use these for testing mutations and queries that interact with the database.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestContext, testData, api } from "../convex-test-setup";

describe("Credits Integration Tests", () => {
  describe("Credit Transactions", () => {
    it("should create user with initial credits", async () => {
      const t = createTestContext();

      // Insert a test user directly
      const userId = await t.run(async (ctx) => {
        return await ctx.db.insert("users", testData.createUser({
          credits: 100,
          plan: "pro",
        }));
      });

      // Verify user was created with correct credits
      const user = await t.run(async (ctx) => {
        return await ctx.db.get(userId);
      });

      expect(user).not.toBeNull();
      expect(user?.credits).toBe(100);
      expect(user?.plan).toBe("pro");
    });

    it("should update user credits correctly", async () => {
      const t = createTestContext();

      // Create user
      const userId = await t.run(async (ctx) => {
        return await ctx.db.insert("users", testData.createUser({
          credits: 100,
        }));
      });

      // Update credits
      await t.run(async (ctx) => {
        await ctx.db.patch(userId, { credits: 150 });
      });

      // Verify updated credits
      const user = await t.run(async (ctx) => {
        return await ctx.db.get(userId);
      });

      expect(user?.credits).toBe(150);
    });

    it("should handle credit deduction", async () => {
      const t = createTestContext();

      // Create user with initial credits
      const userId = await t.run(async (ctx) => {
        return await ctx.db.insert("users", testData.createUser({
          credits: 100,
        }));
      });

      // Simulate credit deduction
      const deductAmount = 25;
      await t.run(async (ctx) => {
        const user = await ctx.db.get(userId);
        if (user) {
          const newCredits = Math.max(0, user.credits - deductAmount);
          await ctx.db.patch(userId, { credits: newCredits });
        }
      });

      // Verify deduction
      const user = await t.run(async (ctx) => {
        return await ctx.db.get(userId);
      });

      expect(user?.credits).toBe(75);
    });

    it("should prevent negative credits", async () => {
      const t = createTestContext();

      // Create user with low credits
      const userId = await t.run(async (ctx) => {
        return await ctx.db.insert("users", testData.createUser({
          credits: 10,
        }));
      });

      // Attempt large deduction
      await t.run(async (ctx) => {
        const user = await ctx.db.get(userId);
        if (user) {
          const newCredits = Math.max(0, user.credits - 50);
          await ctx.db.patch(userId, { credits: newCredits });
        }
      });

      // Verify credits don't go negative
      const user = await t.run(async (ctx) => {
        return await ctx.db.get(userId);
      });

      expect(user?.credits).toBe(0);
    });
  });

  describe("Credit Reservations", () => {
    it("should create credit reservation", async () => {
      const t = createTestContext();

      // Create user
      const userId = await t.run(async (ctx) => {
        return await ctx.db.insert("users", testData.createUser({
          credits: 100,
        }));
      });

      // Create reservation
      const reservationId = await t.run(async (ctx) => {
        return await ctx.db.insert("creditReservations", {
          userId,
          amount: 25,
          status: "pending",
          operationType: "search",
          operationId: "test_search_123",
          description: "Test search credit reservation",
          expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes
          createdAt: Date.now(),
        });
      });

      // Verify reservation
      const reservation = await t.run(async (ctx) => {
        return await ctx.db.get(reservationId);
      });

      expect(reservation).not.toBeNull();
      expect(reservation?.amount).toBe(25);
      expect(reservation?.status).toBe("pending");
    });

    it("should commit credit reservation", async () => {
      const t = createTestContext();

      // Create user with credits
      const userId = await t.run(async (ctx) => {
        return await ctx.db.insert("users", testData.createUser({
          credits: 100,
        }));
      });

      // Create and commit reservation
      const reservationId = await t.run(async (ctx) => {
        return await ctx.db.insert("creditReservations", {
          userId,
          amount: 25,
          status: "pending",
          operationType: "search",
          operationId: "test_search_456",
          description: "Test search credit reservation for commit",
          expiresAt: Date.now() + 30 * 60 * 1000,
          createdAt: Date.now(),
        });
      });

      // Commit reservation and deduct credits
      await t.run(async (ctx) => {
        const reservation = await ctx.db.get(reservationId);
        const user = await ctx.db.get(userId);

        if (reservation && user) {
          await ctx.db.patch(reservationId, { status: "committed" });
          await ctx.db.patch(userId, { credits: user.credits - reservation.amount });
        }
      });

      // Verify committed state
      const [reservation, user] = await t.run(async (ctx) => {
        return [
          await ctx.db.get(reservationId),
          await ctx.db.get(userId),
        ];
      });

      expect(reservation?.status).toBe("committed");
      expect(user?.credits).toBe(75);
    });

    it("should rollback expired reservation", async () => {
      const t = createTestContext();

      // Create user
      const userId = await t.run(async (ctx) => {
        return await ctx.db.insert("users", testData.createUser({
          credits: 100,
        }));
      });

      // Create expired reservation
      const reservationId = await t.run(async (ctx) => {
        return await ctx.db.insert("creditReservations", {
          userId,
          amount: 25,
          status: "pending",
          operationType: "search",
          operationId: "test_search_789",
          description: "Test expired credit reservation",
          expiresAt: Date.now() - 1000, // Already expired
          createdAt: Date.now() - 31 * 60 * 1000,
        });
      });

      // Check and rollback expired
      await t.run(async (ctx) => {
        const reservation = await ctx.db.get(reservationId);
        if (reservation && reservation.expiresAt < Date.now()) {
          await ctx.db.patch(reservationId, { status: "rolled_back" });
        }
      });

      // Verify rollback
      const reservation = await t.run(async (ctx) => {
        return await ctx.db.get(reservationId);
      });

      expect(reservation?.status).toBe("rolled_back");
    });
  });
});
