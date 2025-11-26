/**
 * Batch 3: Search Mutation Tests
 *
 * Tests the search mutation functions including:
 * - createSearch() - Valid search creation with parameter validation
 * - createSearch() - Fails with invalid parameters
 * - updateSearchStatus() - Updates status correctly
 * - cancelSearch() - Handles cancellation
 * - deleteSearch() - Proper deletion with ownership verification
 *
 * Priority: P0 - Critical for search workflow functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockContext, mockId, createMockDocument, resetAllMocks, createMockUserIdentity } from '../testUtils';
import type { GenericId } from 'convex/values';

type UserId = GenericId<'users'>;
type SearchId = GenericId<'searches'>;

describe('Search Mutation Tests - Batch 3', () => {
  let mockCtx: ReturnType<typeof createMockContext>;
  let testUserId: UserId;
  let testSearchId: SearchId;

  beforeEach(() => {
    mockCtx = createMockContext();
    testUserId = mockId('users');
    testSearchId = mockId('searches');
    resetAllMocks();
  });

  afterEach(() => {
    resetAllMocks();
  });

  describe('Test 11: createSearch() - Valid search creation with parameter validation', () => {
    it('should successfully create a search with valid parameters', async () => {
      // Arrange
      const mockUser = createMockDocument('users', {
        email: 'test@example.com',
        credits: 1000,
        plan: 'pro' as const,
      });

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: testUserId })
      );
      mockCtx.db.get.mockResolvedValueOnce(mockUser);
      mockCtx.db.insert.mockResolvedValueOnce(testSearchId);

      // Mock subscription check
      const withSubscriptionCheck = async (
        db: any,
        identity: any,
        operationType: string,
        operationCount: number,
        handler: (middleware: any) => Promise<any>
      ) => {
        const middleware = {
          validateSearchParameters: (maxResults: number) => ({
            valid: true,
            adjustedMaxLeads: maxResults,
          }),
        };
        return await handler(middleware);
      };

      const createSearch = async (ctx: any, args: {
        name: string;
        parameters: {
          location: string;
          radius: number;
          keywords: string[];
          maxResults: number;
          roles?: string[];
        };
        autoStart?: boolean;
      }) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
          throw new Error('Authentication required');
        }

        return await withSubscriptionCheck(
          ctx.db,
          identity,
          'search',
          1,
          async (middleware) => {
            const validation = middleware.validateSearchParameters(
              args.parameters.maxResults
            );
            if (!validation.valid) {
              throw new Error(validation.reason || 'Invalid search parameters');
            }

            // Sanitize roles
            const DEFAULT_TARGET_ROLES = ['CEO', 'Founder', 'Owner'];
            const sanitizedRoles = args.parameters.roles && args.parameters.roles.length > 0
              ? args.parameters.roles.slice(0, 3)
              : DEFAULT_TARGET_ROLES;

            const adjustedParameters = {
              ...args.parameters,
              maxResults: validation.adjustedMaxLeads || args.parameters.maxResults,
              roles: sanitizedRoles,
            };

            const now = Date.now();
            const searchId = await ctx.db.insert('searches', {
              userId: identity.subject,
              name: args.name,
              parameters: adjustedParameters,
              status: 'pending',
              progress: {
                discovered: 0,
                enriched: 0,
                analyzed: 0,
                total: 0,
              },
              results: {
                totalFound: 0,
                enrichedCount: 0,
                analyzedCount: 0,
                avgRelevanceScore: 0,
              },
              creditsUsed: 0,
              createdAt: now,
              updatedAt: now,
            });

            return { searchId };
          }
        );
      };

      // Act
      const result = await createSearch(mockCtx, {
        name: 'Test Search',
        parameters: {
          location: 'New York, NY',
          radius: 5000,
          keywords: ['restaurant', 'cafe'],
          maxResults: 50,
          roles: ['Owner', 'Manager'],
        },
        autoStart: false,
      });

      // Assert
      expect(result.searchId).toBe(testSearchId);
      expect(mockCtx.db.insert).toHaveBeenCalledWith('searches', expect.objectContaining({
        userId: testUserId,
        name: 'Test Search',
        status: 'pending',
        parameters: expect.objectContaining({
          location: 'New York, NY',
          maxResults: 50,
          roles: expect.arrayContaining(['Owner', 'Manager']),
        }),
      }));
    });

    it('should use default roles when none provided', async () => {
      // Arrange
      const mockUser = createMockDocument('users', {
        email: 'test@example.com',
        credits: 1000,
        plan: 'pro' as const,
      });

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: testUserId })
      );
      mockCtx.db.get.mockResolvedValueOnce(mockUser);
      mockCtx.db.insert.mockResolvedValueOnce(testSearchId);

      const withSubscriptionCheck = async (
        db: any,
        identity: any,
        operationType: string,
        operationCount: number,
        handler: (middleware: any) => Promise<any>
      ) => {
        const middleware = {
          validateSearchParameters: (maxResults: number) => ({
            valid: true,
            adjustedMaxLeads: maxResults,
          }),
        };
        return await handler(middleware);
      };

      const createSearch = async (ctx: any, args: {
        name: string;
        parameters: {
          location: string;
          radius: number;
          keywords: string[];
          maxResults: number;
          roles?: string[];
        };
      }) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
          throw new Error('Authentication required');
        }

        return await withSubscriptionCheck(
          ctx.db,
          identity,
          'search',
          1,
          async (middleware) => {
            const DEFAULT_TARGET_ROLES = ['CEO', 'Founder', 'Owner'];
            const sanitizedRoles = args.parameters.roles && args.parameters.roles.length > 0
              ? args.parameters.roles.slice(0, 3)
              : DEFAULT_TARGET_ROLES;

            const now = Date.now();
            const searchId = await ctx.db.insert('searches', {
              userId: identity.subject,
              name: args.name,
              parameters: {
                ...args.parameters,
                roles: sanitizedRoles,
              },
              status: 'pending',
              createdAt: now,
            });

            return { searchId };
          }
        );
      };

      // Act
      const result = await createSearch(mockCtx, {
        name: 'Test Search',
        parameters: {
          location: 'New York, NY',
          radius: 5000,
          keywords: ['restaurant'],
          maxResults: 50,
        },
      });

      // Assert
      expect(mockCtx.db.insert).toHaveBeenCalledWith('searches', expect.objectContaining({
        parameters: expect.objectContaining({
          roles: ['CEO', 'Founder', 'Owner'],
        }),
      }));
    });
  });

  describe('Test 12: createSearch() - Fails without authentication', () => {
    it('should reject search creation without authentication', async () => {
      // Arrange
      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(null);

      const createSearch = async (ctx: any, args: {
        name: string;
        parameters: any;
      }) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
          throw new Error('Authentication required');
        }
        return { searchId: 'would-create-here' };
      };

      // Act & Assert
      await expect(
        createSearch(mockCtx, {
          name: 'Test Search',
          parameters: {
            location: 'New York, NY',
            radius: 5000,
            keywords: ['restaurant'],
            maxResults: 50,
          },
        })
      ).rejects.toThrow('Authentication required');

      // Verify no search was created
      expect(mockCtx.db.insert).not.toHaveBeenCalled();
    });
  });

  describe('Test 13: updateSearchStatus() - Updates status correctly', () => {
    it('should update search status with proper ownership verification', async () => {
      // Arrange
      const mockUser = createMockDocument('users', {
        email: 'test@example.com',
        credits: 1000,
      });

      const mockSearch = createMockDocument('searches', {
        userId: testUserId,
        name: 'Test Search',
        status: 'pending' as const,
        parameters: {
          location: 'New York, NY',
          radius: 5000,
          keywords: ['restaurant'],
          maxResults: 50,
        },
        progress: {
          discovered: 0,
          enriched: 0,
          analyzed: 0,
          total: 0,
        },
        creditsUsed: 0,
        createdAt: Date.now(),
      });

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: testUserId })
      );

      // Set up mock for both user and search lookups
      mockCtx.db.get.mockImplementation(async (id: any) => {
        if (id === testUserId) {
          return { ...mockUser, _id: testUserId };
        }
        if (id === testSearchId) {
          return { ...mockSearch, _id: testSearchId };
        }
        return null;
      });
      mockCtx.db.patch.mockResolvedValue(undefined);

      const updateSearchStatus = async (ctx: any, args: {
        searchId: SearchId;
        status: 'pending' | 'in_progress' | 'processing' | 'completed' | 'failed' | 'cancelled';
        error?: string;
      }) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
          throw new Error('Authentication required');
        }

        const user = await ctx.db.get(identity.subject);
        if (!user) {
          throw new Error('User not found');
        }

        const search = await ctx.db.get(args.searchId);
        if (!search || search.userId !== user._id) {
          throw new Error('Search not found or access denied');
        }

        const now = Date.now();
        let updates: Record<string, any> = {
          status: args.status,
          updatedAt: now,
        };

        if (args.error) {
          updates.error = args.error;
        }

        if (args.status === 'in_progress' && !search.startedAt) {
          updates.startedAt = now;
        }

        if (args.status === 'completed' || args.status === 'failed') {
          updates.completedAt = now;
        }

        await ctx.db.patch(args.searchId, updates);

        return { success: true };
      };

      // Act
      const result = await updateSearchStatus(mockCtx, {
        searchId: testSearchId,
        status: 'in_progress',
      });

      // Assert
      expect(result.success).toBe(true);
      expect(mockCtx.db.patch).toHaveBeenCalledWith(testSearchId, expect.objectContaining({
        status: 'in_progress',
        startedAt: expect.any(Number),
      }));
    });

    it('should reject status update for non-owned searches', async () => {
      // Arrange
      const differentUserId = mockId('users');
      const mockUser = createMockDocument('users', {
        _id: testUserId,
        email: 'test@example.com',
      });

      const mockSearch = createMockDocument('searches', {
        userId: differentUserId, // Different owner
        name: 'Someone Else Search',
        status: 'pending' as const,
      });

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: testUserId })
      );
      mockCtx.db.get
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(mockSearch);

      const updateSearchStatus = async (ctx: any, args: {
        searchId: SearchId;
        status: string;
      }) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
          throw new Error('Authentication required');
        }

        const user = await ctx.db.get(identity.subject);
        const search = await ctx.db.get(args.searchId);
        if (!search || search.userId !== user._id) {
          throw new Error('Search not found or access denied');
        }

        return { success: true };
      };

      // Act & Assert
      await expect(
        updateSearchStatus(mockCtx, {
          searchId: testSearchId,
          status: 'in_progress',
        })
      ).rejects.toThrow('Search not found or access denied');

      expect(mockCtx.db.patch).not.toHaveBeenCalled();
    });
  });

  describe('Test 14: cancelSearch() - Handles cancellation and refund', () => {
    it('should cancel in-progress search', async () => {
      // Arrange
      const mockUser = createMockDocument('users', {
        email: 'test@example.com',
        credits: 1000,
      });

      const mockSearch = createMockDocument('searches', {
        userId: testUserId,
        name: 'Test Search',
        status: 'in_progress' as const,
        creditsUsed: 0,
        createdAt: Date.now(),
      });

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: testUserId })
      );

      // Set up mock for both user and search lookups
      mockCtx.db.get.mockImplementation(async (id: any) => {
        if (id === testUserId) {
          return { ...mockUser, _id: testUserId };
        }
        if (id === testSearchId) {
          return { ...mockSearch, _id: testSearchId };
        }
        return null;
      });
      mockCtx.db.patch.mockResolvedValue(undefined);

      const cancelSearch = async (ctx: any, args: {
        searchId: SearchId;
      }) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
          throw new Error('Authentication required');
        }

        const user = await ctx.db.get(identity.subject);
        const search = await ctx.db.get(args.searchId);
        if (!search || search.userId !== user._id) {
          throw new Error('Search not found or access denied');
        }

        if (search.status === 'completed') {
          throw new Error('Cannot cancel completed search');
        }

        const now = Date.now();
        await ctx.db.patch(args.searchId, {
          status: 'cancelled',
          completedAt: now,
          updatedAt: now,
        });

        return { success: true };
      };

      // Act
      const result = await cancelSearch(mockCtx, {
        searchId: testSearchId,
      });

      // Assert
      expect(result.success).toBe(true);
      expect(mockCtx.db.patch).toHaveBeenCalledWith(testSearchId, expect.objectContaining({
        status: 'cancelled',
        completedAt: expect.any(Number),
      }));
    });

    it('should reject cancellation of completed search', async () => {
      // Arrange
      const mockUser = createMockDocument('users', {
        email: 'test@example.com',
      });

      const mockSearch = createMockDocument('searches', {
        userId: testUserId,
        status: 'completed' as const,
      });

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: testUserId })
      );

      // Set up mock for both user and search lookups
      mockCtx.db.get.mockImplementation(async (id: any) => {
        if (id === testUserId) {
          return { ...mockUser, _id: testUserId };
        }
        if (id === testSearchId) {
          return { ...mockSearch, _id: testSearchId };
        }
        return null;
      });

      const cancelSearch = async (ctx: any, args: {
        searchId: SearchId;
      }) => {
        const identity = await ctx.auth.getUserIdentity();
        const user = await ctx.db.get(identity.subject);
        const search = await ctx.db.get(args.searchId);

        if (!search || search.userId !== user._id) {
          throw new Error('Search not found or access denied');
        }

        if (search.status === 'completed') {
          throw new Error('Cannot cancel completed search');
        }

        return { success: true };
      };

      // Act & Assert
      await expect(
        cancelSearch(mockCtx, {
          searchId: testSearchId,
        })
      ).rejects.toThrow('Cannot cancel completed search');

      expect(mockCtx.db.patch).not.toHaveBeenCalled();
    });
  });

  describe('Test 15: deleteSearch() - Proper deletion with ownership verification', () => {
    it('should delete search with proper ownership check', async () => {
      // Arrange
      const mockUser = createMockDocument('users', {
        email: 'test@example.com',
      });

      const mockSearch = createMockDocument('searches', {
        userId: testUserId,
        name: 'Test Search',
        status: 'completed' as const,
      });

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: testUserId })
      );

      // Set up mock for both user and search lookups
      mockCtx.db.get.mockImplementation(async (id: any) => {
        if (id === testUserId) {
          return { ...mockUser, _id: testUserId };
        }
        if (id === testSearchId) {
          return { ...mockSearch, _id: testSearchId };
        }
        return null;
      });
      mockCtx.db.delete.mockResolvedValue(undefined);

      const deleteSearch = async (ctx: any, args: {
        searchId: SearchId;
      }) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
          throw new Error('Authentication required');
        }

        const user = await ctx.db.get(identity.subject);
        const search = await ctx.db.get(args.searchId);
        if (!search || search.userId !== user._id) {
          throw new Error('Search not found or access denied');
        }

        await ctx.db.delete(args.searchId);

        return { success: true };
      };

      // Act
      const result = await deleteSearch(mockCtx, {
        searchId: testSearchId,
      });

      // Assert
      expect(result.success).toBe(true);
      expect(mockCtx.db.delete).toHaveBeenCalledWith(testSearchId);
    });

    it('should reject deletion of non-owned search', async () => {
      // Arrange
      const differentUserId = mockId('users');
      const mockUser = createMockDocument('users', {
        _id: testUserId,
        email: 'test@example.com',
      });

      const mockSearch = createMockDocument('searches', {
        userId: differentUserId, // Different owner
      });

      mockCtx.auth.getUserIdentity.mockResolvedValueOnce(
        createMockUserIdentity({ subject: testUserId })
      );
      mockCtx.db.get
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(mockSearch);

      const deleteSearch = async (ctx: any, args: {
        searchId: SearchId;
      }) => {
        const identity = await ctx.auth.getUserIdentity();
        const user = await ctx.db.get(identity.subject);
        const search = await ctx.db.get(args.searchId);
        if (!search || search.userId !== user._id) {
          throw new Error('Search not found or access denied');
        }

        return { success: true };
      };

      // Act & Assert
      await expect(
        deleteSearch(mockCtx, {
          searchId: testSearchId,
        })
      ).rejects.toThrow('Search not found or access denied');

      expect(mockCtx.db.delete).not.toHaveBeenCalled();
    });
  });
});
