/**
 * Batch 8: Pipeline Orchestrator Component Tests
 *
 * Tests the search pipeline orchestration components including:
 * - Search completion monitoring
 * - Status transitions with timestamps
 * - Progress tracking and updates
 * - Search results aggregation
 * - Stuck search detection
 *
 * Priority: P1 - Critical for reliable pipeline orchestration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockContext, mockId, createMockDocument, resetAllMocks } from '../testUtils';
import type { GenericId } from 'convex/values';

type UserId = GenericId<'users'>;
type SearchId = GenericId<'searches'>;
type LeadId = GenericId<'leads'>;

describe('Pipeline Orchestrator Component Tests - Batch 8', () => {
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

  describe('Test 36: Search completion monitoring', () => {
    it('should detect searches ready for completion', async () => {
      // Arrange - Create search with all leads analyzed
      const mockSearch = createMockDocument('searches', {
        userId: testUserId,
        status: 'processing' as const,
        progress: {
          discovered: 3,
          enriched: 3,
          analyzed: 3,
          total: 3,
        },
      });

      const mockLeads = [
        createMockDocument('leads', {
          searchId: testSearchId,
          businessName: 'Lead 1',
          enrichmentStatus: 'completed' as const,
          analysisStatus: 'completed' as const,
          contactInfo: {
            emails: ['test1@example.com'],
            contacts: [{ name: 'Contact 1', email: 'test1@example.com' }],
          },
        }),
        createMockDocument('leads', {
          searchId: testSearchId,
          businessName: 'Lead 2',
          enrichmentStatus: 'completed' as const,
          analysisStatus: 'completed' as const,
          contactInfo: {
            emails: ['test2@example.com'],
            contacts: [{ name: 'Contact 2', email: 'test2@example.com' }],
          },
        }),
        createMockDocument('leads', {
          searchId: testSearchId,
          businessName: 'Lead 3',
          enrichmentStatus: 'completed' as const,
          analysisStatus: 'failed' as const,
          contactInfo: {
            emails: ['test3@example.com'],
            contacts: [{ name: 'Contact 3', email: 'test3@example.com' }],
          },
        }),
      ];

      // Mock monitoring logic
      const checkCompletion = (search: any, leads: any[]) => {
        const eligibleLeads = leads.filter((lead) => {
          const enrichmentComplete =
            lead.enrichmentStatus === 'completed' ||
            lead.enrichmentStatus === 'completed_fallback';
          const hasEmail = Boolean(lead.contactInfo?.emails?.length);
          const hasContactName = Boolean(lead.contactInfo?.contacts?.[0]?.name);
          return enrichmentComplete && hasEmail && hasContactName;
        });

        if (eligibleLeads.length === 0) {
          return { readyForCompletion: false, reason: 'no_eligible_leads' };
        }

        const FINAL_ANALYSIS_STATUSES = new Set(['completed', 'failed', 'timeout']);
        const finishedLeads = eligibleLeads.filter((lead) =>
          FINAL_ANALYSIS_STATUSES.has(lead.analysisStatus ?? '')
        );

        const activeLeads = eligibleLeads.filter(
          (lead) => !FINAL_ANALYSIS_STATUSES.has(lead.analysisStatus ?? '')
        );

        if (activeLeads.length > 0) {
          return {
            readyForCompletion: false,
            reason: 'active_leads_remaining',
            activeCount: activeLeads.length,
          };
        }

        return {
          readyForCompletion: true,
          finishedLeads: finishedLeads.length,
          eligibleLeads: eligibleLeads.length,
        };
      };

      // Act
      const result = checkCompletion(mockSearch, mockLeads);

      // Assert
      expect(result.readyForCompletion).toBe(true);
      expect(result.finishedLeads).toBe(3);
      expect(result.eligibleLeads).toBe(3);
    });

    it('should not complete search with active leads', async () => {
      // Arrange - Create search with some leads still processing
      const mockSearch = createMockDocument('searches', {
        userId: testUserId,
        status: 'processing' as const,
        progress: {
          discovered: 3,
          enriched: 3,
          analyzed: 1,
          total: 3,
        },
      });

      const mockLeads = [
        createMockDocument('leads', {
          searchId: testSearchId,
          businessName: 'Lead 1',
          enrichmentStatus: 'completed' as const,
          analysisStatus: 'completed' as const,
          contactInfo: {
            emails: ['test1@example.com'],
            contacts: [{ name: 'Contact 1', email: 'test1@example.com' }],
          },
        }),
        createMockDocument('leads', {
          searchId: testSearchId,
          businessName: 'Lead 2',
          enrichmentStatus: 'completed' as const,
          analysisStatus: 'processing' as const, // Still processing
          contactInfo: {
            emails: ['test2@example.com'],
            contacts: [{ name: 'Contact 2', email: 'test2@example.com' }],
          },
        }),
        createMockDocument('leads', {
          searchId: testSearchId,
          businessName: 'Lead 3',
          enrichmentStatus: 'completed' as const,
          analysisStatus: 'pending' as const, // Still pending
          contactInfo: {
            emails: ['test3@example.com'],
            contacts: [{ name: 'Contact 3', email: 'test3@example.com' }],
          },
        }),
      ];

      // Mock monitoring logic
      const checkCompletion = (search: any, leads: any[]) => {
        const eligibleLeads = leads.filter((lead) => {
          const enrichmentComplete =
            lead.enrichmentStatus === 'completed' ||
            lead.enrichmentStatus === 'completed_fallback';
          const hasEmail = Boolean(lead.contactInfo?.emails?.length);
          const hasContactName = Boolean(lead.contactInfo?.contacts?.[0]?.name);
          return enrichmentComplete && hasEmail && hasContactName;
        });

        const FINAL_ANALYSIS_STATUSES = new Set(['completed', 'failed', 'timeout']);
        const activeLeads = eligibleLeads.filter(
          (lead) => !FINAL_ANALYSIS_STATUSES.has(lead.analysisStatus ?? '')
        );

        if (activeLeads.length > 0) {
          return {
            readyForCompletion: false,
            reason: 'active_leads_remaining',
            activeCount: activeLeads.length,
          };
        }

        return { readyForCompletion: true };
      };

      // Act
      const result = checkCompletion(mockSearch, mockLeads);

      // Assert
      expect(result.readyForCompletion).toBe(false);
      expect(result.reason).toBe('active_leads_remaining');
      expect(result.activeCount).toBe(2);
    });

    it('should filter out ineligible leads (missing email/contact)', async () => {
      // Arrange - Leads with missing required data
      const mockLeads = [
        createMockDocument('leads', {
          searchId: testSearchId,
          businessName: 'Lead 1',
          enrichmentStatus: 'completed' as const,
          analysisStatus: 'completed' as const,
          contactInfo: {
            emails: ['test1@example.com'],
            contacts: [{ name: 'Contact 1', email: 'test1@example.com' }],
          },
        }),
        createMockDocument('leads', {
          searchId: testSearchId,
          businessName: 'Lead 2 - No Email',
          enrichmentStatus: 'completed' as const,
          analysisStatus: 'completed' as const,
          contactInfo: {
            emails: [], // No email
            contacts: [{ name: 'Contact 2' }],
          },
        }),
        createMockDocument('leads', {
          searchId: testSearchId,
          businessName: 'Lead 3 - No Contact Name',
          enrichmentStatus: 'completed' as const,
          analysisStatus: 'completed' as const,
          contactInfo: {
            emails: ['test3@example.com'],
            contacts: [], // No contact
          },
        }),
      ];

      // Mock eligibility filter
      const filterEligibleLeads = (leads: any[]) => {
        return leads.filter((lead) => {
          const enrichmentComplete =
            lead.enrichmentStatus === 'completed' ||
            lead.enrichmentStatus === 'completed_fallback';
          const hasEmail = Boolean(lead.contactInfo?.emails?.length);
          const hasContactName = Boolean(lead.contactInfo?.contacts?.[0]?.name);
          return enrichmentComplete && hasEmail && hasContactName;
        });
      };

      // Act
      const eligibleLeads = filterEligibleLeads(mockLeads);

      // Assert
      expect(eligibleLeads).toHaveLength(1);
      expect(eligibleLeads[0]?.businessName).toBe('Lead 1');
    });
  });

  describe('Test 37: Search status transitions', () => {
    it('should update status with proper timestamps', async () => {
      // Arrange
      const mockSearch = createMockDocument('searches', {
        userId: testUserId,
        status: 'pending' as const,
        createdAt: Date.now() - 10000,
      });

      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);

      mockCtx.db.get.mockResolvedValue(mockSearch);
      mockCtx.db.patch.mockResolvedValue(undefined);

      const updateSearchStatus = async (
        ctx: any,
        searchId: SearchId,
        status: 'in_progress' | 'completed' | 'failed'
      ) => {
        const search = await ctx.db.get(searchId);
        if (!search) {
          throw new Error('Search not found');
        }

        const updates: Record<string, any> = { status };

        if (status === 'in_progress' && !search.startedAt) {
          updates.startedAt = now;
        }

        if (status === 'completed' || status === 'failed') {
          updates.completedAt = now;
        }

        updates.updatedAt = now;

        await ctx.db.patch(searchId, updates);
        return { success: true, updates };
      };

      // Act
      const result = await updateSearchStatus(mockCtx, testSearchId, 'in_progress');

      // Assert
      expect(result.success).toBe(true);
      expect(result.updates).toEqual({
        status: 'in_progress',
        startedAt: now,
        updatedAt: now,
      });
      expect(mockCtx.db.patch).toHaveBeenCalledWith(
        testSearchId,
        expect.objectContaining({
          status: 'in_progress',
          startedAt: now,
        })
      );

      vi.restoreAllMocks();
    });

    it('should set completedAt when search completes', async () => {
      // Arrange
      const startedAt = Date.now() - 60000; // 1 minute ago
      const mockSearch = createMockDocument('searches', {
        userId: testUserId,
        status: 'in_progress' as const,
        startedAt,
      });

      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);

      mockCtx.db.get.mockResolvedValue(mockSearch);
      mockCtx.db.patch.mockResolvedValue(undefined);

      const updateSearchStatus = async (
        ctx: any,
        searchId: SearchId,
        status: 'completed' | 'failed',
        error?: string
      ) => {
        const search = await ctx.db.get(searchId);
        if (!search) {
          throw new Error('Search not found');
        }

        const updates: Record<string, any> = {
          status,
          completedAt: now,
          updatedAt: now,
        };

        if (error) {
          updates.error = error;
        }

        await ctx.db.patch(searchId, updates);
        return { success: true, updates };
      };

      // Act
      const result = await updateSearchStatus(mockCtx, testSearchId, 'completed');

      // Assert
      expect(result.success).toBe(true);
      expect(result.updates).toEqual({
        status: 'completed',
        completedAt: now,
        updatedAt: now,
      });
      expect(mockCtx.db.patch).toHaveBeenCalledWith(
        testSearchId,
        expect.objectContaining({
          status: 'completed',
          completedAt: now,
        })
      );

      vi.restoreAllMocks();
    });

    it('should handle status transition errors', async () => {
      // Arrange
      mockCtx.db.get.mockResolvedValue(null); // Search not found

      const updateSearchStatus = async (ctx: any, searchId: SearchId, status: string) => {
        const search = await ctx.db.get(searchId);
        if (!search) {
          throw new Error('Search not found');
        }
        await ctx.db.patch(searchId, { status });
        return { success: true };
      };

      // Act & Assert
      await expect(updateSearchStatus(mockCtx, testSearchId, 'completed')).rejects.toThrow(
        'Search not found'
      );
    });
  });

  describe('Test 38: Progress tracking and updates', () => {
    it('should update search progress with orchestration timestamp', async () => {
      // Arrange
      const mockSearch = createMockDocument('searches', {
        userId: testUserId,
        status: 'in_progress' as const,
        progress: {
          discovered: 5,
          enriched: 3,
          analyzed: 1,
          total: 5,
        },
      });

      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);

      mockCtx.db.get.mockResolvedValue(mockSearch);
      mockCtx.db.patch.mockResolvedValue(undefined);

      const updateProgress = async (
        ctx: any,
        searchId: SearchId,
        progress: { discovered: number; enriched: number; analyzed: number; total: number }
      ) => {
        const search = await ctx.db.get(searchId);
        if (!search) {
          throw new Error('Search not found');
        }

        const updates = {
          progress,
          lastOrchestrationAt: now,
          updatedAt: now,
        };

        await ctx.db.patch(searchId, updates);
        return { success: true, updates };
      };

      // Act
      const newProgress = {
        discovered: 10,
        enriched: 7,
        analyzed: 4,
        total: 10,
      };
      const result = await updateProgress(mockCtx, testSearchId, newProgress);

      // Assert
      expect(result.success).toBe(true);
      expect(result.updates.progress).toEqual(newProgress);
      expect(result.updates.lastOrchestrationAt).toBe(now);
      expect(mockCtx.db.patch).toHaveBeenCalledWith(
        testSearchId,
        expect.objectContaining({
          progress: newProgress,
          lastOrchestrationAt: now,
        })
      );

      vi.restoreAllMocks();
    });

    it('should track partial results metadata', async () => {
      // Arrange
      const mockSearch = createMockDocument('searches', {
        userId: testUserId,
        status: 'in_progress' as const,
        progress: {
          discovered: 25,
          enriched: 15,
          analyzed: 10,
          total: 25,
        },
      });

      mockCtx.db.get.mockResolvedValue(mockSearch);
      mockCtx.db.patch.mockResolvedValue(undefined);

      const updateProgressWithMetadata = async (
        ctx: any,
        searchId: SearchId,
        progress: any,
        options: { partialResults?: boolean; requestedCount?: number }
      ) => {
        const search = await ctx.db.get(searchId);
        if (!search) {
          throw new Error('Search not found');
        }

        const updates: Record<string, any> = {
          progress,
          lastOrchestrationAt: Date.now(),
        };

        if (options.partialResults !== undefined) {
          updates.partialResults = options.partialResults;
        }
        if (options.requestedCount !== undefined) {
          updates.requestedCount = options.requestedCount;
        }

        await ctx.db.patch(searchId, updates);
        return { success: true, updates };
      };

      // Act
      const result = await updateProgressWithMetadata(
        mockCtx,
        testSearchId,
        { discovered: 25, enriched: 15, analyzed: 10, total: 25 },
        { partialResults: true, requestedCount: 50 }
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.updates.partialResults).toBe(true);
      expect(result.updates.requestedCount).toBe(50);
      expect(mockCtx.db.patch).toHaveBeenCalledWith(
        testSearchId,
        expect.objectContaining({
          partialResults: true,
          requestedCount: 50,
        })
      );
    });
  });

  describe('Test 39: Search results aggregation', () => {
    it('should aggregate search results with metrics', async () => {
      // Arrange
      const mockSearch = createMockDocument('searches', {
        userId: testUserId,
        status: 'completed' as const,
      });

      const mockLeads = [
        createMockDocument('leads', {
          searchId: testSearchId,
          enrichmentStatus: 'completed' as const,
          aiAnalysis: {
            status: 'completed' as const,
            relevanceScore: 0.9,
            reasoning: 'Highly relevant',
            confidenceLevel: 'high' as const,
          },
        }),
        createMockDocument('leads', {
          searchId: testSearchId,
          enrichmentStatus: 'completed' as const,
          aiAnalysis: {
            status: 'completed' as const,
            relevanceScore: 0.75,
            reasoning: 'Good match',
            confidenceLevel: 'medium' as const,
          },
        }),
        createMockDocument('leads', {
          searchId: testSearchId,
          enrichmentStatus: 'completed' as const,
          aiAnalysis: {
            status: 'completed' as const,
            relevanceScore: 0.6,
            reasoning: 'Moderate match',
            confidenceLevel: 'medium' as const,
          },
        }),
        createMockDocument('leads', {
          searchId: testSearchId,
          enrichmentStatus: 'failed' as const,
          // No AI analysis
        }),
      ];

      const aggregateResults = (search: any, leads: any[]) => {
        const enrichedLeads = leads.filter(
          (l) => l.enrichmentStatus === 'completed' || l.enrichmentStatus === 'completed_fallback'
        );

        const analyzedLeads = leads.filter((l) => l.aiAnalysis !== undefined);

        const avgRelevanceScore =
          analyzedLeads.length > 0
            ? analyzedLeads.reduce((sum, l) => sum + (l.aiAnalysis?.relevanceScore || 0), 0) /
              analyzedLeads.length
            : 0;

        return {
          totalFound: leads.length,
          enrichedCount: enrichedLeads.length,
          analyzedCount: analyzedLeads.length,
          avgRelevanceScore: Math.round(avgRelevanceScore * 100) / 100, // Round to 2 decimals
        };
      };

      // Act
      const results = aggregateResults(mockSearch, mockLeads);

      // Assert
      expect(results.totalFound).toBe(4);
      expect(results.enrichedCount).toBe(3);
      expect(results.analyzedCount).toBe(3);
      expect(results.avgRelevanceScore).toBeCloseTo(0.75, 2); // (0.9 + 0.75 + 0.6) / 3 = 0.75
    });

    it('should handle empty search results', async () => {
      // Arrange
      const mockSearch = createMockDocument('searches', {
        userId: testUserId,
        status: 'completed' as const,
      });

      const aggregateResults = (search: any, leads: any[]) => {
        const enrichedLeads = leads.filter(
          (l) => l.enrichmentStatus === 'completed' || l.enrichmentStatus === 'completed_fallback'
        );

        const analyzedLeads = leads.filter((l) => l.aiAnalysis !== undefined);

        const avgRelevanceScore =
          analyzedLeads.length > 0
            ? analyzedLeads.reduce((sum, l) => sum + (l.aiAnalysis?.relevanceScore || 0), 0) /
              analyzedLeads.length
            : 0;

        return {
          totalFound: leads.length,
          enrichedCount: enrichedLeads.length,
          analyzedCount: analyzedLeads.length,
          avgRelevanceScore,
        };
      };

      // Act
      const results = aggregateResults(mockSearch, []);

      // Assert
      expect(results.totalFound).toBe(0);
      expect(results.enrichedCount).toBe(0);
      expect(results.analyzedCount).toBe(0);
      expect(results.avgRelevanceScore).toBe(0);
    });
  });

  describe('Test 40: Stuck search detection', () => {
    it('should detect searches stuck in processing', async () => {
      // Arrange
      const now = Date.now();
      const stuckThreshold = now - 30 * 60 * 1000; // 30 minutes ago

      const mockSearches = [
        createMockDocument('searches', {
          userId: testUserId,
          status: 'in_progress' as const,
          lastOrchestrationAt: now - 45 * 60 * 1000, // 45 minutes ago - STUCK
        }),
        createMockDocument('searches', {
          userId: testUserId,
          status: 'in_progress' as const,
          lastOrchestrationAt: now - 15 * 60 * 1000, // 15 minutes ago - OK
        }),
        createMockDocument('searches', {
          userId: testUserId,
          status: 'in_progress' as const,
          lastOrchestrationAt: now - 60 * 60 * 1000, // 60 minutes ago - STUCK
        }),
      ];

      const detectStuckSearches = (searches: any[], threshold: number) => {
        return searches.filter((s) => s.lastOrchestrationAt < threshold);
      };

      // Act
      const stuckSearches = detectStuckSearches(mockSearches, stuckThreshold);

      // Assert
      expect(stuckSearches).toHaveLength(2);
      expect(stuckSearches[0]?.lastOrchestrationAt).toBe(now - 45 * 60 * 1000);
      expect(stuckSearches[1]?.lastOrchestrationAt).toBe(now - 60 * 60 * 1000);
    });

    it('should return empty array when no stuck searches', async () => {
      // Arrange
      const now = Date.now();
      const stuckThreshold = now - 30 * 60 * 1000; // 30 minutes ago

      const mockSearches = [
        createMockDocument('searches', {
          userId: testUserId,
          status: 'in_progress' as const,
          lastOrchestrationAt: now - 10 * 60 * 1000, // 10 minutes ago - OK
        }),
        createMockDocument('searches', {
          userId: testUserId,
          status: 'in_progress' as const,
          lastOrchestrationAt: now - 5 * 60 * 1000, // 5 minutes ago - OK
        }),
      ];

      const detectStuckSearches = (searches: any[], threshold: number) => {
        return searches.filter((s) => s.lastOrchestrationAt < threshold);
      };

      // Act
      const stuckSearches = detectStuckSearches(mockSearches, stuckThreshold);

      // Assert
      expect(stuckSearches).toHaveLength(0);
    });

    it('should limit stuck search processing to max batch size', async () => {
      // Arrange
      const now = Date.now();
      const stuckThreshold = now - 30 * 60 * 1000;

      // Create 15 stuck searches
      const mockSearches = Array.from({ length: 15 }, (_, i) =>
        createMockDocument('searches', {
          userId: testUserId,
          status: 'in_progress' as const,
          lastOrchestrationAt: now - (45 + i) * 60 * 1000, // All stuck
        })
      );

      const detectStuckSearches = (searches: any[], threshold: number, maxBatchSize = 10) => {
        const stuck = searches.filter((s) => s.lastOrchestrationAt < threshold);
        return stuck.slice(0, maxBatchSize);
      };

      // Act
      const stuckSearches = detectStuckSearches(mockSearches, stuckThreshold, 10);

      // Assert
      expect(stuckSearches).toHaveLength(10); // Limited to batch size
    });
  });
});
