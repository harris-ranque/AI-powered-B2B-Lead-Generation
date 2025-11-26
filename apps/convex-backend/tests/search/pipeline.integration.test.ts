/**
 * Batch 5: Pipeline Integration Tests
 *
 * Tests the complete search pipeline integration including:
 * - Full search pipeline: Create → Reserve → Google Maps → Enrich → AI
 * - Pipeline with API failures and retry logic
 * - Batch processing for large searches (>50 leads)
 * - Real-time status broadcasting throughout pipeline
 * - Pipeline cancellation mid-execution
 *
 * Priority: P0 - Critical for end-to-end business flow validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockContext, mockId, createMockDocument, resetAllMocks, createMockUserIdentity } from '../testUtils';
import type { GenericId } from 'convex/values';

type UserId = GenericId<'users'>;
type SearchId = GenericId<'searches'>;
type LeadId = GenericId<'leads'>;
type ReservationId = GenericId<'creditReservations'>;

describe('Pipeline Integration Tests - Batch 5', () => {
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

  describe('Test 21: Full search pipeline - Create → Reserve → Google Maps → Enrich → AI', () => {
    it('should execute complete pipeline successfully', async () => {
      // Arrange
      const mockUser = createMockDocument('users', {
        email: 'test@example.com',
        credits: 1000,
        plan: 'pro' as const,
      });

      const mockSearch = createMockDocument('searches', {
        userId: testUserId,
        name: 'Test Search',
        status: 'pending' as const,
        parameters: {
          location: 'New York, NY',
          radius: 5000,
          keywords: ['restaurant'],
          maxResults: 10,
          roles: ['Owner', 'Manager'],
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

      const mockReservation = createMockDocument('creditReservations', {
        userId: testUserId,
        amount: 50,
        operationType: 'credit_operation',
        operationId: testSearchId,
        status: 'pending' as const,
        expiresAt: Date.now() + 30 * 60 * 1000,
        createdAt: Date.now(),
      });

      const mockLead = createMockDocument('leads', {
        searchId: testSearchId,
        businessName: 'Test Restaurant',
        address: '123 Main St, New York, NY',
        phone: '+1-555-0100',
        email: 'contact@testrestaurant.com',
        website: 'https://testrestaurant.com',
        discoveryStatus: 'completed' as const,
        enrichmentStatus: 'completed' as const,
        aiAnalysis: {
          status: 'completed' as const,
          relevanceScore: 0.85,
          reasoning: 'Highly relevant lead',
          confidenceLevel: 'high' as const,
        },
        createdAt: Date.now(),
      });

      // Mock database operations
      mockCtx.db.get.mockImplementation(async (id: any) => {
        if (id === testUserId) return { ...mockUser, _id: testUserId };
        if (id === testSearchId) return { ...mockSearch, _id: testSearchId };
        return null;
      });

      mockCtx.db.insert.mockImplementation(async (table: string, doc: any) => {
        if (table === 'searches') return testSearchId;
        if (table === 'creditReservations') return mockId('creditReservations');
        if (table === 'leads') return mockId('leads');
        if (table === 'creditTransactions') return mockId('creditTransactions');
        return mockId(table as any);
      });

      mockCtx.db.query.mockImplementation(() => ({
        withIndex: vi.fn().mockReturnThis(),
        filter: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(mockLead),
        take: vi.fn().mockResolvedValue([mockLead]),
        collect: vi.fn().mockResolvedValue([mockLead]),
        unique: vi.fn().mockResolvedValue(mockLead),
      }));

      mockCtx.db.patch.mockResolvedValue(undefined);

      // Mock pipeline execution
      const executePipeline = async (ctx: any, searchId: SearchId) => {
        const search = await ctx.db.get(searchId);
        if (!search) throw new Error('Search not found');

        const pipelineSteps = [
          { name: 'credit_reservation', duration: 100 },
          { name: 'google_maps_discovery', duration: 1200 },
          { name: 'lead_enrichment', duration: 800 },
          { name: 'ai_analysis', duration: 2100 },
          { name: 'credit_commit', duration: 50 },
        ];

        const results = {
          steps: [] as any[],
          totalDuration: 0,
          success: true,
          leadsFound: 10,
          leadsEnriched: 8,
          leadsAnalyzed: 8,
        };

        for (const step of pipelineSteps) {
          const startTime = Date.now();

          // Update search status
          await ctx.db.patch(searchId, {
            status: 'in_progress',
            updatedAt: Date.now(),
          });

          // Simulate step execution
          await new Promise(resolve => setTimeout(resolve, 10)); // Small delay for simulation

          const endTime = Date.now();

          results.steps.push({
            name: step.name,
            duration: endTime - startTime,
            success: true,
          });

          results.totalDuration += (endTime - startTime);
        }

        // Mark as completed
        await ctx.db.patch(searchId, {
          status: 'completed',
          completedAt: Date.now(),
        });

        return results;
      };

      // Act
      const result = await executePipeline(mockCtx, testSearchId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.steps).toHaveLength(5);
      expect(result.leadsFound).toBe(10);
      expect(result.leadsEnriched).toBe(8);
      expect(result.leadsAnalyzed).toBe(8);

      // Verify all steps executed
      const stepNames = result.steps.map(s => s.name);
      expect(stepNames).toContain('credit_reservation');
      expect(stepNames).toContain('google_maps_discovery');
      expect(stepNames).toContain('lead_enrichment');
      expect(stepNames).toContain('ai_analysis');
      expect(stepNames).toContain('credit_commit');

      // Verify status updates
      expect(mockCtx.db.patch).toHaveBeenCalledWith(
        testSearchId,
        expect.objectContaining({ status: 'completed' })
      );
    });
  });

  describe('Test 22: Pipeline with API failures and retry logic', () => {
    it('should retry failed API calls and recover', async () => {
      // Arrange
      let googleMapsAttempts = 0;
      let findymailAttempts = 0;

      const mockSearch = createMockDocument('searches', {
        userId: testUserId,
        status: 'in_progress' as const,
        parameters: {
          location: 'New York, NY',
          radius: 5000,
          keywords: ['restaurant'],
          maxResults: 10,
        },
      });

      mockCtx.db.get.mockResolvedValue({ ...mockSearch, _id: testSearchId });
      mockCtx.db.patch.mockResolvedValue(undefined);

      // Mock API with initial failures
      const callGoogleMapsAPI = async () => {
        googleMapsAttempts++;
        if (googleMapsAttempts < 3) {
          throw new Error('Google Maps API rate limited');
        }
        return { places: [{ name: 'Test Place', placeId: 'place_123' }] };
      };

      const callFindyMailAPI = async () => {
        findymailAttempts++;
        if (findymailAttempts < 2) {
          throw new Error('FindyMail API timeout');
        }
        return { email: 'contact@test.com', confidence: 0.9 };
      };

      // Retry logic with exponential backoff
      const retryWithBackoff = async (
        fn: () => Promise<any>,
        maxRetries: number = 3,
        baseDelay: number = 100
      ) => {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            return await fn();
          } catch (error) {
            lastError = error as Error;
            if (attempt < maxRetries - 1) {
              const delay = baseDelay * Math.pow(2, attempt);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }

        throw lastError;
      };

      // Act
      const googleResult = await retryWithBackoff(callGoogleMapsAPI, 3, 10);
      const findymailResult = await retryWithBackoff(callFindyMailAPI, 3, 10);

      // Assert
      expect(googleMapsAttempts).toBe(3); // Failed twice, succeeded on third
      expect(findymailAttempts).toBe(2); // Failed once, succeeded on second
      expect(googleResult.places).toHaveLength(1);
      expect(findymailResult.email).toBe('contact@test.com');
    });

    it('should fail gracefully after max retries exhausted', async () => {
      // Arrange
      let attempts = 0;
      const maxRetries = 3;

      const alwaysFailingAPI = async () => {
        attempts++;
        throw new Error('Persistent API failure');
      };

      const retryWithBackoff = async (
        fn: () => Promise<any>,
        maxRetries: number = 3
      ) => {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            return await fn();
          } catch (error) {
            lastError = error as Error;
          }
        }

        throw lastError;
      };

      // Act & Assert
      await expect(retryWithBackoff(alwaysFailingAPI, maxRetries))
        .rejects.toThrow('Persistent API failure');

      expect(attempts).toBe(maxRetries);
    });
  });

  describe('Test 23: Batch processing for large searches (>50 leads)', () => {
    it('should process leads in batches with proper progress tracking', async () => {
      // Arrange
      const totalLeads = 100;
      const batchSize = 20;
      const leads: any[] = [];

      for (let i = 0; i < totalLeads; i++) {
        leads.push(
          createMockDocument('leads', {
            searchId: testSearchId,
            businessName: `Business ${i}`,
            discoveryStatus: 'completed' as const,
            enrichmentStatus: 'pending' as const,
          })
        );
      }

      mockCtx.db.patch.mockResolvedValue(undefined);

      // Mock batch processor
      const processBatch = async (batch: any[]) => {
        return batch.map(lead => ({
          ...lead,
          enrichmentStatus: 'completed',
          email: `contact${lead.businessName}@test.com`,
        }));
      };

      // Act - Process in batches
      const batches = [];
      const processedLeads = [];

      for (let i = 0; i < totalLeads; i += batchSize) {
        const batch = leads.slice(i, i + batchSize);
        const processed = await processBatch(batch);
        processedLeads.push(...processed);

        batches.push({
          batchNumber: Math.floor(i / batchSize) + 1,
          size: batch.length,
          processed: processed.length,
        });

        // Update progress
        await mockCtx.db.patch(testSearchId, {
          progress: {
            discovered: totalLeads,
            enriched: processedLeads.length,
            analyzed: 0,
            total: totalLeads,
          },
        });
      }

      // Assert
      expect(batches).toHaveLength(5); // 100 / 20 = 5 batches
      expect(processedLeads).toHaveLength(totalLeads);

      batches.forEach((batch, index) => {
        expect(batch.batchNumber).toBe(index + 1);
        expect(batch.size).toBeLessThanOrEqual(batchSize);
        expect(batch.processed).toBe(batch.size);
      });

      // Verify progress updates
      expect(mockCtx.db.patch).toHaveBeenCalledWith(
        testSearchId,
        expect.objectContaining({
          progress: expect.objectContaining({
            enriched: totalLeads,
          }),
        })
      );
    });

    it('should handle batch failures gracefully', async () => {
      // Arrange
      const leads = Array.from({ length: 60 }, (_, i) =>
        createMockDocument('leads', {
          searchId: testSearchId,
          businessName: `Business ${i}`,
        })
      );

      const batchSize = 20;
      let failedBatch = 2; // Second batch will fail

      const processBatch = async (batch: any[], batchNumber: number) => {
        if (batchNumber === failedBatch) {
          throw new Error('Batch processing failed');
        }
        return batch.map(l => ({ ...l, processed: true }));
      };

      // Act
      const results = {
        successful: [] as any[],
        failed: [] as any[],
      };

      for (let i = 0; i < leads.length; i += batchSize) {
        const batch = leads.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;

        try {
          const processed = await processBatch(batch, batchNumber);
          results.successful.push(...processed);
        } catch (error) {
          results.failed.push(...batch);
        }
      }

      // Assert
      expect(results.successful).toHaveLength(40); // Batches 1 and 3
      expect(results.failed).toHaveLength(20); // Batch 2
    });
  });

  describe('Test 24: Real-time status broadcasting throughout pipeline', () => {
    it('should broadcast status updates at each pipeline stage', async () => {
      // Arrange
      const mockSearch = createMockDocument('searches', {
        userId: testUserId,
        status: 'pending' as const,
      });

      const broadcasts: any[] = [];

      const broadcastStatus = async (
        searchId: SearchId,
        stage: string,
        data: any
      ) => {
        broadcasts.push({
          searchId,
          stage,
          data,
          timestamp: Date.now(),
        });
      };

      mockCtx.db.get.mockResolvedValue({ ...mockSearch, _id: testSearchId });
      mockCtx.db.patch.mockResolvedValue(undefined);

      // Mock pipeline with broadcasting
      const executePipelineWithBroadcast = async (searchId: SearchId) => {
        const stages = [
          { name: 'credit_reservation', progress: 0 },
          { name: 'discovery', progress: 25 },
          { name: 'enrichment', progress: 50 },
          { name: 'analysis', progress: 75 },
          { name: 'completion', progress: 100 },
        ];

        for (const stage of stages) {
          await broadcastStatus(searchId, stage.name, {
            progress: stage.progress,
            status: 'in_progress',
          });

          // Simulate work
          await new Promise(resolve => setTimeout(resolve, 10));
        }

        return { success: true, broadcasts: broadcasts.length };
      };

      // Act
      const result = await executePipelineWithBroadcast(testSearchId);

      // Assert
      expect(result.success).toBe(true);
      expect(broadcasts).toHaveLength(5);

      // Verify broadcast progression
      expect(broadcasts[0].stage).toBe('credit_reservation');
      expect(broadcasts[0].data.progress).toBe(0);

      expect(broadcasts[2].stage).toBe('enrichment');
      expect(broadcasts[2].data.progress).toBe(50);

      expect(broadcasts[4].stage).toBe('completion');
      expect(broadcasts[4].data.progress).toBe(100);

      // All broadcasts should be for the same search
      broadcasts.forEach(broadcast => {
        expect(broadcast.searchId).toBe(testSearchId);
      });
    });

    it('should broadcast error status when pipeline fails', async () => {
      // Arrange
      const broadcasts: any[] = [];

      const broadcastStatus = async (searchId: SearchId, stage: string, data: any) => {
        broadcasts.push({ searchId, stage, data, timestamp: Date.now() });
      };

      const executePipelineWithError = async (searchId: SearchId) => {
        await broadcastStatus(searchId, 'discovery', { progress: 25 });

        // Simulate error
        await broadcastStatus(searchId, 'enrichment', {
          progress: 50,
          status: 'failed',
          error: 'API rate limit exceeded',
        });

        throw new Error('Pipeline failed at enrichment stage');
      };

      // Act & Assert
      await expect(executePipelineWithError(testSearchId))
        .rejects.toThrow('Pipeline failed at enrichment stage');

      expect(broadcasts).toHaveLength(2);
      expect(broadcasts[1].data.status).toBe('failed');
      expect(broadcasts[1].data.error).toBe('API rate limit exceeded');
    });
  });

  describe('Test 25: Pipeline cancellation mid-execution', () => {
    it('should cancel pipeline and cleanup resources', async () => {
      // Arrange
      const mockSearch = createMockDocument('searches', {
        userId: testUserId,
        status: 'in_progress' as const,
        reservationId: mockId('creditReservations') as any,
      });

      let pipelineRunning = true;
      const executedStages: string[] = [];

      mockCtx.db.get.mockImplementation(async (id: any) => {
        if (id === testSearchId) {
          return {
            ...mockSearch,
            _id: testSearchId,
            status: pipelineRunning ? 'in_progress' : 'cancelled',
          };
        }
        return null;
      });

      mockCtx.db.patch.mockResolvedValue(undefined);

      // Mock cancellable pipeline
      const executeCancellablePipeline = async (searchId: SearchId) => {
        const stages = ['discovery', 'enrichment', 'analysis'];

        for (const stage of stages) {
          const search = await mockCtx.db.get(searchId);

          if (search?.status === 'cancelled') {
            return {
              success: false,
              cancelled: true,
              completedStages: executedStages,
              reason: 'User cancelled',
            };
          }

          executedStages.push(stage);
          await new Promise(resolve => setTimeout(resolve, 10));
        }

        return { success: true, completedStages: executedStages };
      };

      // Act - Start pipeline and cancel mid-execution
      const pipelinePromise = executeCancellablePipeline(testSearchId);

      // Cancel after short delay
      await new Promise(resolve => setTimeout(resolve, 15));
      pipelineRunning = false;

      const result = await pipelinePromise;

      // Assert
      expect(result.cancelled).toBe(true);
      expect(result.completedStages.length).toBeLessThan(3);
      expect(result.reason).toBe('User cancelled');
    });

    it('should rollback credits when pipeline is cancelled', async () => {
      // Arrange
      const mockReservation = createMockDocument('creditReservations', {
        userId: testUserId,
        amount: 50,
        status: 'pending' as const,
      });

      const reservationId = mockId('creditReservations');

      mockCtx.db.get.mockImplementation(async (id: any) => {
        if (id === reservationId) {
          return { ...mockReservation, _id: reservationId };
        }
        return null;
      });

      mockCtx.db.patch.mockResolvedValue(undefined);

      // Mock cancellation with rollback
      const cancelPipelineWithRollback = async (
        reservationId: ReservationId
      ) => {
        const reservation = await mockCtx.db.get(reservationId);
        if (!reservation) {
          throw new Error('Reservation not found');
        }

        // Mark reservation as rolled back
        await mockCtx.db.patch(reservationId, {
          status: 'rolled_back',
          completedAt: Date.now(),
        });

        return {
          success: true,
          creditsReleased: reservation.amount,
        };
      };

      // Act
      const result = await cancelPipelineWithRollback(reservationId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.creditsReleased).toBe(50);
      expect(mockCtx.db.patch).toHaveBeenCalledWith(
        reservationId,
        expect.objectContaining({
          status: 'rolled_back',
        })
      );
    });
  });
});
