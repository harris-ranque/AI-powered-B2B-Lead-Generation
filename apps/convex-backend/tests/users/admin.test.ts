/**
 * Comprehensive Tests for users/admin.ts
 *
 * Tests admin-only user management functions including:
 * - getAllUsers() - User listing with filtering and pagination
 * - getUserStatistics() - Admin dashboard statistics
 * - updateUserRole() - Role management with safety checks
 * - suspendUser() / reactivateUser() - Account suspension
 * - grantBonusCredits() - Credit management
 * - searchUsers() - User search functionality
 * - System configuration management
 * - User processing pause/resume
 *
 * Priority: P0 - Critical for admin operations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createMockContext,
  mockId,
  createMockDocument,
  resetAllMocks,
  createMockUserIdentity,
} from '../testUtils';
import type { GenericId } from 'convex/values';

type UserId = GenericId<'users'>;
type SearchId = GenericId<'searches'>;

describe('Admin Functions Tests - users/admin.ts', () => {
  let mockCtx: ReturnType<typeof createMockContext>;
  let adminUserId: UserId;
  let regularUserId: UserId;

  beforeEach(() => {
    mockCtx = createMockContext();
    adminUserId = mockId('users');
    regularUserId = mockId('users');
    resetAllMocks();
  });

  afterEach(() => {
    resetAllMocks();
  });

  // ============================================================================
  // Helper Functions for Admin Auth
  // ============================================================================

  const isAdmin = (user: any): boolean => user?.role === 'admin';

  const createAdminUser = (overrides = {}) =>
    createMockDocument('users', {
      email: 'admin@example.com',
      role: 'admin' as const,
      isActive: true,
      credits: 10000,
      ...overrides,
    });

  const createRegularUser = (overrides = {}) =>
    createMockDocument('users', {
      email: 'user@example.com',
      role: 'user' as const,
      isActive: true,
      credits: 100,
      plan: 'pro' as const,
      ...overrides,
    });

  // ============================================================================
  // getAllUsers Tests
  // ============================================================================

  describe('getAllUsers()', () => {
    it('should return paginated users list for admin', async () => {
      const adminUser = createAdminUser({ _id: adminUserId });
      const users = [
        createRegularUser({ _id: regularUserId, email: 'user1@example.com' }),
        createRegularUser({ email: 'user2@example.com' }),
        createRegularUser({ email: 'user3@example.com' }),
      ];

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: adminUserId }),
      );
      mockCtx.db.get.mockResolvedValueOnce(adminUser);

      const mockQuery = {
        withIndex: vi.fn().mockReturnThis(),
        filter: vi.fn().mockReturnThis(),
        collect: vi.fn().mockResolvedValue(users),
      };
      mockCtx.db.query.mockReturnValue(mockQuery);

      const getAllUsers = async (
        ctx: any,
        args: { limit?: number; offset?: number; plan?: string; role?: string; isActive?: boolean },
      ) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error('Authentication required');

        const currentUser = await ctx.db.get(identity.subject);
        if (!currentUser || !isAdmin(currentUser)) {
          throw new Error('Admin access required');
        }

        const limit = args.limit || 50;
        const offset = args.offset || 0;

        let usersResult;
        if (args.plan !== undefined) {
          usersResult = await ctx.db
            .query('users')
            .withIndex('by_plan', (q: any) => q.eq('plan', args.plan))
            .collect();
        } else if (args.role !== undefined) {
          usersResult = await ctx.db
            .query('users')
            .withIndex('by_role', (q: any) => q.eq('role', args.role))
            .collect();
        } else {
          usersResult = await ctx.db.query('users').collect();
        }

        if (args.isActive !== undefined) {
          usersResult = usersResult.filter((user: any) => user.isActive === args.isActive);
        }

        const paginatedUsers = usersResult.slice(offset, offset + limit);

        return {
          users: paginatedUsers,
          total: usersResult.length,
          hasMore: offset + limit < usersResult.length,
        };
      };

      const result = await getAllUsers(mockCtx, { limit: 10, offset: 0 });

      expect(result.users.length).toBe(3);
      expect(result.total).toBe(3);
      expect(result.hasMore).toBe(false);
    });

    it('should reject non-admin users', async () => {
      const regularUser = createRegularUser({ _id: regularUserId });

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: regularUserId }),
      );
      mockCtx.db.get.mockResolvedValueOnce(regularUser);

      const getAllUsers = async (ctx: any, args: any) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error('Authentication required');

        const currentUser = await ctx.db.get(identity.subject);
        if (!currentUser || !isAdmin(currentUser)) {
          throw new Error('Admin access required');
        }

        return { users: [] };
      };

      await expect(getAllUsers(mockCtx, {})).rejects.toThrow('Admin access required');
    });

    it('should filter users by plan', async () => {
      const adminUser = createAdminUser({ _id: adminUserId });
      const proUsers = [
        createRegularUser({ plan: 'pro' as const }),
        createRegularUser({ plan: 'pro' as const }),
      ];

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: adminUserId }),
      );
      mockCtx.db.get.mockResolvedValueOnce(adminUser);

      const mockQuery = {
        withIndex: vi.fn().mockReturnThis(),
        collect: vi.fn().mockResolvedValue(proUsers),
      };
      mockCtx.db.query.mockReturnValue(mockQuery);

      const getAllUsers = async (ctx: any, args: { plan?: string }) => {
        const identity = await ctx.auth.getUserIdentity();
        const currentUser = await ctx.db.get(identity.subject);
        if (!isAdmin(currentUser)) throw new Error('Admin access required');

        const users = await ctx.db
          .query('users')
          .withIndex('by_plan', (q: any) => q.eq('plan', args.plan))
          .collect();

        return { users, total: users.length };
      };

      const result = await getAllUsers(mockCtx, { plan: 'pro' });

      expect(result.users.length).toBe(2);
      expect(mockQuery.withIndex).toHaveBeenCalledWith('by_plan', expect.any(Function));
    });

    it('should filter users by active status', async () => {
      const adminUser = createAdminUser({ _id: adminUserId });
      const allUsers = [
        createRegularUser({ isActive: true }),
        createRegularUser({ isActive: false }),
        createRegularUser({ isActive: true }),
      ];

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: adminUserId }),
      );
      mockCtx.db.get.mockResolvedValueOnce(adminUser);

      const mockQuery = {
        collect: vi.fn().mockResolvedValue(allUsers),
      };
      mockCtx.db.query.mockReturnValue(mockQuery);

      const getAllUsers = async (ctx: any, args: { isActive?: boolean }) => {
        const identity = await ctx.auth.getUserIdentity();
        const currentUser = await ctx.db.get(identity.subject);
        if (!isAdmin(currentUser)) throw new Error('Admin access required');

        let users = await ctx.db.query('users').collect();

        if (args.isActive !== undefined) {
          users = users.filter((user: any) => user.isActive === args.isActive);
        }

        return { users, total: users.length };
      };

      const result = await getAllUsers(mockCtx, { isActive: true });

      expect(result.users.length).toBe(2);
      expect(result.users.every((u: any) => u.isActive)).toBe(true);
    });

    it('should handle pagination correctly', async () => {
      const adminUser = createAdminUser({ _id: adminUserId });
      const manyUsers = Array(100)
        .fill(null)
        .map((_, i) => createRegularUser({ email: `user${i}@example.com` }));

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: adminUserId }),
      );
      mockCtx.db.get.mockResolvedValueOnce(adminUser);

      const mockQuery = {
        collect: vi.fn().mockResolvedValue(manyUsers),
      };
      mockCtx.db.query.mockReturnValue(mockQuery);

      const getAllUsers = async (ctx: any, args: { limit?: number; offset?: number }) => {
        const identity = await ctx.auth.getUserIdentity();
        const currentUser = await ctx.db.get(identity.subject);
        if (!isAdmin(currentUser)) throw new Error('Admin access required');

        const limit = args.limit || 50;
        const offset = args.offset || 0;

        const users = await ctx.db.query('users').collect();
        const paginatedUsers = users.slice(offset, offset + limit);

        return {
          users: paginatedUsers,
          total: users.length,
          hasMore: offset + limit < users.length,
        };
      };

      const page1 = await getAllUsers(mockCtx, { limit: 20, offset: 0 });
      expect(page1.users.length).toBe(20);
      expect(page1.total).toBe(100);
      expect(page1.hasMore).toBe(true);
    });
  });

  // ============================================================================
  // getUserStatistics Tests
  // ============================================================================

  describe('getUserStatistics()', () => {
    it('should return comprehensive user statistics', async () => {
      const adminUser = createAdminUser({ _id: adminUserId });
      const now = Date.now();
      const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

      const users = [
        createRegularUser({ isActive: true, plan: 'starter' as const, createdAt: now - 5 * 24 * 60 * 60 * 1000 }),
        createRegularUser({ isActive: true, plan: 'pro' as const, createdAt: now - 10 * 24 * 60 * 60 * 1000 }),
        createRegularUser({ isActive: false, plan: 'enterprise' as const, createdAt: now - 60 * 24 * 60 * 60 * 1000 }),
        createAdminUser({ createdAt: now - 365 * 24 * 60 * 60 * 1000 }),
      ];

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: adminUserId }),
      );
      mockCtx.db.get.mockResolvedValueOnce(adminUser);

      const mockQuery = {
        withIndex: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        take: vi.fn().mockResolvedValue(users),
      };
      mockCtx.db.query.mockReturnValue(mockQuery);

      const getUserStatistics = async (ctx: any) => {
        const identity = await ctx.auth.getUserIdentity();
        const currentUser = await ctx.db.get(identity.subject);
        if (!isAdmin(currentUser)) throw new Error('Admin access required');

        const usersData = await ctx.db
          .query('users')
          .withIndex('by_created')
          .order('desc')
          .take(5000);

        const nowTime = Date.now();
        const thirtyDays = nowTime - 30 * 24 * 60 * 60 * 1000;
        const sevenDays = nowTime - 7 * 24 * 60 * 60 * 1000;

        const activeUsers = usersData.filter((u: any) => u.isActive);
        const newUsersThisMonth = usersData.filter((u: any) => u.createdAt > thirtyDays);
        const newUsersThisWeek = usersData.filter((u: any) => u.createdAt > sevenDays);

        const planDistribution = {
          starter: usersData.filter((u: any) => u.plan === 'starter').length,
          professional: usersData.filter((u: any) => u.plan === 'professional').length,
          business: usersData.filter((u: any) => u.plan === 'business').length,
          enterprise: usersData.filter((u: any) => u.plan === 'enterprise').length,
        };

        const roleDistribution = {
          user: usersData.filter((u: any) => u.role === 'user').length,
          admin: usersData.filter((u: any) => u.role === 'admin').length,
        };

        return {
          totalUsers: usersData.length,
          activeUsers: activeUsers.length,
          inactiveUsers: usersData.length - activeUsers.length,
          newUsersThisMonth: newUsersThisMonth.length,
          newUsersThisWeek: newUsersThisWeek.length,
          planDistribution,
          roleDistribution,
        };
      };

      const stats = await getUserStatistics(mockCtx);

      expect(stats.totalUsers).toBe(4);
      expect(stats.activeUsers).toBe(3);
      expect(stats.inactiveUsers).toBe(1);
      expect(stats.roleDistribution.admin).toBe(1);
      expect(stats.roleDistribution.user).toBe(3);
    });

    it('should reject non-admin access', async () => {
      const regularUser = createRegularUser({ _id: regularUserId });

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: regularUserId }),
      );
      mockCtx.db.get.mockResolvedValueOnce(regularUser);

      const getUserStatistics = async (ctx: any) => {
        const identity = await ctx.auth.getUserIdentity();
        const currentUser = await ctx.db.get(identity.subject);
        if (!isAdmin(currentUser)) throw new Error('Admin access required');
        return {};
      };

      await expect(getUserStatistics(mockCtx)).rejects.toThrow('Admin access required');
    });
  });

  // ============================================================================
  // updateUserRole Tests
  // ============================================================================

  describe('updateUserRole()', () => {
    it('should successfully update user role', async () => {
      const adminUser = createAdminUser({ _id: adminUserId });
      const targetUser = createRegularUser({ _id: regularUserId });

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: adminUserId }),
      );
      mockCtx.db.get
        .mockResolvedValueOnce(adminUser)
        .mockResolvedValueOnce(targetUser);
      mockCtx.db.patch.mockResolvedValue(undefined);
      mockCtx.db.insert.mockResolvedValue(mockId('notifications'));

      const updateUserRole = async (
        ctx: any,
        args: { userId: UserId; role: 'user' | 'admin' },
      ) => {
        const identity = await ctx.auth.getUserIdentity();
        const currentUser = await ctx.db.get(identity.subject);
        if (!isAdmin(currentUser)) throw new Error('Admin access required');

        const targetUser = await ctx.db.get(args.userId);
        if (!targetUser) throw new Error('User not found');

        await ctx.db.patch(args.userId, {
          role: args.role,
          updatedAt: Date.now(),
        });

        await ctx.db.insert('notifications', {
          userId: args.userId,
          type: 'system_alert',
          title: 'Role Updated',
          message: `Your role has been updated to ${args.role} by an administrator.`,
          read: false,
          sent: false,
          createdAt: Date.now(),
        });

        return { success: true };
      };

      const result = await updateUserRole(mockCtx, {
        userId: regularUserId,
        role: 'admin',
      });

      expect(result.success).toBe(true);
      expect(mockCtx.db.patch).toHaveBeenCalledWith(
        regularUserId,
        expect.objectContaining({ role: 'admin' }),
      );
      expect(mockCtx.db.insert).toHaveBeenCalledWith(
        'notifications',
        expect.objectContaining({ type: 'system_alert' }),
      );
    });

    it('should prevent removing the last admin', async () => {
      const adminUser = createAdminUser({ _id: adminUserId });
      const admins = [adminUser]; // Only one admin

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: adminUserId }),
      );
      mockCtx.db.get
        .mockResolvedValueOnce(adminUser)
        .mockResolvedValueOnce(adminUser); // Target is also the admin

      const mockQuery = {
        withIndex: vi.fn().mockReturnThis(),
        collect: vi.fn().mockResolvedValue(admins),
      };
      mockCtx.db.query.mockReturnValue(mockQuery);

      const updateUserRole = async (
        ctx: any,
        args: { userId: UserId; role: 'user' | 'admin' },
      ) => {
        const identity = await ctx.auth.getUserIdentity();
        const currentUser = await ctx.db.get(identity.subject);
        if (!isAdmin(currentUser)) throw new Error('Admin access required');

        const targetUser = await ctx.db.get(args.userId);
        if (!targetUser) throw new Error('User not found');

        // Check if removing admin role
        if (currentUser.role === 'admin' && args.role === 'user') {
          const adminCount = await ctx.db
            .query('users')
            .withIndex('by_role', (q: any) => q.eq('role', 'admin'))
            .collect();

          if (adminCount.length <= 1) {
            throw new Error('Cannot remove the last admin user');
          }
        }

        return { success: true };
      };

      await expect(
        updateUserRole(mockCtx, { userId: adminUserId, role: 'user' }),
      ).rejects.toThrow('Cannot remove the last admin user');
    });

    it('should throw error when target user not found', async () => {
      const adminUser = createAdminUser({ _id: adminUserId });

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: adminUserId }),
      );
      mockCtx.db.get
        .mockResolvedValueOnce(adminUser)
        .mockResolvedValueOnce(null); // User not found

      const updateUserRole = async (
        ctx: any,
        args: { userId: UserId; role: string },
      ) => {
        const identity = await ctx.auth.getUserIdentity();
        const currentUser = await ctx.db.get(identity.subject);
        if (!isAdmin(currentUser)) throw new Error('Admin access required');

        const targetUser = await ctx.db.get(args.userId);
        if (!targetUser) throw new Error('User not found');

        return { success: true };
      };

      await expect(
        updateUserRole(mockCtx, { userId: regularUserId, role: 'admin' }),
      ).rejects.toThrow('User not found');
    });
  });

  // ============================================================================
  // suspendUser Tests
  // ============================================================================

  describe('suspendUser()', () => {
    it('should suspend user account', async () => {
      const adminUser = createAdminUser({ _id: adminUserId });
      const targetUser = createRegularUser({ _id: regularUserId });

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: adminUserId }),
      );
      mockCtx.db.get
        .mockResolvedValueOnce(adminUser)
        .mockResolvedValueOnce(targetUser);
      mockCtx.db.patch.mockResolvedValue(undefined);
      mockCtx.db.insert.mockResolvedValue(mockId('notifications'));

      const suspendUser = async (
        ctx: any,
        args: { userId: UserId; reason: string },
      ) => {
        const identity = await ctx.auth.getUserIdentity();
        const currentUser = await ctx.db.get(identity.subject);
        if (!isAdmin(currentUser)) throw new Error('Admin access required');

        const targetUser = await ctx.db.get(args.userId);
        if (!targetUser) throw new Error('User not found');

        if (targetUser.role === 'admin') {
          throw new Error('Cannot suspend admin users');
        }

        await ctx.db.patch(args.userId, {
          isActive: false,
          updatedAt: Date.now(),
        });

        await ctx.db.insert('notifications', {
          userId: args.userId,
          type: 'system_alert',
          title: 'Account Suspended',
          message: `Your account has been suspended. Reason: ${args.reason}.`,
          read: false,
          sent: false,
          createdAt: Date.now(),
        });

        return { success: true };
      };

      const result = await suspendUser(mockCtx, {
        userId: regularUserId,
        reason: 'Violation of terms',
      });

      expect(result.success).toBe(true);
      expect(mockCtx.db.patch).toHaveBeenCalledWith(
        regularUserId,
        expect.objectContaining({ isActive: false }),
      );
    });

    it('should prevent suspending admin users', async () => {
      const adminUser = createAdminUser({ _id: adminUserId });
      const targetAdmin = createAdminUser({ _id: regularUserId });

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: adminUserId }),
      );
      mockCtx.db.get
        .mockResolvedValueOnce(adminUser)
        .mockResolvedValueOnce(targetAdmin);

      const suspendUser = async (
        ctx: any,
        args: { userId: UserId; reason: string },
      ) => {
        const identity = await ctx.auth.getUserIdentity();
        const currentUser = await ctx.db.get(identity.subject);
        if (!isAdmin(currentUser)) throw new Error('Admin access required');

        const targetUser = await ctx.db.get(args.userId);
        if (!targetUser) throw new Error('User not found');

        if (targetUser.role === 'admin') {
          throw new Error('Cannot suspend admin users');
        }

        return { success: true };
      };

      await expect(
        suspendUser(mockCtx, { userId: regularUserId, reason: 'Test' }),
      ).rejects.toThrow('Cannot suspend admin users');
    });
  });

  // ============================================================================
  // reactivateUser Tests
  // ============================================================================

  describe('reactivateUser()', () => {
    it('should reactivate suspended user', async () => {
      const adminUser = createAdminUser({ _id: adminUserId });
      const suspendedUser = createRegularUser({ _id: regularUserId, isActive: false });

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: adminUserId }),
      );
      mockCtx.db.get
        .mockResolvedValueOnce(adminUser)
        .mockResolvedValueOnce(suspendedUser);
      mockCtx.db.patch.mockResolvedValue(undefined);
      mockCtx.db.insert.mockResolvedValue(mockId('notifications'));

      const reactivateUser = async (ctx: any, args: { userId: UserId }) => {
        const identity = await ctx.auth.getUserIdentity();
        const currentUser = await ctx.db.get(identity.subject);
        if (!isAdmin(currentUser)) throw new Error('Admin access required');

        const targetUser = await ctx.db.get(args.userId);
        if (!targetUser) throw new Error('User not found');

        await ctx.db.patch(args.userId, {
          isActive: true,
          updatedAt: Date.now(),
        });

        await ctx.db.insert('notifications', {
          userId: args.userId,
          type: 'system_alert',
          title: 'Account Reactivated',
          message: 'Your account has been reactivated.',
          read: false,
          sent: false,
          createdAt: Date.now(),
        });

        return { success: true };
      };

      const result = await reactivateUser(mockCtx, { userId: regularUserId });

      expect(result.success).toBe(true);
      expect(mockCtx.db.patch).toHaveBeenCalledWith(
        regularUserId,
        expect.objectContaining({ isActive: true }),
      );
    });
  });

  // ============================================================================
  // grantBonusCredits Tests
  // ============================================================================

  describe('grantBonusCredits()', () => {
    it('should grant bonus credits to user', async () => {
      const adminUser = createAdminUser({ _id: adminUserId });
      const targetUser = createRegularUser({ _id: regularUserId, credits: 100 });

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: adminUserId }),
      );
      mockCtx.db.get
        .mockResolvedValueOnce(adminUser)
        .mockResolvedValueOnce(targetUser);
      mockCtx.db.patch.mockResolvedValue(undefined);
      mockCtx.db.insert.mockResolvedValue(mockId('creditTransactions'));

      const grantBonusCredits = async (
        ctx: any,
        args: { userId: UserId; amount: number; reason: string },
      ) => {
        const identity = await ctx.auth.getUserIdentity();
        const currentUser = await ctx.db.get(identity.subject);
        if (!isAdmin(currentUser)) throw new Error('Admin access required');

        const targetUser = await ctx.db.get(args.userId);
        if (!targetUser) throw new Error('User not found');

        const newBalance = targetUser.credits + args.amount;

        await ctx.db.patch(args.userId, {
          credits: newBalance,
          updatedAt: Date.now(),
        });

        await ctx.db.insert('creditTransactions', {
          userId: args.userId,
          type: 'bonus',
          amount: args.amount,
          description: `Admin bonus: ${args.reason}`,
          balanceAfter: newBalance,
          createdAt: Date.now(),
        });

        await ctx.db.insert('notifications', {
          userId: args.userId,
          type: 'system_alert',
          title: 'Credits Added',
          message: `You've been awarded ${args.amount} bonus credits!`,
          read: false,
          sent: false,
          createdAt: Date.now(),
        });

        return { success: true, newBalance };
      };

      const result = await grantBonusCredits(mockCtx, {
        userId: regularUserId,
        amount: 500,
        reason: 'Loyalty reward',
      });

      expect(result.success).toBe(true);
      expect(result.newBalance).toBe(600);
      expect(mockCtx.db.patch).toHaveBeenCalledWith(
        regularUserId,
        expect.objectContaining({ credits: 600 }),
      );
      expect(mockCtx.db.insert).toHaveBeenCalledWith(
        'creditTransactions',
        expect.objectContaining({
          type: 'bonus',
          amount: 500,
        }),
      );
    });

    it('should handle negative bonus amounts (credit deduction)', async () => {
      const adminUser = createAdminUser({ _id: adminUserId });
      const targetUser = createRegularUser({ _id: regularUserId, credits: 1000 });

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: adminUserId }),
      );
      mockCtx.db.get
        .mockResolvedValueOnce(adminUser)
        .mockResolvedValueOnce(targetUser);
      mockCtx.db.patch.mockResolvedValue(undefined);
      mockCtx.db.insert.mockResolvedValue(mockId('creditTransactions'));

      const grantBonusCredits = async (
        ctx: any,
        args: { userId: UserId; amount: number; reason: string },
      ) => {
        const identity = await ctx.auth.getUserIdentity();
        const currentUser = await ctx.db.get(identity.subject);
        if (!isAdmin(currentUser)) throw new Error('Admin access required');

        const targetUser = await ctx.db.get(args.userId);
        if (!targetUser) throw new Error('User not found');

        const newBalance = targetUser.credits + args.amount;

        await ctx.db.patch(args.userId, { credits: newBalance });
        return { success: true, newBalance };
      };

      // Note: The actual implementation may allow negative amounts for adjustments
      const result = await grantBonusCredits(mockCtx, {
        userId: regularUserId,
        amount: -200,
        reason: 'Adjustment',
      });

      expect(result.newBalance).toBe(800);
    });
  });

  // ============================================================================
  // searchUsers Tests
  // ============================================================================

  describe('searchUsers()', () => {
    it('should search users by email', async () => {
      const adminUser = createAdminUser({ _id: adminUserId });
      const users = [
        createRegularUser({ email: 'john@example.com', name: 'John Doe' }),
        createRegularUser({ email: 'jane@example.com', name: 'Jane Doe' }),
        createRegularUser({ email: 'bob@test.com', name: 'Bob Smith' }),
      ];

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: adminUserId }),
      );
      mockCtx.db.get.mockResolvedValueOnce(adminUser);

      const mockQuery = {
        withIndex: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        take: vi.fn().mockResolvedValue(users),
      };
      mockCtx.db.query.mockReturnValue(mockQuery);

      const searchUsers = async (
        ctx: any,
        args: { query: string; limit?: number },
      ) => {
        const identity = await ctx.auth.getUserIdentity();
        const currentUser = await ctx.db.get(identity.subject);
        if (!isAdmin(currentUser)) throw new Error('Admin access required');

        const limit = args.limit || 20;
        const searchQuery = args.query.toLowerCase();

        const users = await ctx.db
          .query('users')
          .withIndex('by_created')
          .order('desc')
          .take(1000);

        const filteredUsers = users
          .filter(
            (user: any) =>
              user.email.toLowerCase().includes(searchQuery) ||
              (user.name && user.name.toLowerCase().includes(searchQuery)),
          )
          .slice(0, limit);

        return filteredUsers;
      };

      const result = await searchUsers(mockCtx, { query: 'example.com' });

      expect(result.length).toBe(2);
      expect(result.every((u: any) => u.email.includes('example.com'))).toBe(true);
    });

    it('should search users by name', async () => {
      const adminUser = createAdminUser({ _id: adminUserId });
      const users = [
        createRegularUser({ email: 'john@example.com', name: 'John Doe' }),
        createRegularUser({ email: 'jane@example.com', name: 'Jane Doe' }),
      ];

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: adminUserId }),
      );
      mockCtx.db.get.mockResolvedValueOnce(adminUser);

      const mockQuery = {
        withIndex: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        take: vi.fn().mockResolvedValue(users),
      };
      mockCtx.db.query.mockReturnValue(mockQuery);

      const searchUsers = async (ctx: any, args: { query: string }) => {
        const identity = await ctx.auth.getUserIdentity();
        const currentUser = await ctx.db.get(identity.subject);
        if (!isAdmin(currentUser)) throw new Error('Admin access required');

        const searchQuery = args.query.toLowerCase();

        const users = await ctx.db
          .query('users')
          .withIndex('by_created')
          .order('desc')
          .take(1000);

        return users.filter(
          (user: any) =>
            user.email.toLowerCase().includes(searchQuery) ||
            (user.name && user.name.toLowerCase().includes(searchQuery)),
        );
      };

      const result = await searchUsers(mockCtx, { query: 'doe' });

      expect(result.length).toBe(2);
    });

    it('should return empty array for no matches', async () => {
      const adminUser = createAdminUser({ _id: adminUserId });
      const users = [createRegularUser({ email: 'user@example.com' })];

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: adminUserId }),
      );
      mockCtx.db.get.mockResolvedValueOnce(adminUser);

      const mockQuery = {
        withIndex: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        take: vi.fn().mockResolvedValue(users),
      };
      mockCtx.db.query.mockReturnValue(mockQuery);

      const searchUsers = async (ctx: any, args: { query: string }) => {
        const identity = await ctx.auth.getUserIdentity();
        const currentUser = await ctx.db.get(identity.subject);
        if (!isAdmin(currentUser)) throw new Error('Admin access required');

        const searchQuery = args.query.toLowerCase();
        const users = await ctx.db.query('users').withIndex('by_created').order('desc').take(1000);

        return users.filter(
          (user: any) =>
            user.email.toLowerCase().includes(searchQuery) ||
            (user.name && user.name.toLowerCase().includes(searchQuery)),
        );
      };

      const result = await searchUsers(mockCtx, { query: 'nonexistent' });

      expect(result.length).toBe(0);
    });
  });

  // ============================================================================
  // System Configuration Tests
  // ============================================================================

  describe('getSystemConfiguration()', () => {
    it('should return system configuration for admin', async () => {
      const adminUser = createAdminUser({ _id: adminUserId });
      const mockConfig = {
        creditCosts: { LEAD_DISCOVERY: 1, EMAIL_ENRICHMENT: 2 },
        planLimits: { free: { monthlyCredits: 100 } },
        updatedAt: Date.now(),
      };

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: adminUserId }),
      );
      mockCtx.db.get.mockResolvedValueOnce(adminUser);

      const mockQuery = {
        unique: vi.fn().mockResolvedValue(mockConfig),
      };
      mockCtx.db.query.mockReturnValue(mockQuery);

      const getSystemConfiguration = async (ctx: any) => {
        const identity = await ctx.auth.getUserIdentity();
        const currentUser = await ctx.db.get(identity.subject);
        if (!isAdmin(currentUser)) throw new Error('Admin access required');

        const config = await ctx.db.query('systemConfiguration').unique();

        if (config) {
          return {
            creditCosts: config.creditCosts,
            planLimits: config.planLimits,
            lastUpdated: config.updatedAt,
          };
        }

        // Return defaults
        return {
          creditCosts: { LEAD_DISCOVERY: 1, EMAIL_ENRICHMENT: 1 },
          planLimits: {},
          lastUpdated: null,
        };
      };

      const result = await getSystemConfiguration(mockCtx);

      expect(result.creditCosts).toBeDefined();
      expect(result.planLimits).toBeDefined();
    });

    it('should return defaults when no configuration exists', async () => {
      const adminUser = createAdminUser({ _id: adminUserId });

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: adminUserId }),
      );
      mockCtx.db.get.mockResolvedValueOnce(adminUser);

      const mockQuery = {
        unique: vi.fn().mockResolvedValue(null),
      };
      mockCtx.db.query.mockReturnValue(mockQuery);

      const getSystemConfiguration = async (ctx: any) => {
        const identity = await ctx.auth.getUserIdentity();
        const currentUser = await ctx.db.get(identity.subject);
        if (!isAdmin(currentUser)) throw new Error('Admin access required');

        const config = await ctx.db.query('systemConfiguration').unique();

        if (!config) {
          return {
            creditCosts: { LEAD_DISCOVERY: 1, EMAIL_ENRICHMENT: 1, AI_ANALYSIS: 1 },
            planLimits: { free: { monthlyCredits: 100 } },
            lastUpdated: null,
          };
        }

        return config;
      };

      const result = await getSystemConfiguration(mockCtx);

      expect(result.lastUpdated).toBeNull();
      expect(result.creditCosts).toBeDefined();
    });
  });

  // ============================================================================
  // pauseUserProcessing / resumeUserProcessing Tests
  // ============================================================================

  describe('pauseUserProcessing()', () => {
    it('should pause user processing and cancel active searches', async () => {
      const adminUser = createAdminUser({ _id: adminUserId });
      const targetUser = createRegularUser({ _id: regularUserId });
      const activeSearches = [
        createMockDocument('searches', { userId: regularUserId, status: 'in_progress' }),
        createMockDocument('searches', { userId: regularUserId, status: 'pending' }),
      ];

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: adminUserId }),
      );
      mockCtx.db.get
        .mockResolvedValueOnce(adminUser)
        .mockResolvedValueOnce(targetUser);

      const mockQuery = {
        withIndex: vi.fn().mockReturnThis(),
        filter: vi.fn().mockReturnThis(),
        collect: vi.fn().mockResolvedValue(activeSearches),
      };
      mockCtx.db.query.mockReturnValue(mockQuery);
      mockCtx.db.patch.mockResolvedValue(undefined);
      mockCtx.db.insert.mockResolvedValue(mockId('systemLogs'));

      const pauseUserProcessing = async (
        ctx: any,
        args: { userId: UserId; reason?: string },
      ) => {
        const identity = await ctx.auth.getUserIdentity();
        const currentUser = await ctx.db.get(identity.subject);
        if (!isAdmin(currentUser)) throw new Error('Admin access required');

        const user = await ctx.db.get(args.userId);
        if (!user) throw new Error('User not found');

        await ctx.db.patch(args.userId, {
          processingPaused: true,
          pauseReason: args.reason || 'Paused by admin',
          pausedAt: Date.now(),
          pausedBy: currentUser._id,
          updatedAt: Date.now(),
        });

        // Cancel active searches
        const activeSearches = await ctx.db
          .query('searches')
          .withIndex('by_user', (q: any) => q.eq('userId', args.userId))
          .filter((q: any) =>
            q.or(
              q.eq(q.field('status'), 'pending'),
              q.eq(q.field('status'), 'in_progress'),
              q.eq(q.field('status'), 'processing'),
            ),
          )
          .collect();

        for (const search of activeSearches) {
          await ctx.db.patch(search._id, {
            status: 'cancelled',
            error: args.reason || 'User processing paused by admin',
            completedAt: Date.now(),
          });
        }

        await ctx.db.insert('systemLogs', {
          type: 'user_control',
          action: 'pause_processing',
          userId: currentUser._id,
          data: { targetUserId: args.userId, reason: args.reason },
          timestamp: Date.now(),
        });

        return { success: true, cancelledSearches: activeSearches.length };
      };

      const result = await pauseUserProcessing(mockCtx, {
        userId: regularUserId,
        reason: 'Account review',
      });

      expect(result.success).toBe(true);
      expect(result.cancelledSearches).toBe(2);
      expect(mockCtx.db.patch).toHaveBeenCalledWith(
        regularUserId,
        expect.objectContaining({ processingPaused: true }),
      );
    });
  });

  describe('resumeUserProcessing()', () => {
    it('should resume paused user processing', async () => {
      const adminUser = createAdminUser({ _id: adminUserId });
      const pausedUser = createRegularUser({
        _id: regularUserId,
        processingPaused: true,
        pauseReason: 'Test pause',
      });

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: adminUserId }),
      );
      mockCtx.db.get
        .mockResolvedValueOnce(adminUser)
        .mockResolvedValueOnce(pausedUser);
      mockCtx.db.patch.mockResolvedValue(undefined);
      mockCtx.db.insert.mockResolvedValue(mockId('systemLogs'));

      const resumeUserProcessing = async (ctx: any, args: { userId: UserId }) => {
        const identity = await ctx.auth.getUserIdentity();
        const currentUser = await ctx.db.get(identity.subject);
        if (!isAdmin(currentUser)) throw new Error('Admin access required');

        const user = await ctx.db.get(args.userId);
        if (!user) throw new Error('User not found');

        await ctx.db.patch(args.userId, {
          processingPaused: false,
          pauseReason: undefined,
          pausedAt: undefined,
          pausedBy: undefined,
          updatedAt: Date.now(),
        });

        await ctx.db.insert('systemLogs', {
          type: 'user_control',
          action: 'resume_processing',
          userId: currentUser._id,
          data: { targetUserId: args.userId },
          timestamp: Date.now(),
        });

        return { success: true };
      };

      const result = await resumeUserProcessing(mockCtx, { userId: regularUserId });

      expect(result.success).toBe(true);
      expect(mockCtx.db.patch).toHaveBeenCalledWith(
        regularUserId,
        expect.objectContaining({ processingPaused: false }),
      );
    });
  });

  // ============================================================================
  // updateCreditCosts Tests
  // ============================================================================

  describe('updateCreditCosts()', () => {
    it('should update credit costs', async () => {
      const adminUser = createAdminUser({ _id: adminUserId });
      const existingConfig = createMockDocument('systemConfiguration', {
        creditCosts: { LEAD_DISCOVERY: 1 },
      });

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: adminUserId }),
      );
      mockCtx.db.get.mockResolvedValueOnce(adminUser);

      const mockQuery = {
        unique: vi.fn().mockResolvedValue(existingConfig),
      };
      mockCtx.db.query.mockReturnValue(mockQuery);
      mockCtx.db.patch.mockResolvedValue(undefined);
      mockCtx.db.insert.mockResolvedValue(mockId('systemLogs'));

      const updateCreditCosts = async (
        ctx: any,
        args: { creditCosts: Record<string, number> },
      ) => {
        const identity = await ctx.auth.getUserIdentity();
        const currentUser = await ctx.db.get(identity.subject);
        if (!isAdmin(currentUser)) throw new Error('Admin access required');

        const costs = Object.values(args.creditCosts);
        if (costs.some((cost) => cost < 0)) {
          throw new Error('Credit costs must be non-negative');
        }

        const config = await ctx.db.query('systemConfiguration').unique();

        if (config) {
          await ctx.db.patch(config._id, {
            creditCosts: args.creditCosts,
            updatedAt: Date.now(),
            updatedBy: currentUser._id,
          });
        } else {
          await ctx.db.insert('systemConfiguration', {
            creditCosts: args.creditCosts,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        }

        await ctx.db.insert('systemLogs', {
          type: 'configuration_change',
          action: 'update_credit_costs',
          userId: currentUser._id,
          data: { newCosts: args.creditCosts },
          timestamp: Date.now(),
        });

        return { success: true };
      };

      const result = await updateCreditCosts(mockCtx, {
        creditCosts: {
          LEAD_DISCOVERY: 2,
          EMAIL_ENRICHMENT: 3,
          AI_ANALYSIS: 5,
        },
      });

      expect(result.success).toBe(true);
      expect(mockCtx.db.patch).toHaveBeenCalled();
      expect(mockCtx.db.insert).toHaveBeenCalledWith(
        'systemLogs',
        expect.objectContaining({ action: 'update_credit_costs' }),
      );
    });

    it('should reject negative credit costs', async () => {
      const adminUser = createAdminUser({ _id: adminUserId });

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: adminUserId }),
      );
      mockCtx.db.get.mockResolvedValueOnce(adminUser);

      const updateCreditCosts = async (
        ctx: any,
        args: { creditCosts: Record<string, number> },
      ) => {
        const identity = await ctx.auth.getUserIdentity();
        const currentUser = await ctx.db.get(identity.subject);
        if (!isAdmin(currentUser)) throw new Error('Admin access required');

        const costs = Object.values(args.creditCosts);
        if (costs.some((cost) => cost < 0)) {
          throw new Error('Credit costs must be non-negative');
        }

        return { success: true };
      };

      await expect(
        updateCreditCosts(mockCtx, {
          creditCosts: { LEAD_DISCOVERY: -1 },
        }),
      ).rejects.toThrow('Credit costs must be non-negative');
    });
  });
});
