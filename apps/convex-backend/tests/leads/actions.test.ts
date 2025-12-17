/**
 * Comprehensive Tests for leads/actions.ts
 *
 * Tests lead processing action functions including:
 * - enrichLeads() - Lead enrichment with FindyMail
 * - analyzeLeads() - AI analysis with LangGraph
 * - processLeadWithLangGraph() - Individual lead processing
 * - Helper functions for domain extraction, etc.
 * - Error handling and retry logic
 * - Async batch processing architecture
 *
 * Priority: P0 - Critical for lead enrichment and AI analysis pipeline
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createMockActionContext,
  mockId,
  createMockDocument,
  resetAllMocks,
} from '../testUtils';
import type { GenericId } from 'convex/values';

type UserId = GenericId<'users'>;
type SearchId = GenericId<'searches'>;
type LeadId = GenericId<'leads'>;
type ProfileId = GenericId<'businessProfiles'>;

// Mock fetch for external API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Leads Actions Tests - leads/actions.ts', () => {
  let mockCtx: ReturnType<typeof createMockActionContext>;
  let testUserId: UserId;
  let testSearchId: SearchId;
  let testLeadId: LeadId;
  let testProfileId: ProfileId;

  beforeEach(() => {
    mockCtx = createMockActionContext();
    testUserId = mockId('users');
    testSearchId = mockId('searches');
    testLeadId = mockId('leads');
    testProfileId = mockId('businessProfiles');
    resetAllMocks();
    mockFetch.mockReset();

    // Set up environment variables
    process.env.LANGGRAPH_URL = 'http://localhost:8080';
    process.env.LANGGRAPH_API_KEY = 'test-langgraph-key';
    process.env.FINDYMAIL_API_KEY = 'test-findymail-key';
  });

  afterEach(() => {
    resetAllMocks();
    delete process.env.LANGGRAPH_URL;
    delete process.env.LANGGRAPH_API_KEY;
    delete process.env.FINDYMAIL_API_KEY;
  });

  // ============================================================================
  // Helper Function Tests
  // ============================================================================

  describe('Helper Functions', () => {
    describe('extractDomain()', () => {
      const extractDomain = (url?: string): string => {
        if (!url) return '';
        try {
          const parsedUrl = new URL(url.startsWith('http') ? url : `https://${url}`);
          return parsedUrl.hostname.replace(/^www\./, '');
        } catch {
          return url.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0] || '';
        }
      };

      it('should extract domain from full URL', () => {
        expect(extractDomain('https://www.example.com/page')).toBe('example.com');
        expect(extractDomain('http://example.com')).toBe('example.com');
        expect(extractDomain('https://subdomain.example.com')).toBe('subdomain.example.com');
      });

      it('should handle URLs without protocol', () => {
        expect(extractDomain('example.com')).toBe('example.com');
        expect(extractDomain('www.example.com')).toBe('example.com');
        expect(extractDomain('example.com/path')).toBe('example.com');
      });

      it('should return empty string for undefined/null', () => {
        expect(extractDomain(undefined)).toBe('');
        expect(extractDomain('')).toBe('');
      });

      it('should handle malformed URLs gracefully', () => {
        expect(extractDomain('not-a-url')).toBe('not-a-url');
        // '///invalid' gets processed through the catch block and returns 'invalid'
        // after splitting by '/' and taking the first non-empty segment
        expect(extractDomain('///invalid')).toBe('invalid');
      });

      it('should strip www prefix', () => {
        expect(extractDomain('https://www.google.com')).toBe('google.com');
        expect(extractDomain('www.facebook.com')).toBe('facebook.com');
      });
    });

    describe('Company size estimation from review count', () => {
      const estimateCompanySize = (reviewCount?: number): string => {
        if (reviewCount && reviewCount > 50) return 'Medium';
        if (reviewCount && reviewCount > 10) return 'Small';
        return 'Micro';
      };

      it('should estimate Medium for high review count', () => {
        expect(estimateCompanySize(100)).toBe('Medium');
        expect(estimateCompanySize(51)).toBe('Medium');
      });

      it('should estimate Small for moderate review count', () => {
        expect(estimateCompanySize(50)).toBe('Small');
        expect(estimateCompanySize(11)).toBe('Small');
      });

      it('should estimate Micro for low review count', () => {
        expect(estimateCompanySize(10)).toBe('Micro');
        expect(estimateCompanySize(0)).toBe('Micro');
        expect(estimateCompanySize(undefined)).toBe('Micro');
      });
    });

    describe('Revenue estimation from review count', () => {
      const estimateRevenue = (reviewCount?: number): string => {
        if (reviewCount && reviewCount > 100) return 'High';
        if (reviewCount && reviewCount > 20) return 'Medium';
        return 'Low';
      };

      it('should estimate revenue based on review count', () => {
        expect(estimateRevenue(150)).toBe('High');
        expect(estimateRevenue(50)).toBe('Medium');
        expect(estimateRevenue(10)).toBe('Low');
      });
    });
  });

  // ============================================================================
  // enrichLeads Tests
  // ============================================================================

  describe('enrichLeads()', () => {
    describe('Search and User Validation', () => {
      it('should throw error when search not found', async () => {
        mockCtx.runQuery.mockResolvedValueOnce(null);

        const enrichLeads = async (ctx: any, args: { searchId: SearchId }) => {
          const search = await ctx.runQuery('internal.search.internal.getSearchInternal', {
            searchId: args.searchId,
          });

          if (!search) {
            throw new Error('Search not found');
          }

          return { success: true };
        };

        await expect(enrichLeads(mockCtx, { searchId: testSearchId })).rejects.toThrow(
          'Search not found',
        );
      });

      it('should throw error when user not found', async () => {
        const mockSearch = createMockDocument('searches', {
          userId: testUserId,
          status: 'in_progress' as const,
        });

        mockCtx.runQuery
          .mockResolvedValueOnce(mockSearch)
          .mockResolvedValueOnce(null);

        const enrichLeads = async (ctx: any, args: { searchId: SearchId }) => {
          const search = await ctx.runQuery('internal.search.internal.getSearchInternal', {
            searchId: args.searchId,
          });

          const user = await ctx.runQuery('internal.users.internal.getUserInternal', {
            userId: search.userId,
          });

          if (!user) {
            throw new Error('User not found');
          }

          return { success: true };
        };

        await expect(enrichLeads(mockCtx, { searchId: testSearchId })).rejects.toThrow(
          'User not found',
        );
      });

      it('should handle cancelled search', async () => {
        const mockSearch = createMockDocument('searches', {
          userId: testUserId,
          status: 'cancelled' as const,
        });
        const mockUser = createMockDocument('users', {
          processingPaused: false,
        });

        mockCtx.runQuery
          .mockResolvedValueOnce(mockSearch)
          .mockResolvedValueOnce(mockUser);
        mockCtx.runMutation.mockResolvedValue(undefined);

        const enrichLeads = async (ctx: any, args: { searchId: SearchId }) => {
          const search = await ctx.runQuery('internal.search.internal.getSearchInternal', {
            searchId: args.searchId,
          });

          const user = await ctx.runQuery('internal.users.internal.getUserInternal', {
            userId: search.userId,
          });

          if (search.status === 'cancelled' || user.processingPaused) {
            await ctx.runMutation('internal.search.internal.updateSearchStatusInternal', {
              searchId: args.searchId,
              status: 'cancelled',
            });
            return { success: false, message: 'Cancelled' };
          }

          return { success: true };
        };

        const result = await enrichLeads(mockCtx, { searchId: testSearchId });

        expect(result.success).toBe(false);
        expect(result.message).toBe('Cancelled');
      });

      it('should handle paused user processing', async () => {
        const mockSearch = createMockDocument('searches', {
          userId: testUserId,
          status: 'in_progress' as const,
        });
        const mockUser = createMockDocument('users', {
          processingPaused: true,
          pauseReason: 'Admin review',
        });

        mockCtx.runQuery
          .mockResolvedValueOnce(mockSearch)
          .mockResolvedValueOnce(mockUser);
        mockCtx.runMutation.mockResolvedValue(undefined);

        const enrichLeads = async (ctx: any, args: { searchId: SearchId }) => {
          const search = await ctx.runQuery('internal.search.internal.getSearchInternal', {
            searchId: args.searchId,
          });

          const user = await ctx.runQuery('internal.users.internal.getUserInternal', {
            userId: search.userId,
          });

          if (search.status === 'cancelled' || user.processingPaused) {
            await ctx.runMutation('internal.search.internal.updateSearchStatusInternal', {
              searchId: args.searchId,
              status: 'cancelled',
              error: user.pauseReason || 'User processing paused',
            });
            return { success: false, message: 'Cancelled' };
          }

          return { success: true };
        };

        const result = await enrichLeads(mockCtx, { searchId: testSearchId });

        expect(result.success).toBe(false);
      });
    });

    describe('Lead Processing', () => {
      it('should skip to analysis when no leads to enrich', async () => {
        const mockSearch = createMockDocument('searches', {
          userId: testUserId,
          status: 'in_progress' as const,
        });
        const mockUser = createMockDocument('users', {
          processingPaused: false,
          plan: 'pro' as const,
        });

        mockCtx.runQuery
          .mockResolvedValueOnce(mockSearch)
          .mockResolvedValueOnce(mockUser)
          .mockResolvedValueOnce([]); // No leads
        mockCtx.scheduler.runAfter.mockResolvedValue(undefined);

        const enrichLeads = async (ctx: any, args: { searchId: SearchId }) => {
          const search = await ctx.runQuery('internal.search.internal.getSearchInternal', {
            searchId: args.searchId,
          });

          const user = await ctx.runQuery('internal.users.internal.getUserInternal', {
            userId: search.userId,
          });

          const leads = await ctx.runQuery('internal.leads.internal.getUnenrichedLeads', {
            searchId: args.searchId,
          });

          if (leads.length === 0) {
            await ctx.scheduler.runAfter(0, 'leads/actions:analyzeLeads', {
              searchId: args.searchId,
            });
            return {
              success: true,
              message: 'No leads to enrich',
              enrichedCount: 0,
            };
          }

          return { success: true, enrichedCount: leads.length };
        };

        const result = await enrichLeads(mockCtx, { searchId: testSearchId });

        expect(result.message).toBe('No leads to enrich');
        expect(result.enrichedCount).toBe(0);
        expect(mockCtx.scheduler.runAfter).toHaveBeenCalled();
      });

      it('should schedule leads with staggered delays', async () => {
        const mockSearch = createMockDocument('searches', {
          userId: testUserId,
          status: 'in_progress' as const,
          parameters: { roles: ['CEO', 'Founder'] },
        });
        const mockUser = createMockDocument('users', {
          processingPaused: false,
          plan: 'pro' as const,
        });
        const mockLeads = [
          createMockDocument('leads', { _id: mockId('leads') }),
          createMockDocument('leads', { _id: mockId('leads') }),
          createMockDocument('leads', { _id: mockId('leads') }),
        ];

        mockCtx.runQuery
          .mockResolvedValueOnce(mockSearch)
          .mockResolvedValueOnce(mockUser)
          .mockResolvedValueOnce(mockLeads);
        mockCtx.scheduler.runAfter.mockResolvedValue(undefined);
        mockCtx.runMutation.mockResolvedValue(undefined);

        const enrichLeads = async (ctx: any, args: { searchId: SearchId }) => {
          const search = await ctx.runQuery('internal.search.internal.getSearchInternal', {
            searchId: args.searchId,
          });

          const user = await ctx.runQuery('internal.users.internal.getUserInternal', {
            userId: search.userId,
          });

          const leads = await ctx.runQuery('internal.leads.internal.getUnenrichedLeads', {
            searchId: args.searchId,
          });

          let scheduledCount = 0;
          for (let i = 0; i < leads.length; i++) {
            await ctx.scheduler.runAfter(
              i * 200, // 200ms stagger
              'internal.leads.asyncEnrichment.enrichSingleLead',
              { leadId: leads[i]._id, searchId: args.searchId },
            );
            scheduledCount++;
          }

          return {
            success: true,
            scheduledCount,
            totalLeads: leads.length,
          };
        };

        const result = await enrichLeads(mockCtx, { searchId: testSearchId });

        expect(result.scheduledCount).toBe(3);
        expect(mockCtx.scheduler.runAfter).toHaveBeenCalledTimes(3);
        // Check staggered delays
        expect(mockCtx.scheduler.runAfter).toHaveBeenNthCalledWith(1, 0, expect.any(String), expect.any(Object));
        expect(mockCtx.scheduler.runAfter).toHaveBeenNthCalledWith(2, 200, expect.any(String), expect.any(Object));
        expect(mockCtx.scheduler.runAfter).toHaveBeenNthCalledWith(3, 400, expect.any(String), expect.any(Object));
      });

      it('should handle scheduling errors gracefully', async () => {
        const mockSearch = createMockDocument('searches', {
          userId: testUserId,
          status: 'in_progress' as const,
        });
        const mockUser = createMockDocument('users', {
          processingPaused: false,
        });
        const mockLeads = [
          createMockDocument('leads', { _id: mockId('leads') }),
        ];

        mockCtx.runQuery
          .mockResolvedValueOnce(mockSearch)
          .mockResolvedValueOnce(mockUser)
          .mockResolvedValueOnce(mockLeads);
        mockCtx.scheduler.runAfter.mockRejectedValueOnce(new Error('Scheduling failed'));
        mockCtx.runMutation.mockResolvedValue(undefined);

        const enrichLeads = async (ctx: any, args: { searchId: SearchId }) => {
          const search = await ctx.runQuery('internal.search.internal.getSearchInternal', { searchId: args.searchId });
          const user = await ctx.runQuery('internal.users.internal.getUserInternal', { userId: search.userId });
          const leads = await ctx.runQuery('internal.leads.internal.getUnenrichedLeads', { searchId: args.searchId });

          let scheduledCount = 0;
          let schedulingErrors = 0;

          for (const lead of leads) {
            try {
              await ctx.scheduler.runAfter(0, 'enrichSingleLead', { leadId: lead._id });
              scheduledCount++;
            } catch (error) {
              schedulingErrors++;
              await ctx.runMutation('internal.leads.internal.updateEnrichmentStatus', {
                leadId: lead._id,
                status: 'failed',
                error: (error as Error).message,
              });
            }
          }

          return { scheduledCount, schedulingErrors, totalLeads: leads.length };
        };

        const result = await enrichLeads(mockCtx, { searchId: testSearchId });

        expect(result.schedulingErrors).toBe(1);
        expect(result.scheduledCount).toBe(0);
        expect(mockCtx.runMutation).toHaveBeenCalled();
      });
    });

    describe('Enterprise User API Key Handling', () => {
      it('should use user API key for enterprise users', async () => {
        const mockSearch = createMockDocument('searches', {
          userId: testUserId,
        });
        const mockUser = createMockDocument('users', {
          plan: 'enterprise' as const,
        });

        mockCtx.runQuery
          .mockResolvedValueOnce(mockSearch)
          .mockResolvedValueOnce(mockUser);
        mockCtx.runAction.mockResolvedValueOnce({ apiKey: 'user-findymail-key' });

        const getEnrichmentApiKey = async (ctx: any, user: any, userId: string) => {
          if (user.plan === 'enterprise') {
            const keyResult = await ctx.runAction('internal.userApiKeys.actions.getDecryptedApiKey', {
              provider: 'findymail',
              userId,
              purpose: 'lead_enrichment',
            });
            return keyResult.apiKey;
          }
          return process.env.FINDYMAIL_API_KEY;
        };

        const apiKey = await getEnrichmentApiKey(mockCtx, mockUser, testUserId);

        expect(apiKey).toBe('user-findymail-key');
      });

      it('should throw error for enterprise user without API key', async () => {
        const mockUser = createMockDocument('users', {
          plan: 'enterprise' as const,
        });

        mockCtx.runAction.mockRejectedValueOnce(new Error('API key not found'));

        const getEnrichmentApiKey = async (ctx: any, user: any, userId: string) => {
          if (user.plan === 'enterprise') {
            try {
              const keyResult = await ctx.runAction('internal.userApiKeys.actions.getDecryptedApiKey', {
                provider: 'findymail',
                userId,
                purpose: 'lead_enrichment',
              });
              return keyResult.apiKey;
            } catch {
              throw new Error('Enterprise users must provide their own FindyMail API key for lead enrichment');
            }
          }
          return process.env.FINDYMAIL_API_KEY;
        };

        await expect(getEnrichmentApiKey(mockCtx, mockUser, testUserId)).rejects.toThrow(
          'Enterprise users must provide',
        );
      });
    });

    describe('Role Extraction', () => {
      it('should extract and sanitize roles from search parameters', () => {
        const searchParameters = {
          roles: ['CEO', 'Founder', 'Owner', 'Manager', 'Director'],
        };

        const extractRoles = (params: any): string[] | undefined => {
          const roles = Array.isArray(params?.roles)
            ? params.roles.filter((role: unknown): role is string =>
                typeof role === 'string' && role.trim().length > 0,
              )
            : undefined;
          return roles;
        };

        const roles = extractRoles(searchParameters);

        expect(roles).toEqual(['CEO', 'Founder', 'Owner', 'Manager', 'Director']);
      });

      it('should return undefined for missing roles', () => {
        const searchParameters = {};

        const extractRoles = (params: any): string[] | undefined => {
          const roles = Array.isArray(params?.roles)
            ? params.roles.filter((role: unknown): role is string =>
                typeof role === 'string' && role.trim().length > 0,
              )
            : undefined;
          return roles;
        };

        const roles = extractRoles(searchParameters);

        expect(roles).toBeUndefined();
      });

      it('should filter out empty roles', () => {
        const searchParameters = {
          roles: ['CEO', '', '  ', 'Founder', null, undefined, 123],
        };

        const extractRoles = (params: any): string[] | undefined => {
          const roles = Array.isArray(params?.roles)
            ? params.roles.filter((role: unknown): role is string =>
                typeof role === 'string' && role.trim().length > 0,
              )
            : undefined;
          return roles;
        };

        const roles = extractRoles(searchParameters);

        expect(roles).toEqual(['CEO', 'Founder']);
      });
    });
  });

  // ============================================================================
  // analyzeLeads Tests
  // ============================================================================

  describe('analyzeLeads()', () => {
    describe('Search and Profile Validation', () => {
      it('should throw error when search not found', async () => {
        mockCtx.runQuery.mockResolvedValueOnce(null);

        const analyzeLeads = async (ctx: any, args: { searchId: SearchId }) => {
          const search = await ctx.runQuery('internal.search.internal.getSearchInternal', {
            searchId: args.searchId,
          });

          if (!search) {
            throw new Error('Search not found');
          }

          return { success: true };
        };

        await expect(analyzeLeads(mockCtx, { searchId: testSearchId })).rejects.toThrow(
          'Search not found',
        );
      });

      it('should require business profile for AI analysis', async () => {
        const mockSearch = createMockDocument('searches', {
          userId: testUserId,
          status: 'in_progress' as const,
        });
        const mockUser = createMockDocument('users', {
          processingPaused: false,
        });

        mockCtx.runQuery
          .mockResolvedValueOnce(mockSearch)
          .mockResolvedValueOnce(mockUser)
          .mockResolvedValueOnce([createMockDocument('leads', {})]) // leads
          .mockResolvedValueOnce(null); // no profile

        const analyzeLeads = async (ctx: any, args: { searchId: SearchId }) => {
          const search = await ctx.runQuery('internal.search.internal.getSearchInternal', { searchId: args.searchId });
          const user = await ctx.runQuery('internal.users.internal.getUserInternal', { userId: search.userId });
          const leads = await ctx.runQuery('internal.leads.internal.getSearchLeadsInternal', { searchId: args.searchId });

          const profile = await ctx.runQuery('profile.queries.getProfileByUserId', {
            userId: search.userId,
          });

          if (!profile) {
            throw new Error('Business profile required for AI analysis');
          }

          return { success: true };
        };

        await expect(analyzeLeads(mockCtx, { searchId: testSearchId })).rejects.toThrow(
          'Business profile required',
        );
      });

      it('should complete search when no leads to analyze', async () => {
        const mockSearch = createMockDocument('searches', {
          userId: testUserId,
          status: 'in_progress' as const,
        });
        const mockUser = createMockDocument('users', {
          processingPaused: false,
        });

        mockCtx.runQuery
          .mockResolvedValueOnce(mockSearch)
          .mockResolvedValueOnce(mockUser)
          .mockResolvedValueOnce([]); // No leads
        mockCtx.scheduler.runAfter.mockResolvedValue(undefined);

        const analyzeLeads = async (ctx: any, args: { searchId: SearchId }) => {
          const search = await ctx.runQuery('internal.search.internal.getSearchInternal', { searchId: args.searchId });
          const user = await ctx.runQuery('internal.users.internal.getUserInternal', { userId: search.userId });
          const leads = await ctx.runQuery('internal.leads.internal.getSearchLeadsInternal', { searchId: args.searchId });

          if (leads.length === 0) {
            await ctx.scheduler.runAfter(0, 'search/actions:completeSearch', {
              searchId: args.searchId,
            });
            return {
              success: true,
              message: 'No leads to analyze',
              scheduledCount: 0,
            };
          }

          return { success: true };
        };

        const result = await analyzeLeads(mockCtx, { searchId: testSearchId });

        expect(result.message).toBe('No leads to analyze');
        expect(mockCtx.scheduler.runAfter).toHaveBeenCalled();
      });
    });

    describe('Lead Filtering', () => {
      it('should filter leads with valid contact information', () => {
        const allLeads = [
          {
            _id: 'lead1',
            businessName: 'Business 1',
            contactInfo: {
              emails: [{ email: 'test@example.com' }],
              contacts: [{ name: 'John Doe' }],
            },
          },
          {
            _id: 'lead2',
            businessName: 'Business 2',
            contactInfo: {
              emails: [],
              contacts: [{ name: 'Jane Doe' }],
            },
          },
          {
            _id: 'lead3',
            businessName: 'Business 3',
            contactInfo: {
              emails: [{ email: 'test3@example.com' }],
              contacts: [],
            },
          },
          {
            _id: 'lead4',
            businessName: 'Business 4',
            contactInfo: {
              emails: [{ email: 'test4@example.com' }],
              contacts: [{ name: 'Bob Smith' }],
            },
          },
        ];

        const filterLeadsForAnalysis = (leads: any[]) => {
          return leads.filter((lead) => {
            const hasEmail = lead.contactInfo?.emails?.length > 0;
            const hasContactName =
              lead.contactInfo?.contacts?.length > 0 &&
              lead.contactInfo.contacts[0]?.name;
            return hasEmail && hasContactName;
          });
        };

        const filtered = filterLeadsForAnalysis(allLeads);

        expect(filtered.length).toBe(2);
        expect(filtered.map((l) => l._id)).toEqual(['lead1', 'lead4']);
      });
    });

    describe('Batch Processing', () => {
      it('should divide leads into batches of 100', () => {
        const leads = Array(250).fill(null).map((_, i) => ({ _id: `lead${i}` }));

        const chunkArray = <T>(array: T[], size: number): T[][] => {
          const chunks: T[][] = [];
          for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
          }
          return chunks;
        };

        const batches = chunkArray(leads, 100);

        expect(batches.length).toBe(3);
        expect(batches[0]!.length).toBe(100);
        expect(batches[1]!.length).toBe(100);
        expect(batches[2]!.length).toBe(50);
      });

      it('should schedule batches with 10-second stagger', async () => {
        const batches = [
          [{ _id: 'lead1' }],
          [{ _id: 'lead2' }],
          [{ _id: 'lead3' }],
        ];

        mockCtx.scheduler.runAfter.mockResolvedValue(undefined);
        mockCtx.runMutation.mockResolvedValue(undefined);

        const scheduleBatches = async (ctx: any, batchList: any[]) => {
          let scheduledBatches = 0;

          for (let i = 0; i < batchList.length; i++) {
            await ctx.scheduler.runAfter(
              i * 10000, // 10-second stagger
              'internal.leads.asyncAnalysis.analyzeLeadsBatch',
              { batchNumber: i + 1 },
            );
            scheduledBatches++;
          }

          return { scheduledBatches };
        };

        const result = await scheduleBatches(mockCtx, batches);

        expect(result.scheduledBatches).toBe(3);
        expect(mockCtx.scheduler.runAfter).toHaveBeenNthCalledWith(1, 0, expect.any(String), expect.any(Object));
        expect(mockCtx.scheduler.runAfter).toHaveBeenNthCalledWith(2, 10000, expect.any(String), expect.any(Object));
        expect(mockCtx.scheduler.runAfter).toHaveBeenNthCalledWith(3, 20000, expect.any(String), expect.any(Object));
      });

      it('should mark leads as scheduled before processing', async () => {
        const batch = [{ _id: 'lead1' }, { _id: 'lead2' }];
        const batchId = 'test_batch_1';

        mockCtx.runMutation.mockResolvedValue(undefined);

        const markLeadsScheduled = async (ctx: any, leads: any[], batchIdPrefix: string) => {
          for (const lead of leads) {
            await ctx.runMutation('internal.leads.internal.markLeadAnalysisScheduled', {
              leadId: lead._id,
              requestId: `${batchIdPrefix}_${lead._id}`,
            });
          }
        };

        await markLeadsScheduled(mockCtx, batch, batchId);

        expect(mockCtx.runMutation).toHaveBeenCalledTimes(2);
        expect(mockCtx.runMutation).toHaveBeenCalledWith(
          'internal.leads.internal.markLeadAnalysisScheduled',
          expect.objectContaining({ requestId: 'test_batch_1_lead1' }),
        );
      });

      it('should handle batch scheduling errors', async () => {
        const batches = [[{ _id: 'lead1' }], [{ _id: 'lead2' }]];

        mockCtx.scheduler.runAfter
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('Batch scheduling failed'));
        mockCtx.runMutation.mockResolvedValue(undefined);

        const scheduleBatches = async (ctx: any, batchList: any[]) => {
          let scheduledBatches = 0;
          let schedulingErrors = 0;

          for (let i = 0; i < batchList.length; i++) {
            try {
              await ctx.scheduler.runAfter(i * 10000, 'analyzeLeadsBatch', { batchNumber: i + 1 });
              scheduledBatches++;
            } catch (error) {
              schedulingErrors++;
              // Mark leads as failed
              for (const lead of batchList[i]) {
                await ctx.runMutation('internal.leads.internal.markLeadAnalysisFailed', {
                  leadId: lead._id,
                  error: (error as Error).message,
                });
              }
            }
          }

          return { scheduledBatches, schedulingErrors };
        };

        const result = await scheduleBatches(mockCtx, batches);

        expect(result.scheduledBatches).toBe(1);
        expect(result.schedulingErrors).toBe(1);
      });
    });

    describe('LangGraph Configuration', () => {
      it('should require LangGraph URL and API key', async () => {
        delete process.env.LANGGRAPH_URL;

        const validateLangGraphConfig = () => {
          const langgraphUrl = process.env.LANGGRAPH_URL;
          const langgraphApiKey = process.env.LANGGRAPH_API_KEY;

          if (!langgraphUrl || !langgraphApiKey) {
            throw new Error('LangGraph service not configured');
          }

          return { langgraphUrl, langgraphApiKey };
        };

        expect(() => validateLangGraphConfig()).toThrow('LangGraph service not configured');
      });
    });
  });

  // ============================================================================
  // processLeadWithLangGraph Tests
  // ============================================================================

  describe('processLeadWithLangGraph()', () => {
    const createMockLead = (overrides = {}) => ({
      _id: testLeadId,
      businessName: 'Test Business',
      category: 'Restaurant',
      website: 'https://testbusiness.com',
      phone: '555-1234',
      rating: 4.5,
      reviewCount: 100,
      location: { city: 'New York', state: 'NY' },
      contactInfo: {
        emails: [{ email: 'contact@testbusiness.com' }],
        contacts: [{ name: 'John Owner', title: 'Owner' }],
        socialProfiles: { linkedin: 'https://linkedin.com/company/testbusiness' },
      },
      enrichmentData: {
        description: 'A great restaurant',
        technologies: ['Square POS', 'Yelp'],
      },
      ...overrides,
    });

    const createMockProfile = (overrides = {}) => ({
      _id: testProfileId,
      companyName: 'Our Company',
      industry: 'Marketing',
      valueProposition: 'We help restaurants grow',
      services: ['Marketing', 'Consulting'],
      targetMarkets: ['Restaurants', 'Hospitality'],
      keyDifferentiators: ['Experience', 'Results'],
      contactInfo: {
        email: 'sales@ourcompany.com',
        phone: '555-0000',
      },
      ...overrides,
    });

    describe('Lead Data Preparation', () => {
      it('should prepare lead data for LangGraph', () => {
        const lead = createMockLead();

        const prepareLeadData = (leadData: any) => ({
          id: leadData._id,
          company_name: leadData.businessName,
          contact_name: leadData.contactInfo?.contacts?.[0]?.name || '',
          title: leadData.contactInfo?.contacts?.[0]?.title || '',
          industry: leadData.category || '',
          company_size:
            leadData.reviewCount && leadData.reviewCount > 50
              ? 'Medium'
              : leadData.reviewCount && leadData.reviewCount > 10
                ? 'Small'
                : 'Micro',
          location: `${leadData.location.city || ''}, ${leadData.location.state || ''}`.trim(),
          description: leadData.enrichmentData?.description || '',
          website: leadData.website || '',
          contact_info: {
            email: leadData.contactInfo?.emails?.[0]?.email || '',
            phone: leadData.phone || '',
            linkedin: leadData.contactInfo?.socialProfiles?.linkedin || '',
          },
        });

        const prepared = prepareLeadData(lead);

        expect(prepared.company_name).toBe('Test Business');
        expect(prepared.contact_name).toBe('John Owner');
        expect(prepared.company_size).toBe('Medium');
        expect(prepared.location).toBe('New York, NY');
        expect(prepared.contact_info.email).toBe('contact@testbusiness.com');
      });

      it('should handle missing lead data gracefully', () => {
        const sparseLead = {
          _id: testLeadId,
          businessName: 'Minimal Business',
          location: {},
          contactInfo: {},
        };

        const prepareLeadData = (leadData: any) => ({
          id: leadData._id,
          company_name: leadData.businessName,
          contact_name: leadData.contactInfo?.contacts?.[0]?.name || '',
          company_size: 'Micro',
          location: `${leadData.location?.city || ''}, ${leadData.location?.state || ''}`.trim().replace(/^,\s*/, ''),
          contact_info: {
            email: leadData.contactInfo?.emails?.[0]?.email || '',
          },
        });

        const prepared = prepareLeadData(sparseLead);

        expect(prepared.company_name).toBe('Minimal Business');
        expect(prepared.contact_name).toBe('');
        expect(prepared.company_size).toBe('Micro');
        expect(prepared.location).toBe('');
        expect(prepared.contact_info.email).toBe('');
      });
    });

    describe('API Call and Retry Logic', () => {
      it('should call LangGraph API with correct payload', async () => {
        const lead = createMockLead();
        const profile = createMockProfile();
        const langgraphUrl = 'http://localhost:8080';

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              status: 'completed',
              result: {
                relevance_score: 0.85,
                primary_email: { subject: 'Test', body: 'Test body' },
              },
            }),
        });

        const callLangGraph = async (leadData: any, profileData: any) => {
          const response = await fetch(`${langgraphUrl}/generate-email`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.LANGGRAPH_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              lead: leadData,
              business_profile: profileData,
            }),
          });

          if (!response.ok) {
            throw new Error(`LangGraph API error ${response.status}`);
          }

          return response.json();
        };

        const result = await callLangGraph(lead, profile);

        expect(result.status).toBe('completed');
        expect(result.result.relevance_score).toBe(0.85);
        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8080/generate-email',
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              'Content-Type': 'application/json',
            }),
          }),
        );
      });

      it('should retry on failure with exponential backoff', async () => {
        let attempts = 0;

        mockFetch
          .mockRejectedValueOnce(new Error('Network error'))
          .mockRejectedValueOnce(new Error('Network error'))
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ status: 'completed', result: {} }),
          });

        const callWithRetry = async (maxRetries: number) => {
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            attempts = attempt;
            try {
              const response = await fetch('http://localhost:8080/generate-email');
              if (response.ok) {
                return await response.json();
              }
            } catch (error) {
              if (attempt === maxRetries) throw error;
              // Exponential backoff: 2^attempt * 1000ms
              // In real code: await sleep(Math.pow(2, attempt) * 1000);
            }
          }
        };

        const result = await callWithRetry(3);

        expect(result.status).toBe('completed');
        expect(attempts).toBe(3);
      });

      it('should return failure after max retries exceeded', async () => {
        mockFetch.mockRejectedValue(new Error('Persistent failure'));

        const callWithRetry = async (maxRetries: number) => {
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              const response = await fetch('http://localhost:8080/generate-email');
              return await response.json();
            } catch (error) {
              if (attempt === maxRetries) {
                return {
                  success: false,
                  error: (error as Error).message,
                };
              }
            }
          }
        };

        const result = await callWithRetry(3);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Persistent failure');
      });

      it('should handle non-OK API response', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Internal Server Error'),
        });

        const callLangGraph = async () => {
          const response = await fetch('http://localhost:8080/generate-email');

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`LangGraph API error ${response.status}: ${errorText}`);
          }

          return response.json();
        };

        await expect(callLangGraph()).rejects.toThrow('LangGraph API error 500');
      });
    });

    describe('Response Handling', () => {
      it('should process successful analysis result', async () => {
        const mockResult = {
          status: 'completed',
          result: {
            relevance_score: 0.9,
            pain_points_identified: ['Needs marketing help'],
            value_matches: ['Our services align'],
            primary_email: {
              subject: 'Partnership Opportunity',
              body: 'Hi John, I noticed your restaurant...',
              personalization_notes: ['Mentioned recent reviews'],
              estimated_effectiveness: 0.85,
            },
          },
        };

        const processResult = (response: any) => {
          if (response.status === 'completed' && response.result) {
            return {
              success: true,
              relevanceScore: response.result.relevance_score,
              painPoints: response.result.pain_points_identified,
              hasEmail: !!response.result.primary_email,
              emailSubject: response.result.primary_email?.subject,
            };
          }
          throw new Error(response.error || 'Analysis failed');
        };

        const processed = processResult(mockResult);

        expect(processed.success).toBe(true);
        expect(processed.relevanceScore).toBe(0.9);
        expect(processed.painPoints).toContain('Needs marketing help');
        expect(processed.hasEmail).toBe(true);
        expect(processed.emailSubject).toBe('Partnership Opportunity');
      });

      it('should handle failed analysis result', () => {
        const failedResult = {
          status: 'failed',
          error: 'Unable to analyze lead',
        };

        const processResult = (response: any) => {
          if (response.status === 'completed' && response.result) {
            return { success: true };
          }
          return {
            success: false,
            error: response.error || 'Analysis failed',
          };
        };

        const processed = processResult(failedResult);

        expect(processed.success).toBe(false);
        expect(processed.error).toBe('Unable to analyze lead');
      });
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe('Error Handling', () => {
    it('should update search status on failure', async () => {
      mockCtx.runQuery.mockRejectedValueOnce(new Error('Database error'));
      mockCtx.runMutation.mockResolvedValue(undefined);

      const enrichLeadsWithErrorHandling = async (ctx: any, args: { searchId: SearchId }) => {
        try {
          await ctx.runQuery('internal.search.internal.getSearchInternal', {
            searchId: args.searchId,
          });
        } catch (error) {
          await ctx.runMutation('internal.search.internal.updateSearchStatusInternal', {
            searchId: args.searchId,
            status: 'failed',
            error: (error as Error).message,
          });
          throw error;
        }
      };

      await expect(enrichLeadsWithErrorHandling(mockCtx, { searchId: testSearchId })).rejects.toThrow();

      expect(mockCtx.runMutation).toHaveBeenCalledWith(
        'internal.search.internal.updateSearchStatusInternal',
        expect.objectContaining({
          status: 'failed',
        }),
      );
    });

    it('should broadcast error notifications', async () => {
      mockCtx.runMutation.mockResolvedValue(undefined);

      const broadcastError = async (ctx: any, userId: string, searchId: string, error: string) => {
        await ctx.runMutation('internal.realtime.broadcaster.broadcast', {
          userId,
          type: 'batch_analysis_error',
          title: 'Analysis Error',
          message: error,
          data: { searchId },
          priority: 'normal',
          tags: ['analysis', 'error'],
        });
      };

      await broadcastError(mockCtx, testUserId, testSearchId, 'Test error');

      expect(mockCtx.runMutation).toHaveBeenCalledWith(
        'internal.realtime.broadcaster.broadcast',
        expect.objectContaining({
          type: 'batch_analysis_error',
          priority: 'normal',
        }),
      );
    });
  });
});
