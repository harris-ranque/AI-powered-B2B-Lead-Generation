import { useQuery } from "convex/react";
import { FunctionReference, FunctionReturnType } from "convex/server";

/**
 * Wrapper around useQuery that catches server errors and returns undefined
 * instead of throwing. Use for non-critical queries (e.g. notifications,
 * analytics) that shouldn't crash the page if they fail.
 */
export function useSafeQuery<F extends FunctionReference<"query">>(
  query: F,
  ...args: Parameters<typeof useQuery<F>> extends [any, ...infer Rest] ? Rest : []
): FunctionReturnType<F> | undefined {
  try {
    return useQuery(query, ...args);
  } catch {
    return undefined;
  }
}
