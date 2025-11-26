/**
 * Batch 4: Correlation System Tests
 *
 * Tests the correlation ID system for operation tracking including:
 * - generateCorrelationId() - Generates unique IDs
 * - createCorrelationContext() - Creates valid context
 * - createChildContext() - Maintains parent-child relationships
 * - logWithCorrelation() - Performance <100ms validation
 * - Full correlation tree tracing
 *
 * Priority: P1 - Critical for observability and debugging capability
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateCorrelationId,
  createCorrelationContext,
  createChildContext,
  logWithCorrelation,
  createLogEntry,
  OPERATION_TYPES,
  type CorrelationContext,
  type LogContext,
} from '../../convex/lib/correlation';

describe('Correlation System Tests - Batch 4', () => {
  const testUserId = 'user_test_123';
  const testSearchId = 'search_test_456';
  const testLeadId = 'lead_test_789';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Test 16: generateCorrelationId() - Generates unique IDs', () => {
    it('should generate correlation IDs with correct format', () => {
      // Act
      const id1 = generateCorrelationId();
      const id2 = generateCorrelationId();

      // Assert
      expect(id1).toMatch(/^corr_[a-f0-9]{16}$/);
      expect(id2).toMatch(/^corr_[a-f0-9]{16}$/);
      expect(id1).not.toBe(id2); // IDs should be unique
    });

    it('should generate unique IDs consistently', () => {
      // Act - Generate 100 IDs
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateCorrelationId());
      }

      // Assert - All should be unique
      expect(ids.size).toBe(100);
    });

    it('should generate IDs with correct length', () => {
      // Act
      const id = generateCorrelationId();

      // Assert
      expect(id.length).toBe(21); // 'corr_' (5) + 16 hex chars = 21
      expect(id.startsWith('corr_')).toBe(true);
    });
  });

  describe('Test 17: createCorrelationContext() - Creates valid context', () => {
    it('should create basic correlation context with required fields', () => {
      // Arrange
      const operationType = OPERATION_TYPES.SEARCH_CREATE;

      // Act
      const context = createCorrelationContext(operationType, testUserId);

      // Assert
      expect(context.correlationId).toMatch(/^corr_[a-f0-9]{16}$/);
      expect(context.operationType).toBe(operationType);
      expect(context.userId).toBe(testUserId);
      expect(context.createdAt).toBeGreaterThan(0);
      expect(context.createdAt).toBeLessThanOrEqual(Date.now());
    });

    it('should create context with optional fields', () => {
      // Arrange
      const operationType = OPERATION_TYPES.LEAD_ENRICHMENT;
      const options = {
        searchId: testSearchId,
        leadId: testLeadId,
        batchId: 'batch_123',
        metadata: {
          provider: 'findymail',
          attempt: 1,
        },
      };

      // Act
      const context = createCorrelationContext(operationType, testUserId, options);

      // Assert
      expect(context.searchId).toBe(testSearchId);
      expect(context.leadId).toBe(testLeadId);
      expect(context.batchId).toBe('batch_123');
      expect(context.metadata).toEqual({
        provider: 'findymail',
        attempt: 1,
      });
    });

    it('should not include optional fields when not provided', () => {
      // Act
      const context = createCorrelationContext(
        OPERATION_TYPES.SEARCH_CREATE,
        testUserId
      );

      // Assert
      expect(context.parentId).toBeUndefined();
      expect(context.searchId).toBeUndefined();
      expect(context.leadId).toBeUndefined();
      expect(context.batchId).toBeUndefined();
      expect(context.metadata).toBeUndefined();
    });

    it('should create context with parentId for nested operations', () => {
      // Arrange
      const parentCorrelationId = 'corr_parent123456789';

      // Act
      const context = createCorrelationContext(
        OPERATION_TYPES.BATCH_PROCESSING,
        testUserId,
        {
          parentId: parentCorrelationId,
          searchId: testSearchId,
        }
      );

      // Assert
      expect(context.parentId).toBe(parentCorrelationId);
      expect(context.searchId).toBe(testSearchId);
    });
  });

  describe('Test 18: createChildContext() - Maintains parent-child relationships', () => {
    it('should create child context with parent relationship', () => {
      // Arrange
      const parentContext = createCorrelationContext(
        OPERATION_TYPES.SEARCH_ORCHESTRATE,
        testUserId,
        {
          searchId: testSearchId,
        }
      );

      // Act
      const childContext = createChildContext(
        parentContext,
        OPERATION_TYPES.GOOGLE_MAPS_DISCOVERY
      );

      // Assert
      expect(childContext.parentId).toBe(parentContext.correlationId);
      expect(childContext.userId).toBe(parentContext.userId);
      expect(childContext.searchId).toBe(parentContext.searchId);
      expect(childContext.operationType).toBe(OPERATION_TYPES.GOOGLE_MAPS_DISCOVERY);
      expect(childContext.correlationId).not.toBe(parentContext.correlationId);
    });

    it('should inherit parent context fields', () => {
      // Arrange
      const parentContext = createCorrelationContext(
        OPERATION_TYPES.SEARCH_ORCHESTRATE,
        testUserId,
        {
          searchId: testSearchId,
          leadId: testLeadId,
          batchId: 'batch_123',
        }
      );

      // Act
      const childContext = createChildContext(
        parentContext,
        OPERATION_TYPES.LEAD_ENRICHMENT
      );

      // Assert
      expect(childContext.searchId).toBe(testSearchId);
      expect(childContext.leadId).toBe(testLeadId);
      expect(childContext.batchId).toBe('batch_123');
    });

    it('should allow child to override inherited fields', () => {
      // Arrange
      const parentContext = createCorrelationContext(
        OPERATION_TYPES.BATCH_PROCESSING,
        testUserId,
        {
          searchId: testSearchId,
          leadId: testLeadId,
        }
      );

      // Act
      const childContext = createChildContext(
        parentContext,
        OPERATION_TYPES.FINDYMAIL_API,
        {
          leadId: 'lead_different_id',
          metadata: {
            override: true,
          },
        }
      );

      // Assert
      expect(childContext.leadId).toBe('lead_different_id'); // Overridden
      expect(childContext.searchId).toBe(testSearchId); // Inherited
      expect(childContext.metadata).toEqual({ override: true });
    });

    it('should support multi-level parent-child chains', () => {
      // Arrange
      const grandparent = createCorrelationContext(
        OPERATION_TYPES.SEARCH_CREATE,
        testUserId,
        { searchId: testSearchId }
      );

      const parent = createChildContext(
        grandparent,
        OPERATION_TYPES.SEARCH_ORCHESTRATE
      );

      // Act
      const child = createChildContext(
        parent,
        OPERATION_TYPES.GOOGLE_MAPS_DISCOVERY
      );

      // Assert
      expect(child.parentId).toBe(parent.correlationId);
      expect(parent.parentId).toBe(grandparent.correlationId);
      expect(child.searchId).toBe(testSearchId); // Inherited through chain
    });
  });

  describe('Test 19: logWithCorrelation() - Performance <100ms validation', () => {
    it('should execute logging within performance budget', () => {
      // Arrange
      const context = createCorrelationContext(
        OPERATION_TYPES.SEARCH_CREATE,
        testUserId,
        { searchId: testSearchId }
      );

      // Mock console to avoid actual logging
      const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      // Act
      const startTime = performance.now();
      for (let i = 0; i < 100; i++) {
        logWithCorrelation('info', context, `Test message ${i}`, { iteration: i });
      }
      const endTime = performance.now();
      const duration = endTime - startTime;

      // Assert - 100 log operations should complete in <100ms
      expect(duration).toBeLessThan(100);

      // Verify logging was called
      expect(consoleInfoSpy).toHaveBeenCalledTimes(100);

      // Cleanup
      consoleInfoSpy.mockRestore();
    });

    it('should create properly formatted log messages', () => {
      // Arrange
      const context = createCorrelationContext(
        OPERATION_TYPES.LEAD_ENRICHMENT,
        testUserId,
        {
          searchId: testSearchId,
          leadId: testLeadId,
          batchId: 'batch_123',
        }
      );

      const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      // Act
      logWithCorrelation('info', context, 'Test message', { key: 'value' });

      // Assert
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining(context.correlationId),
        expect.objectContaining({ key: 'value' })
      );
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining(OPERATION_TYPES.LEAD_ENRICHMENT),
        expect.any(Object)
      );

      // Cleanup
      consoleInfoSpy.mockRestore();
    });

    it('should log with different severity levels', () => {
      // Arrange
      const context = createCorrelationContext(
        OPERATION_TYPES.ERROR_RECOVERY,
        testUserId
      );

      const consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Act
      logWithCorrelation('debug', context, 'Debug message');
      logWithCorrelation('info', context, 'Info message');
      logWithCorrelation('warn', context, 'Warning message');
      logWithCorrelation('error', context, 'Error message');

      // Assert
      expect(consoleDebugSpy).toHaveBeenCalledTimes(1);
      expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

      // Cleanup
      consoleDebugSpy.mockRestore();
      consoleInfoSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should handle error logging with stack traces', () => {
      // Arrange
      const context = createCorrelationContext(
        OPERATION_TYPES.ERROR_RECOVERY,
        testUserId
      );

      const testError = new Error('Test error message');
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Act
      logWithCorrelation('error', context, 'Error occurred', undefined, testError);

      // Assert
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error occurred'),
        expect.objectContaining({
          error: 'Test error message',
          stack: expect.any(String),
        })
      );

      // Cleanup
      consoleErrorSpy.mockRestore();
    });
  });

  describe('Test 20: Full correlation tree tracing', () => {
    it('should trace complete operation genealogy', () => {
      // Arrange - Create a full operation tree
      const searchCreate = createCorrelationContext(
        OPERATION_TYPES.SEARCH_CREATE,
        testUserId,
        { searchId: testSearchId }
      );

      const orchestrate = createChildContext(
        searchCreate,
        OPERATION_TYPES.SEARCH_ORCHESTRATE
      );

      const discovery = createChildContext(
        orchestrate,
        OPERATION_TYPES.GOOGLE_MAPS_DISCOVERY
      );

      const enrichment = createChildContext(
        orchestrate,
        OPERATION_TYPES.LEAD_ENRICHMENT,
        { leadId: testLeadId }
      );

      const findymailCall = createChildContext(
        enrichment,
        OPERATION_TYPES.FINDYMAIL_API
      );

      const analysis = createChildContext(
        orchestrate,
        OPERATION_TYPES.AI_ANALYSIS
      );

      // Assert - Verify tree structure
      expect(orchestrate.parentId).toBe(searchCreate.correlationId);
      expect(discovery.parentId).toBe(orchestrate.correlationId);
      expect(enrichment.parentId).toBe(orchestrate.correlationId);
      expect(findymailCall.parentId).toBe(enrichment.correlationId);
      expect(analysis.parentId).toBe(orchestrate.correlationId);

      // All children should inherit searchId
      expect(orchestrate.searchId).toBe(testSearchId);
      expect(discovery.searchId).toBe(testSearchId);
      expect(enrichment.searchId).toBe(testSearchId);
      expect(findymailCall.searchId).toBe(testSearchId);
      expect(analysis.searchId).toBe(testSearchId);

      // Lead-specific operations should have leadId
      expect(enrichment.leadId).toBe(testLeadId);
      expect(findymailCall.leadId).toBe(testLeadId);
    });

    it('should maintain context integrity across deep nesting', () => {
      // Arrange - Create deeply nested context (5 levels)
      let currentContext = createCorrelationContext(
        OPERATION_TYPES.SEARCH_CREATE,
        testUserId,
        { searchId: testSearchId, metadata: { level: 0 } }
      );

      const contexts: CorrelationContext[] = [currentContext];

      for (let i = 1; i <= 5; i++) {
        currentContext = createChildContext(
          currentContext,
          OPERATION_TYPES.BATCH_PROCESSING,
          { metadata: { level: i } }
        );
        contexts.push(currentContext);
      }

      // Assert - Verify parent chain
      for (let i = 1; i < contexts.length; i++) {
        expect(contexts[i]?.parentId).toBe(contexts[i - 1]?.correlationId);
        expect(contexts[i]?.searchId).toBe(testSearchId);
        expect(contexts[i]?.userId).toBe(testUserId);
      }

      // Verify unique IDs at each level
      const ids = contexts.map((c) => c.correlationId);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(contexts.length);
    });

    it('should create valid log entries with performance metrics', () => {
      // Arrange
      const context = createCorrelationContext(
        OPERATION_TYPES.GOOGLE_MAPS_API,
        testUserId,
        { searchId: testSearchId }
      );

      const startTime = Date.now();
      const endTime = startTime + 1250; // 1.25 seconds

      // Act
      const logEntry = createLogEntry(
        'info',
        context,
        'API call completed',
        { resultsCount: 15 },
        undefined,
        {
          startTime,
          endTime,
          duration: endTime - startTime,
        }
      );

      // Assert
      expect(logEntry.level).toBe('info');
      expect(logEntry.correlation).toEqual(context);
      expect(logEntry.message).toBe('API call completed');
      expect(logEntry.data).toEqual({ resultsCount: 15 });
      expect(logEntry.performance).toEqual({
        startTime,
        endTime,
        duration: 1250,
      });
    });

    it('should support batch operation tracking with correlation', () => {
      // Arrange
      const batchContext = createCorrelationContext(
        OPERATION_TYPES.BATCH_CREATION,
        testUserId,
        {
          searchId: testSearchId,
          batchId: 'batch_test_123',
          metadata: {
            batchSize: 50,
            priority: 'high',
          },
        }
      );

      // Act - Create multiple child operations for batch processing
      const leadOperations = [];
      for (let i = 0; i < 5; i++) {
        const leadContext = createChildContext(
          batchContext,
          OPERATION_TYPES.LEAD_ENRICHMENT,
          {
            leadId: `lead_${i}`,
          }
        );
        leadOperations.push(leadContext);
      }

      // Assert
      expect(leadOperations.length).toBe(5);
      leadOperations.forEach((op, index) => {
        expect(op.parentId).toBe(batchContext.correlationId);
        expect(op.batchId).toBe('batch_test_123');
        expect(op.leadId).toBe(`lead_${index}`);
        expect(op.searchId).toBe(testSearchId);
      });

      // All should have unique correlation IDs
      const ids = leadOperations.map((op) => op.correlationId);
      expect(new Set(ids).size).toBe(5);
    });
  });
});
