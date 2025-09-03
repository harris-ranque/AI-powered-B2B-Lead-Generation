/* eslint-disable */
/**
 * Type declarations for Convex API
 */

// Import the actual type from the generated api.d.ts
import type { api as generatedApi, internal as generatedInternal } from './api';

export const api: typeof generatedApi;
export const internal: typeof generatedInternal;

// Re-export dataModel types
export type { Id, Doc } from './dataModel';