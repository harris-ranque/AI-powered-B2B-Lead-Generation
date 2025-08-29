/* eslint-disable */
/**
 * Generated `api` utility mock for Railway build.
 * This file is used when importing from @genni/convex-types
 */

// Convex uses a proxy-based API that creates function references dynamically
// We need to replicate this structure for the build to succeed

const anyApi = new Proxy({}, {
  get(_, moduleName) {
    // Special handling for 'users' module to ensure proper structure
    if (moduleName === 'users') {
      return {
        queries: new Proxy({}, {
          get(_, functionName) {
            return `users.queries.${functionName}`;
          }
        }),
        mutations: new Proxy({}, {
          get(_, functionName) {
            return `users.mutations.${functionName}`;
          }
        })
      };
    }
    
    // For other modules, return nested proxy structure
    return new Proxy({}, {
      get(_, subModule) {
        return new Proxy({}, {
          get(_, functionName) {
            return `${moduleName}.${subModule}.${functionName}`;
          }
        });
      }
    });
  }
});

/**
 * A utility for referencing Convex functions in your app's API.
 */
export const api = anyApi;
export const internal = anyApi;