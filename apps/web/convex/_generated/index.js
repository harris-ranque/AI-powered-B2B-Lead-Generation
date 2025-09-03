/* eslint-disable */
/**
 * Build-time mock for Convex API
 * The real implementation is loaded at runtime
 */

// Create a proxy-based API that generates function references
const createApi = () => new Proxy({}, {
  get(_, moduleName) {
    return new Proxy({}, {
      get(_, functionName) {
        return `${moduleName}:${functionName}`;
      }
    });
  }
});

export const api = createApi();
export const internal = createApi();

// Re-export dataModel types
export * from './dataModel.d.ts';