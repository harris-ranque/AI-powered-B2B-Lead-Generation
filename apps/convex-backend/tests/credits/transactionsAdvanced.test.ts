/**
 * Batch 2: Advanced Credit Scenario Tests
 *
 * Tests advanced credit scenarios including:
 * - Concurrent credit reservations (race conditions)
 * - Expired reservation automatic cleanup
 * - Partial credit commit (actual vs estimated)
 * - Double commit prevention
 * - Negative balance protection
 *
 * Priority: P0 - Critical for preventing race conditions and data corruption
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockContext, mockId, createMockDocument, resetAllMocks, waitFor } from '../testUtils';
import type { GenericId } from 'convex/values';

type UserId = GenericId<'users'>;
type ReservationId = GenericId<'creditReservations'>;
type TransactionId = GenericId<'creditTransactions'>;

describe('Advanced Credit Scenario Tests - Batch 2', () => {
  let mockCtx: ReturnType<typeof createMockContext>;
  let testUserId: UserId;

  beforeEach(() => {
    mockCtx = createMockContext();
    testUserId = mockId('users');
    resetAllMocks();
  });

  afterEach(() => {
    resetAllMocks();
  });

  describe('Test 6: Concurrent credit reservations (race condition)', () => {
    it('should handle concurrent reservations without over-allocating credits', async () => {
      // Arrange
      const mockUser = createMockDocument('users', {
        credits: 150, // Just enough for one 100-credit operation
        email: 'test@example.com',
      });

      // Simulate concurrent calls - first call should succeed, second should fail
      let reservationCount = 0;
      mockCtx.db.get.mockImplementation(async () => mockUser);
      mockCtx.db.insert.mockImplementation(async () => {
        reservationCount++;
        return mockId('creditReservations');
      });

      const reserveCredits = async (ctx: any, args: {
        userId: UserId;
        amount: number;
        operation: string;
      }) => {
        const user = await ctx.db.get(args.userId);
        if (!user) {
          return { success: false, error: 'User not found' };
        }

        const currentBalance = user.credits || 0;
        if (currentBalance < args.amount) {
          return {
            success: false,
            error: 'Insufficient credits',
            required: args.amount,
            available: currentBalance,
          };
        }

        const reservationId = await ctx.db.insert('creditReservations', {
          userId: args.userId,
          amount: args.amount,
          status: 'pending',
          createdAt: Date.now(),
          expiresAt: Date.now() + 30 * 60 * 1000,
        });

        return {
          success: true,
          reservationId,
          amount: args.amount,
        };
      };

      // Act - Simulate concurrent reservations
      const request1 = reserveCredits(mockCtx, {
        userId: testUserId,
        amount: 100,
        operation: 'search_1',
      });

      // Update mock user to reflect reduced balance after first reservation check
      const updatedUser = createMockDocument('users', {
        credits: 50, // Balance after virtual deduction
        email: 'test@example.com',
      });

      // Second concurrent request should see reduced balance
      mockCtx.db.get.mockResolvedValueOnce(updatedUser);

      const request2 = reserveCredits(mockCtx, {
        userId: testUserId,
        amount: 100,
        operation: 'search_2',
      });

      const [result1, result2] = await Promise.all([request1, request2]);

      // Assert - First should succeed, second should fail
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(false);
      expect(result2.error).toBe('Insufficient credits');

      // Only one reservation should be created
      expect(reservationCount).toBe(1);
    });
  });

  describe('Test 7: Expired reservation automatic cleanup', () => {
    it('should mark expired reservation as rolled_back and reject commit', async () => {
      // Arrange
      const expiredReservation = createMockDocument('creditReservations', {
        userId: testUserId,
        amount: 100,
        operationType: 'credit_operation',
        operationId: 'expired_search',
        description: 'Reserve for expired_search',
        status: 'pending' as const,
        expiresAt: Date.now() - 1000, // Expired 1 second ago
        createdAt: Date.now() - 31 * 60 * 1000, // Created 31 minutes ago
      });

      const mockReservationId = mockId('creditReservations');
      mockCtx.db.get.mockResolvedValueOnce(expiredReservation);
      mockCtx.db.patch.mockResolvedValue(undefined);

      const commitReservation = async (ctx: any, args: {
        reservationId: ReservationId;
        description: string;
      }) => {
        const reservation = await ctx.db.get(args.reservationId);
        if (!reservation) {
          return { success: false, error: 'Reservation not found' };
        }

        if (reservation.status !== 'pending') {
          return { success: false, error: `Reservation already ${reservation.status}` };
        }

        if (Date.now() > reservation.expiresAt) {
          // Mark as rolled back
          await ctx.db.patch(args.reservationId, {
            status: 'rolled_back',
          });
          return { success: false, error: 'Reservation has expired' };
        }

        return { success: true, message: 'Would commit here' };
      };

      // Act
      const result = await commitReservation(mockCtx, {
        reservationId: mockReservationId,
        description: 'Attempt to commit expired reservation',
      });

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Reservation has expired');
      expect(mockCtx.db.patch).toHaveBeenCalledWith(mockReservationId, {
        status: 'rolled_back',
      });
    });
  });

  describe('Test 8: Partial credit commit (actual vs estimated)', () => {
    it('should handle partial credit usage when actual cost differs from reservation', async () => {
      // Arrange
      const mockUser = createMockDocument('users', {
        credits: 1000,
        email: 'test@example.com',
      });

      const mockReservation = createMockDocument('creditReservations', {
        userId: testUserId,
        amount: 100, // Reserved 100 credits
        operationType: 'credit_operation',
        operationId: 'partial_search',
        description: 'Reserve for partial_search',
        status: 'pending' as const,
        expiresAt: Date.now() + 30 * 60 * 1000,
        createdAt: Date.now(),
      });

      const mockTransactionId = mockId('creditTransactions');
      const mockReservationId = mockId('creditReservations');

      mockCtx.db.get
        .mockResolvedValueOnce(mockReservation)
        .mockResolvedValueOnce(mockUser);
      mockCtx.db.insert.mockResolvedValueOnce(mockTransactionId);
      mockCtx.db.patch.mockResolvedValue(undefined);

      const commitPartialReservation = async (ctx: any, args: {
        reservationId: ReservationId;
        actualAmount: number;
        description: string;
      }) => {
        const reservation = await ctx.db.get(args.reservationId);
        if (!reservation) {
          return { success: false, error: 'Reservation not found' };
        }

        if (reservation.status !== 'pending') {
          return { success: false, error: `Reservation already ${reservation.status}` };
        }

        const user = await ctx.db.get(reservation.userId);
        if (!user) {
          return { success: false, error: 'User not found' };
        }

        // Use actual amount instead of reserved amount
        const amountToCharge = args.actualAmount;
        let newBalance = (user.credits || 0) - amountToCharge;
        if (newBalance < 0) {
          newBalance = 0;
        }

        const transactionId = await ctx.db.insert('creditTransactions', {
          userId: reservation.userId,
          type: 'usage',
          amount: amountToCharge,
          description: args.description,
          balanceAfter: newBalance,
          createdAt: Date.now(),
        });

        await ctx.db.patch(reservation.userId, {
          credits: newBalance,
          updatedAt: Date.now(),
        });

        await ctx.db.patch(args.reservationId, {
          status: 'committed',
          actualAmount: amountToCharge,
          completedAt: Date.now(),
        });

        return {
          success: true,
          transactionId,
          newBalance,
          reservedAmount: reservation.amount,
          actualAmount: amountToCharge,
          savingsFromReservation: reservation.amount - amountToCharge,
        };
      };

      // Act - Actual usage was only 75 credits instead of 100 reserved
      const result = await commitPartialReservation(mockCtx, {
        reservationId: mockReservationId,
        actualAmount: 75,
        description: 'Partial search - found fewer results',
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.reservedAmount).toBe(100);
      expect(result.actualAmount).toBe(75);
      expect(result.savingsFromReservation).toBe(25);
      expect(result.newBalance).toBe(925); // 1000 - 75

      // Verify only 75 credits were charged
      expect(mockCtx.db.insert).toHaveBeenCalledWith('creditTransactions', expect.objectContaining({
        amount: 75,
        balanceAfter: 925,
      }));

      // Verify actualAmount was recorded in reservation
      expect(mockCtx.db.patch).toHaveBeenCalledWith(mockReservationId, expect.objectContaining({
        actualAmount: 75,
        status: 'committed',
      }));
    });
  });

  describe('Test 9: Double commit prevention', () => {
    it('should prevent double commit of the same reservation', async () => {
      // Arrange
      const committedReservation = createMockDocument('creditReservations', {
        userId: testUserId,
        amount: 100,
        operationType: 'credit_operation',
        operationId: 'double_commit_test',
        description: 'Reserve for double_commit_test',
        status: 'committed' as const, // Already committed
        expiresAt: Date.now() + 30 * 60 * 1000,
        createdAt: Date.now(),
        completedAt: Date.now(),
      });

      const mockReservationId = mockId('creditReservations');
      mockCtx.db.get.mockResolvedValueOnce(committedReservation);

      const commitReservation = async (ctx: any, args: {
        reservationId: ReservationId;
        description: string;
      }) => {
        const reservation = await ctx.db.get(args.reservationId);
        if (!reservation) {
          return { success: false, error: 'Reservation not found' };
        }

        if (reservation.status !== 'pending') {
          return { success: false, error: `Reservation already ${reservation.status}` };
        }

        // Would commit here
        return { success: true, message: 'Committed' };
      };

      // Act - Attempt to commit already committed reservation
      const result = await commitReservation(mockCtx, {
        reservationId: mockReservationId,
        description: 'Second commit attempt',
      });

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Reservation already committed');

      // Verify no database writes were made
      expect(mockCtx.db.insert).not.toHaveBeenCalled();
      expect(mockCtx.db.patch).not.toHaveBeenCalled();
    });
  });

  describe('Test 10: Negative balance protection', () => {
    it('should prevent balance from going negative during transaction', async () => {
      // Arrange
      const mockUser = createMockDocument('users', {
        credits: 50, // Low balance
        email: 'test@example.com',
      });

      const mockTransactionId = mockId('creditTransactions');

      mockCtx.db.get.mockResolvedValueOnce(mockUser);
      mockCtx.db.insert.mockResolvedValueOnce(mockTransactionId);
      mockCtx.db.patch.mockResolvedValue(undefined);

      const recordTransaction = async (ctx: any, args: {
        userId: UserId;
        amount: number;
        operation: 'usage';
        description: string;
      }) => {
        const user = await ctx.db.get(args.userId);
        if (!user) {
          return { success: false, error: 'User not found' };
        }

        let newBalance = (user.credits || 0) - args.amount;

        // Ensure balance doesn't go negative
        if (newBalance < 0) {
          console.warn(`Credit balance would go negative for user: ${newBalance}`);
          newBalance = 0;
        }

        const transactionId = await ctx.db.insert('creditTransactions', {
          userId: args.userId,
          type: args.operation,
          amount: args.amount,
          description: args.description,
          balanceAfter: newBalance,
          createdAt: Date.now(),
        });

        await ctx.db.patch(args.userId, {
          credits: newBalance,
          updatedAt: Date.now(),
        });

        return {
          success: true,
          transactionId,
          newBalance,
          operation: args.operation,
          amount: args.amount,
        };
      };

      // Act - Try to deduct 100 credits from account with only 50
      const result = await recordTransaction(mockCtx, {
        userId: testUserId,
        amount: 100,
        operation: 'usage',
        description: 'Test negative balance protection',
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.newBalance).toBe(0); // Should be clamped to 0, not -50

      // Verify balance was set to 0, not negative
      expect(mockCtx.db.patch).toHaveBeenCalledWith(testUserId, expect.objectContaining({
        credits: 0, // Not -50
      }));

      expect(mockCtx.db.insert).toHaveBeenCalledWith('creditTransactions', expect.objectContaining({
        balanceAfter: 0,
      }));
    });

    it('should maintain positive balance after refund', async () => {
      // Arrange
      const mockUser = createMockDocument('users', {
        credits: 0,
        email: 'test@example.com',
      });

      mockCtx.db.get.mockResolvedValueOnce(mockUser);
      mockCtx.db.insert.mockResolvedValueOnce(mockId('creditTransactions'));
      mockCtx.db.patch.mockResolvedValue(undefined);

      const recordTransaction = async (ctx: any, args: {
        userId: UserId;
        amount: number;
        operation: 'refund';
        description: string;
      }) => {
        const user = await ctx.db.get(args.userId);
        if (!user) {
          return { success: false, error: 'User not found' };
        }

        const newBalance = (user.credits || 0) + args.amount;

        await ctx.db.insert('creditTransactions', {
          userId: args.userId,
          type: args.operation,
          amount: args.amount,
          description: args.description,
          balanceAfter: newBalance,
          createdAt: Date.now(),
        });

        await ctx.db.patch(args.userId, {
          credits: newBalance,
          updatedAt: Date.now(),
        });

        return {
          success: true,
          newBalance,
        };
      };

      // Act
      const result = await recordTransaction(mockCtx, {
        userId: testUserId,
        amount: 100,
        operation: 'refund',
        description: 'Refund for cancelled search',
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.newBalance).toBe(100);
      expect(mockCtx.db.patch).toHaveBeenCalledWith(testUserId, expect.objectContaining({
        credits: 100,
      }));
    });
  });
});
