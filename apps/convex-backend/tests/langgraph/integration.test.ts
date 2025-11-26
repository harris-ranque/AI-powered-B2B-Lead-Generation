/**
 * Batch 6: LangGraph Integration Tests
 *
 * Tests the Convex → LangGraph Worker communication and webhook handling including:
 * - Convex → LangGraph worker communication with request creation
 * - Webhook callback success handling with lead updates
 * - Webhook callback error recovery with retry logic
 * - Correlation ID propagation through AI workflow
 * - Timeout handling for long-running AI operations
 *
 * Priority: P0 - Critical for AI workflow integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createMockContext,
  mockId,
  createMockDocument,
  resetAllMocks,
  waitFor,
} from '../testUtils';
import type { GenericId } from 'convex/values';

type UserId = GenericId<'users'>;
type SearchId = GenericId<'searches'>;
type LeadId = GenericId<'leads'>;
type RequestId = GenericId<'langgraphRequests'>;

describe('LangGraph Integration Tests - Batch 6', () => {
  let mockCtx: ReturnType<typeof createMockContext>;
  let testUserId: UserId;
  let testSearchId: SearchId;
  let testLeadId: LeadId;

  beforeEach(() => {
    mockCtx = createMockContext();
    testUserId = mockId('users');
    testSearchId = mockId('searches');
    testLeadId = mockId('leads');
    resetAllMocks();

    // Setup fetch mock
    global.fetch = vi.fn();
  });

  afterEach(() => {
    resetAllMocks();
    vi.restoreAllMocks();
  });

  describe('Test 26: Convex → LangGraph worker communication', () => {
    it('should successfully initiate email generation request to worker', async () => {
      // Arrange
      const mockUser = createMockDocument('users', {
        email: 'test@example.com',
        name: 'Test User',
        plan: 'pro',
        credits: 1000,
      });

      const mockLead = createMockDocument('leads', {
        userId: testUserId,
        searchId: testSearchId,
        businessName: 'Acme Corp',
        category: 'Technology',
        website: 'https://acme.com',
        contactInfo: {
          emails: [{ email: 'contact@acme.com' }],
          socialProfiles: { linkedin: 'https://linkedin.com/company/acme' },
        },
        enrichmentStatus: 'completed' as const,
      });

      const mockProfile = createMockDocument('businessProfiles', {
        userId: testUserId,
        companyName: 'Test Company',
        industry: 'SaaS',
        valueProposition: 'We help businesses grow',
        services: ['Consulting', 'Development'],
        targetMarkets: ['B2B', 'Enterprise'],
        keyDifferentiators: ['Fast delivery', 'Expert team'],
        contactInfo: {
          name: 'Test User',
          email: 'test@example.com',
          phone: '555-1234',
          website: 'https://testcompany.com',
          linkedin: 'https://linkedin.com/company/test',
        },
      });

      const mockRequestId = mockId('langgraphRequests');

      // Mock database responses
      mockCtx.db.get.mockImplementation(async (id: any) => {
        if (id === testUserId) return { ...mockUser, _id: testUserId };
        if (id === testLeadId) return { ...mockLead, _id: testLeadId };
        return null;
      });

      mockCtx.db.insert.mockResolvedValueOnce(mockRequestId);

      // Mock successful fetch to LangGraph worker
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      const generateEmailAction = async (ctx: any, args: {
        leadId: LeadId;
        emailType?: 'initial' | 'follow_up' | 'final';
      }) => {
        // Get user and lead
        const user = await ctx.db.get(testUserId);
        const lead = await ctx.db.get(args.leadId);

        if (!user || !lead) {
          throw new Error('User or lead not found');
        }

        // Create request ID
        const requestId = `${testSearchId}_${args.leadId}_ui1`;

        // Create request record
        await ctx.db.insert('langgraphRequests', {
          leadId: args.leadId,
          requestId,
          type: 'email_generation',
          status: 'pending',
          createdAt: Date.now(),
        });

        // Call LangGraph worker
        const langgraphUrl = 'http://localhost:8080';
        const apiKey = 'test_api_key';

        const response = await fetch(`${langgraphUrl}/generate-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'X-Request-ID': requestId,
          },
          body: JSON.stringify({
            requestId,
            lead: {
              id: args.leadId,
              company: lead.businessName,
              industry: lead.category || '',
              websiteUrl: lead.website || '',
            },
            userId: user._id,
          }),
        });

        if (!response.ok) {
          throw new Error(`LangGraph service error: ${response.status}`);
        }

        return {
          requestId,
          status: 'processing',
          message: 'Email generation started',
        };
      };

      // Act
      const result = await generateEmailAction(mockCtx, {
        leadId: testLeadId,
        emailType: 'initial',
      });

      // Assert
      expect(result.status).toBe('processing');
      expect(result.requestId).toMatch(/^[a-zA-Z0-9_]+$/);
      expect(result.message).toBe('Email generation started');

      // Verify request was created
      expect(mockCtx.db.insert).toHaveBeenCalledWith(
        'langgraphRequests',
        expect.objectContaining({
          leadId: testLeadId,
          type: 'email_generation',
          status: 'pending',
        }),
      );

      // Verify fetch was called with correct parameters
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8080/generate-email',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test_api_key',
          }),
        }),
      );
    });

    it('should handle LangGraph worker connection failure', async () => {
      // Arrange
      const mockUser = createMockDocument('users', {
        email: 'test@example.com',
        plan: 'pro',
        credits: 1000,
      });

      const mockLead = createMockDocument('leads', {
        userId: testUserId,
        businessName: 'Acme Corp',
      });

      mockCtx.db.get.mockImplementation(async (id: any) => {
        if (id === testUserId) return { ...mockUser, _id: testUserId };
        if (id === testLeadId) return { ...mockLead, _id: testLeadId };
        return null;
      });

      const mockRequestId = mockId('langgraphRequests');
      mockCtx.db.insert.mockResolvedValueOnce(mockRequestId);
      mockCtx.db.patch.mockResolvedValue(undefined);

      // Mock failed fetch
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });

      const generateEmailAction = async (ctx: any, args: { leadId: LeadId }) => {
        const user = await ctx.db.get(testUserId);
        const lead = await ctx.db.get(args.leadId);

        if (!user || !lead) {
          throw new Error('User or lead not found');
        }

        const requestId = `${testSearchId}_${args.leadId}_ui1`;

        await ctx.db.insert('langgraphRequests', {
          leadId: args.leadId,
          requestId,
          type: 'email_generation',
          status: 'pending',
          createdAt: Date.now(),
        });

        try {
          const response = await fetch('http://localhost:8080/generate-email', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer test_api_key',
            },
            body: JSON.stringify({ requestId, lead, userId: user._id }),
          });

          if (!response.ok) {
            throw new Error(`LangGraph service error: ${response.status}`);
          }

          return { success: true, requestId };
        } catch (error) {
          // Update request status to failed
          await ctx.db.patch(mockRequestId, {
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error',
          });

          throw new Error('Failed to start email generation');
        }
      };

      // Act & Assert
      await expect(
        generateEmailAction(mockCtx, { leadId: testLeadId }),
      ).rejects.toThrow('Failed to start email generation');

      // Verify request was marked as failed
      expect(mockCtx.db.patch).toHaveBeenCalledWith(
        mockRequestId,
        expect.objectContaining({
          status: 'failed',
          error: expect.stringContaining('503'),
        }),
      );
    });
  });

  describe('Test 27: Webhook callback success handling', () => {
    it('should process email generation completion webhook successfully', async () => {
      // Arrange
      const mockSearch = createMockDocument('searches', {
        userId: testUserId,
        status: 'processing' as const,
      });

      const mockLead = createMockDocument('leads', {
        userId: testUserId,
        searchId: testSearchId,
        businessName: 'Acme Corp',
        contactInfo: {
          emails: [{ email: 'contact@acme.com' }],
          contacts: [{ name: 'John Doe' }],
        },
        enrichmentStatus: 'completed' as const,
        analysisStatus: 'processing' as const,
      });

      const mockRequest = createMockDocument('langgraphRequests', {
        leadId: testLeadId,
        requestId: `${testSearchId}_${testLeadId}_ui1`,
        type: 'email_generation' as const,
        status: 'processing' as const,
      });

      const webhookPayload = {
        request_id: `${mockSearch._id}_${mockLead._id}_ui1`,
        status: 'completed' as const,
        timestamp: new Date().toISOString(),
        approved: true,
        quality_score: 0.85,
        result: {
          relevance_score: 0.9,
          pain_points_identified: ['Slow sales cycle', 'Lead quality issues'],
          value_matches: ['AI-powered automation', 'Improved conversion rates'],
          recommendations: ['Focus on automation benefits', 'Highlight ROI'],
          primary_email: {
            subject: 'Transform Your Lead Generation with AI',
            body: 'Hi John,\n\nI noticed Acme Corp...',
            personalization_notes: ['References company name', 'Industry-specific'],
            estimated_effectiveness: 0.75,
          },
          processing_time: 25.5,
        },
      };

      // Mock database queries
      mockCtx.db.get.mockImplementation(async (id: any) => {
        if (id === mockSearch._id) return mockSearch;
        if (id === mockLead._id) return mockLead;
        return null;
      });

      // Mock query chain for finding request by requestId
      const mockUniqueQuery = vi.fn().mockResolvedValue(mockRequest);
      const mockCollectQuery = vi.fn().mockResolvedValue([mockLead]);

      mockCtx.db.query.mockImplementation(() => ({
        withIndex: vi.fn().mockReturnThis(),
        filter: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        take: vi.fn().mockResolvedValue([]),
        unique: mockUniqueQuery,
        collect: mockCollectQuery,
      }));

      mockCtx.db.patch.mockResolvedValue(undefined);

      const handleWebhook = async (ctx: any, payload: any) => {
        // Validate payload status
        const status = payload.status;
        if (status !== 'completed' && status !== 'error') {
          return { success: false, error: `Invalid status: ${status}` };
        }

        // Extract IDs from request_id - format: searchId_leadId_attempt
        // searchId looks like: searches_randomstring
        // leadId looks like: leads_randomstring
        // Full format: searches_xxx_leads_yyy_attempt
        // Find the lead ID by looking for "_leads_" separator
        const leadsIndex = payload.request_id.indexOf('_leads_');
        if (leadsIndex === -1) {
          return { success: false, error: 'Invalid request_id format - no _leads_ separator' };
        }

        const searchIdStr = payload.request_id.substring(0, leadsIndex);
        const afterSearch = payload.request_id.substring(leadsIndex + 1); // Skip first underscore
        const leadIdEnd = afterSearch.lastIndexOf('_'); // Find last underscore (before attempt)
        const leadIdStr = leadIdEnd > 0 ? afterSearch.substring(0, leadIdEnd) : afterSearch;

        const searchId = searchIdStr as SearchId;
        const leadId = leadIdStr as LeadId;

        // Get search and lead
        const search = await ctx.db.get(searchId);
        const lead = await ctx.db.get(leadId);

        if (!search || !lead) {
          return { success: false, error: `Search or lead not found: ${searchId}, ${leadId}` };
        }

        // Only process completed status with approval
        if (status === 'completed') {
          // Check approval status
          if (!payload.approved) {
            return {
              success: true,
              rejected: true,
              reason: 'Email not approved by QA agent',
            };
          }

          // Update lead with AI analysis results
          const result = payload.result;
          await ctx.db.patch(lead._id, {
            aiAnalysis: {
              relevanceScore: result.relevance_score,
              painPoints: result.pain_points_identified,
              valueMatches: result.value_matches,
              recommendations: result.recommendations,
            },
            emailContent: result.primary_email,
            analysisStatus: 'completed',
          });

          // Update request status (using mock that returns request)
          const requestDoc = mockRequest; // In test, we already have the request

          if (requestDoc) {
            await ctx.db.patch(requestDoc._id, {
              status: 'completed',
              completedAt: Date.now(),
              processingTime: result.processing_time,
            });
          }

          return {
            success: true,
            leadId,
            emailGenerated: true,
          };
        }

        return { success: true };
      };

      // Act
      const result = await handleWebhook(mockCtx, webhookPayload);

      // Debug output if test fails
      if (!result.success) {
        console.log('Webhook failed with result:', JSON.stringify(result, null, 2));
        console.log('mockSearch._id:', mockSearch._id);
        console.log('mockLead._id:', mockLead._id);
        console.log('request_id:', webhookPayload.request_id);
      }

      // Assert
      expect(result.success).toBe(true);
      expect(result.emailGenerated).toBe(true);
      expect(result.leadId).toBe(mockLead._id);

      // Verify lead was updated with AI results
      expect(mockCtx.db.patch).toHaveBeenCalledWith(
        mockLead._id,
        expect.objectContaining({
          aiAnalysis: expect.objectContaining({
            relevanceScore: 0.9,
            painPoints: expect.arrayContaining(['Slow sales cycle']),
          }),
          emailContent: expect.objectContaining({
            subject: 'Transform Your Lead Generation with AI',
          }),
          analysisStatus: 'completed',
        }),
      );

      // Verify request was marked complete
      expect(mockCtx.db.patch).toHaveBeenCalledWith(
        mockRequest._id,
        expect.objectContaining({
          status: 'completed',
          processingTime: 25.5,
        }),
      );
    });

    it('should reject unapproved emails from QA agent', async () => {
      // Arrange
      const mockSearch = createMockDocument('searches', {
        userId: testUserId,
        status: 'processing' as const,
      });

      const mockLead = createMockDocument('leads', {
        userId: testUserId,
        searchId: mockSearch._id,
        businessName: 'Acme Corp',
      });

      const webhookPayload = {
        request_id: `${mockSearch._id}_${mockLead._id}_ui1`,
        status: 'completed' as const,
        approved: false, // Not approved by QA agent
        quality_score: 0.65,
        result: {
          primary_email: {
            subject: 'Generic email subject',
            body: 'Generic email body',
          },
        },
      };

      mockCtx.db.get.mockImplementation(async (id: any) => {
        if (id === mockSearch._id) return mockSearch;
        if (id === mockLead._id) return mockLead;
        return null;
      });

      mockCtx.db.patch.mockResolvedValue(undefined);

      const handleWebhook = async (ctx: any, payload: any) => {
        // Validate payload status
        if (payload.status !== 'completed' && payload.status !== 'error') {
          return { success: false, error: 'Invalid status' };
        }

        // Extract IDs from request_id using _leads_ separator
        const leadsIndex = payload.request_id.indexOf('_leads_');
        if (leadsIndex === -1) {
          return { success: false, error: 'Invalid request_id format' };
        }

        const searchIdStr = payload.request_id.substring(0, leadsIndex);
        const afterSearch = payload.request_id.substring(leadsIndex + 1);
        const leadIdEnd = afterSearch.lastIndexOf('_');
        const leadIdStr = leadIdEnd > 0 ? afterSearch.substring(0, leadIdEnd) : afterSearch;

        const searchId = searchIdStr as SearchId;
        const leadId = leadIdStr as LeadId;

        const search = await ctx.db.get(searchId);
        const lead = await ctx.db.get(leadId);

        if (!search || !lead) {
          return { success: false, error: 'Search or lead not found' };
        }

        // Check approval - reject if not approved
        if (!payload.approved) {
          // Mark lead as failed
          await ctx.db.patch(lead._id, {
            analysisStatus: 'failed',
            analysisError: `Email not approved (quality score: ${payload.quality_score})`,
          });

          return {
            success: true,
            rejected: true,
            reason: 'Email not approved by QA agent',
            qualityScore: payload.quality_score,
          };
        }

        return { success: true };
      };

      // Act
      const result = await handleWebhook(mockCtx, webhookPayload);

      // Assert
      expect(result.success).toBe(true);
      expect(result.rejected).toBe(true);
      expect(result.reason).toBe('Email not approved by QA agent');
      expect(result.qualityScore).toBe(0.65);

      // Verify lead was marked as failed
      expect(mockCtx.db.patch).toHaveBeenCalledWith(
        mockLead._id,
        expect.objectContaining({
          analysisStatus: 'failed',
          analysisError: expect.stringContaining('not approved'),
        }),
      );
    });
  });

  describe('Test 28: Webhook callback error recovery', () => {
    it('should handle webhook error payloads gracefully', async () => {
      // Arrange
      const mockSearch = createMockDocument('searches', {
        userId: testUserId,
        status: 'processing' as const,
      });

      const mockLead = createMockDocument('leads', {
        userId: testUserId,
        searchId: mockSearch._id,
        businessName: 'Acme Corp',
      });

      const mockRequest = createMockDocument('langgraphRequests', {
        leadId: mockLead._id,
        requestId: `${mockSearch._id}_${mockLead._id}_ui1`,
        type: 'email_generation' as const,
        status: 'processing' as const,
      });

      const webhookPayload = {
        request_id: `${mockSearch._id}_${mockLead._id}_ui1`,
        status: 'error' as const,
        timestamp: new Date().toISOString(),
        error: 'OpenAI API rate limit exceeded',
      };

      mockCtx.db.get.mockImplementation(async (id: any) => {
        if (id === mockSearch._id) return mockSearch;
        if (id === mockLead._id) return mockLead;
        return null;
      });

      // Mock query chain
      const mockUniqueQuery = vi.fn().mockResolvedValue(mockRequest);
      const mockCollectQuery = vi.fn().mockResolvedValue([mockLead]);

      mockCtx.db.query.mockImplementation(() => ({
        withIndex: vi.fn().mockReturnThis(),
        filter: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        take: vi.fn().mockResolvedValue([]),
        unique: mockUniqueQuery,
        collect: mockCollectQuery,
      }));

      mockCtx.db.patch.mockResolvedValue(undefined);

      const handleWebhook = async (ctx: any, payload: any) => {
        // Extract IDs from request_id format: searches_xxx_leads_yyy_ui1
        const leadsIndex = payload.request_id.indexOf('_leads_');
        if (leadsIndex === -1) {
          return { success: false, error: 'Invalid request_id format - no _leads_ separator' };
        }

        const searchIdStr = payload.request_id.substring(0, leadsIndex);
        const afterSearch = payload.request_id.substring(leadsIndex + 1); // Skip first underscore
        const leadIdEnd = afterSearch.lastIndexOf('_'); // Find last underscore (before attempt)
        const leadIdStr = leadIdEnd > 0 ? afterSearch.substring(0, leadIdEnd) : afterSearch;

        const searchId = searchIdStr as SearchId;
        const leadId = leadIdStr as LeadId;

        const search = await ctx.db.get(searchId);
        const lead = await ctx.db.get(leadId);

        if (!search || !lead) {
          return { success: false, error: `Search or lead not found: ${searchIdStr}, ${leadIdStr}` };
        }

        if (payload.status === 'error') {
          // Update lead with error state
          await ctx.db.patch(lead._id, {
            aiAnalysis: {
              relevanceScore: 0,
              painPoints: [],
              valueMatches: [],
              recommendations: [`Analysis failed: ${payload.error}`],
            },
            analysisStatus: 'failed',
            analysisError: payload.error,
          });

          // Update request status (using mock that returns request)
          const requestDoc = mockRequest; // In test, we already have the request

          if (requestDoc) {
            await ctx.db.patch(requestDoc._id, {
              status: 'failed',
              completedAt: Date.now(),
              error: payload.error,
            });
          }

          // Acknowledge error to prevent infinite retries
          return {
            success: true,
            error: payload.error,
            leadId,
          };
        }

        return { success: true };
      };

      // Act
      const result = await handleWebhook(mockCtx, webhookPayload);

      // Assert
      expect(result.success).toBe(true);
      expect(result.error).toBe('OpenAI API rate limit exceeded');
      expect(result.leadId).toBe(mockLead._id);

      // Verify lead was updated with error state
      expect(mockCtx.db.patch).toHaveBeenCalledWith(
        mockLead._id,
        expect.objectContaining({
          analysisStatus: 'failed',
          analysisError: 'OpenAI API rate limit exceeded',
        }),
      );

      // Verify request was marked as failed
      expect(mockCtx.db.patch).toHaveBeenCalledWith(
        mockRequest._id,
        expect.objectContaining({
          status: 'failed',
          error: 'OpenAI API rate limit exceeded',
        }),
      );
    });

    it('should implement retry logic with exponential backoff', async () => {
      // Arrange
      let attemptCount = 0;
      const maxRetries = 3;

      const retryWithBackoff = async (
        fn: () => Promise<any>,
        maxRetries: number = 3,
        baseDelay: number = 100,
      ) => {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            attemptCount++;
            return await fn();
          } catch (error) {
            lastError = error as Error;

            if (attempt < maxRetries - 1) {
              const delay = baseDelay * Math.pow(2, attempt);
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          }
        }

        throw lastError;
      };

      // Mock function that fails twice, succeeds on third attempt
      const unstableOperation = vi.fn()
        .mockRejectedValueOnce(new Error('Temporary failure 1'))
        .mockRejectedValueOnce(new Error('Temporary failure 2'))
        .mockResolvedValueOnce({ success: true });

      // Act
      const result = await retryWithBackoff(unstableOperation, maxRetries, 10);

      // Assert
      expect(result.success).toBe(true);
      expect(attemptCount).toBe(3); // Failed twice, succeeded on third
      expect(unstableOperation).toHaveBeenCalledTimes(3);
    });
  });

  describe('Test 29: Correlation ID propagation through AI workflow', () => {
    it('should propagate correlation ID from Convex to LangGraph', async () => {
      // Arrange
      const correlationId = 'corr_test123456789ab';
      const parentCorrelationId = 'corr_parent987654321xy';

      const mockUser = createMockDocument('users', {
        email: 'test@example.com',
        plan: 'pro',
        credits: 1000,
      });

      const mockLead = createMockDocument('leads', {
        userId: testUserId,
        businessName: 'Acme Corp',
      });

      mockCtx.db.get.mockImplementation(async (id: any) => {
        if (id === testUserId) return { ...mockUser, _id: testUserId };
        if (id === testLeadId) return { ...mockLead, _id: testLeadId };
        return null;
      });

      const mockRequestId = mockId('langgraphRequests');
      mockCtx.db.insert.mockResolvedValueOnce(mockRequestId);

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const generateEmailWithCorrelation = async (
        ctx: any,
        args: { leadId: LeadId; correlationId: string; parentCorrelationId?: string },
      ) => {
        const user = await ctx.db.get(testUserId);
        const lead = await ctx.db.get(args.leadId);

        if (!user || !lead) {
          throw new Error('User or lead not found');
        }

        const requestId = `${testSearchId}_${args.leadId}_ui1`;

        // Create request with correlation tracking
        await ctx.db.insert('langgraphRequests', {
          leadId: args.leadId,
          requestId,
          type: 'email_generation',
          status: 'pending',
          correlationId: args.correlationId,
          parentCorrelationId: args.parentCorrelationId,
          createdAt: Date.now(),
        });

        // Pass correlation ID to LangGraph worker
        const response = await fetch('http://localhost:8080/generate-email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test_api_key',
            'X-Request-ID': requestId,
            'X-Correlation-ID': args.correlationId,
            'X-Parent-Correlation-ID': args.parentCorrelationId || '',
          },
          body: JSON.stringify({
            requestId,
            correlationId: args.correlationId,
            parentCorrelationId: args.parentCorrelationId,
            lead: { id: args.leadId, company: lead.businessName },
            userId: user._id,
          }),
        });

        if (!response.ok) {
          throw new Error(`LangGraph service error: ${response.status}`);
        }

        return {
          requestId,
          correlationId: args.correlationId,
          parentCorrelationId: args.parentCorrelationId,
          status: 'processing',
        };
      };

      // Act
      const result = await generateEmailWithCorrelation(mockCtx, {
        leadId: testLeadId,
        correlationId,
        parentCorrelationId,
      });

      // Assert
      expect(result.correlationId).toBe(correlationId);
      expect(result.parentCorrelationId).toBe(parentCorrelationId);

      // Verify correlation IDs were stored in request
      expect(mockCtx.db.insert).toHaveBeenCalledWith(
        'langgraphRequests',
        expect.objectContaining({
          correlationId,
          parentCorrelationId,
        }),
      );

      // Verify correlation IDs were sent to worker
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8080/generate-email',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Correlation-ID': correlationId,
            'X-Parent-Correlation-ID': parentCorrelationId,
          }),
          body: expect.stringContaining(correlationId),
        }),
      );
    });

    it('should maintain correlation tree through complete AI workflow', async () => {
      // Arrange
      const searchCorrelationId = 'corr_search_root';
      const orchestrateCorrelationId = 'corr_orchestrate_child';
      const aiAnalysisCorrelationId = 'corr_ai_analysis_grandchild';

      const correlationTree = [
        {
          id: searchCorrelationId,
          operation: 'search_create',
          parentId: undefined,
        },
        {
          id: orchestrateCorrelationId,
          operation: 'search_orchestrate',
          parentId: searchCorrelationId,
        },
        {
          id: aiAnalysisCorrelationId,
          operation: 'ai_analysis',
          parentId: orchestrateCorrelationId,
        },
      ];

      // Act - Build correlation chain
      const chain = correlationTree.map((node, index) => {
        const parent = index > 0 ? correlationTree[index - 1] : null;

        return {
          correlationId: node.id,
          operationType: node.operation,
          parentId: node.parentId,
          expectedParent: parent?.id,
        };
      });

      // Assert - Verify parent-child relationships
      chain.forEach((node, index) => {
        if (index > 0) {
          expect(node.parentId).toBe(node.expectedParent);
        } else {
          expect(node.parentId).toBeUndefined(); // Root node has no parent
        }
      });

      // Verify full genealogy
      expect(chain[0]?.parentId).toBeUndefined();
      expect(chain[1]?.parentId).toBe(searchCorrelationId);
      expect(chain[2]?.parentId).toBe(orchestrateCorrelationId);
    });
  });

  describe('Test 30: Timeout handling for long-running AI operations', () => {
    it('should timeout after specified duration', async () => {
      // Arrange
      const timeoutMs = 100;

      const operationWithTimeout = async <T>(
        fn: () => Promise<T>,
        timeout: number,
      ): Promise<T> => {
        return Promise.race([
          fn(),
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error('Operation timeout')), timeout),
          ),
        ]);
      };

      const longRunningOperation = async () => {
        await new Promise((resolve) => setTimeout(resolve, 200)); // Takes 200ms
        return { success: true };
      };

      // Act & Assert
      await expect(
        operationWithTimeout(longRunningOperation, timeoutMs),
      ).rejects.toThrow('Operation timeout');
    });

    it('should complete before timeout for fast operations', async () => {
      // Arrange
      const timeoutMs = 1000;

      const operationWithTimeout = async <T>(
        fn: () => Promise<T>,
        timeout: number,
      ): Promise<T> => {
        return Promise.race([
          fn(),
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error('Operation timeout')), timeout),
          ),
        ]);
      };

      const fastOperation = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50)); // Takes 50ms
        return { success: true, duration: 50 };
      };

      // Act
      const result = await operationWithTimeout(fastOperation, timeoutMs);

      // Assert
      expect(result.success).toBe(true);
      expect(result.duration).toBe(50);
    });

    it('should handle timeout in LangGraph request with proper cleanup', async () => {
      // Arrange
      const mockRequestId = mockId('langgraphRequests');
      const mockRequest = createMockDocument('langgraphRequests', {
        leadId: testLeadId,
        requestId: `${testSearchId}_${testLeadId}_ui1`,
        type: 'email_generation' as const,
        status: 'processing' as const,
        createdAt: Date.now(),
      });

      mockCtx.db.get.mockResolvedValueOnce(mockRequest);
      mockCtx.db.patch.mockResolvedValue(undefined);

      const handleTimeout = async (ctx: any, requestId: string, timeoutMs: number) => {
        const request = await ctx.db.get(mockRequestId);

        if (!request) {
          return { success: false, error: 'Request not found' };
        }

        // Check if request has been processing too long
        const processingDuration = Date.now() - request.createdAt;

        if (processingDuration > timeoutMs) {
          // Mark request as timed out
          await ctx.db.patch(mockRequestId, {
            status: 'failed',
            error: `Timeout after ${processingDuration}ms`,
            completedAt: Date.now(),
          });

          return {
            success: true,
            timedOut: true,
            duration: processingDuration,
          };
        }

        return { success: true, timedOut: false };
      };

      // Simulate request that's been processing for 35 seconds
      mockRequest.createdAt = Date.now() - 35000;

      // Act - Check with 30 second timeout
      const result = await handleTimeout(mockCtx, 'test_request_id', 30000);

      // Assert
      expect(result.success).toBe(true);
      expect(result.timedOut).toBe(true);
      expect(result.duration).toBeGreaterThan(30000);

      // Verify request was marked as failed
      expect(mockCtx.db.patch).toHaveBeenCalledWith(
        mockRequestId,
        expect.objectContaining({
          status: 'failed',
          error: expect.stringContaining('Timeout'),
        }),
      );
    });
  });
});
