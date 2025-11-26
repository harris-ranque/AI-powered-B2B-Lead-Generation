/**
 * Test utilities for Convex backend testing
 */

import { vi } from 'vitest';
import type { GenericId } from 'convex/values';

/**
 * Mock Convex context for testing mutations and queries
 */
export const createMockContext = () => {
  const mockDb = {
    get: vi.fn(),
    query: vi.fn(() => ({
      filter: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      first: vi.fn(),
      take: vi.fn(),
      collect: vi.fn(),
      unique: vi.fn(),
    })),
    insert: vi.fn(),
    patch: vi.fn(),
    replace: vi.fn(),
    delete: vi.fn(),
    system: {
      get: vi.fn(),
      query: vi.fn(() => ({
        filter: vi.fn().mockReturnThis(),
        first: vi.fn(),
        collect: vi.fn(),
      })),
    },
  };

  const mockScheduler = {
    runAfter: vi.fn(),
    runAt: vi.fn(),
    cancel: vi.fn(),
  };

  const mockStorage = {
    getUrl: vi.fn(),
    generateUploadUrl: vi.fn(),
    delete: vi.fn(),
  };

  const mockAuth = {
    getUserIdentity: vi.fn(),
  };

  return {
    db: mockDb,
    scheduler: mockScheduler,
    storage: mockStorage,
    auth: mockAuth,
  };
};

/**
 * Generate a mock Convex ID for testing
 */
export const mockId = <T extends string>(prefix: T): GenericId<T> => {
  return `${prefix}_test_${Math.random().toString(36).substring(7)}` as GenericId<T>;
};

/**
 * Mock timestamp generator
 */
export const mockTimestamp = (offset: number = 0): number => {
  return Date.now() + offset;
};

/**
 * Create mock user identity
 */
export const createMockUserIdentity = (overrides = {}) => {
  return {
    tokenIdentifier: 'test_user_123',
    subject: 'user_test_123',
    issuer: 'https://test-issuer.example.com',
    ...overrides,
  };
};

/**
 * Mock Convex database document
 */
export const createMockDocument = <T extends Record<string, any>>(
  table: string,
  data: Partial<T>,
): T & { _id: GenericId<typeof table>; _creationTime: number } => {
  return {
    _id: mockId(table),
    _creationTime: mockTimestamp(),
    ...data,
  } as T & { _id: GenericId<typeof table>; _creationTime: number };
};

/**
 * Reset all mocks
 */
export const resetAllMocks = () => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
};

/**
 * Wait for async operations to complete
 */
export const waitFor = (ms: number = 0): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Create mock Convex action context
 */
export const createMockActionContext = () => {
  return {
    runQuery: vi.fn(),
    runMutation: vi.fn(),
    runAction: vi.fn(),
    scheduler: {
      runAfter: vi.fn(),
      runAt: vi.fn(),
    },
    auth: {
      getUserIdentity: vi.fn(),
    },
  };
};
