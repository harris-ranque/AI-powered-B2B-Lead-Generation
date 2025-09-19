import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { convexHttp, isConvexHttpConfigured } from "../lib/convexHttp";

type PollOptions = {
  intervalMs?: number;
  enabled?: boolean;
  immediate?: boolean;
};

type UseConvexPollingResult<T> = {
  data: T | undefined;
  error: Error | null;
  isLoading: boolean;
  isPolling: boolean;
  refetch: () => Promise<void>;
};

// Generic polling hook for Convex HTTP queries. Avoids WebSocket subscriptions.
export function useConvexPolling<TArgs extends Record<string, unknown> | undefined, TRes = unknown>(
  queryRef: unknown,
  args?: TArgs,
  options?: PollOptions,
): UseConvexPollingResult<TRes> {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [data, setData] = useState<TRes | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isPolling, setIsPolling] = useState<boolean>(false);

  const intervalMs = options?.intervalMs ?? 3000;
  const enabled = options?.enabled ?? true;
  const immediate = options?.immediate ?? true;

  const stableArgs = useMemo(() => args, [args]);
  const convexConfigured = isConvexHttpConfigured();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);

  // Keep Convex HTTP client authenticated with Clerk when available.
  useEffect(() => {
    let cancelled = false;
    async function syncAuth() {
      try {
        if (isLoaded) {
          const token = isSignedIn
            ? await getToken({ template: "convex" })
            : null;
          // setAuth accepts string | null
          convexHttp.setAuth(token ?? null);
        }
      } catch (e) {
        if (!cancelled) {
          console.warn("Failed to set Convex HTTP auth token", e);
        }
      }
    }
    syncAuth();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, getToken]);

  const fetchOnce = useCallback(async () => {
    if (!convexConfigured || !enabled) return;

    // Wait for Clerk to fully load AND confirm sign-in status
    if (!isLoaded) return;

    if (!isSignedIn) {
      // Clear any existing data and stop polling for unauthenticated users
      setData(undefined);
      setError(null);
      setIsLoading(false);
      setIsPolling(false);
      return;
    }

    setIsPolling(true);
    try {
      // Refresh auth before each query to avoid 401 bursts when tokens expire
      const token = await getToken({ template: "convex" });
      if (!token) {
        // Token unavailable - user likely not fully authenticated yet
        convexHttp.setAuth(null);
        setError(new Error("Authentication token unavailable"));
        return;
      }

      convexHttp.setAuth(token);

      // Note: args may be undefined for arg-less queries
      const result = await convexHttp.query(queryRef as never, stableArgs as never);
      setData(result as TRes);
      setError(null);
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));

      // Log all errors including 401s for debugging
      console.warn("Convex query error:", error);

      setError(error);
    } finally {
      setIsLoading(false);
      setIsPolling(false);
    }
  }, [
    enabled,
    getToken,
    isLoaded,
    isSignedIn,
    queryRef,
    stableArgs,
    convexConfigured,
  ]);

  // Polling loop
  useEffect(() => {
    if (!enabled) return;
    stoppedRef.current = false;

    const loop = async () => {
      if (stoppedRef.current) return;
      // If tab is hidden, back off aggressively
      const isHidden = typeof document !== "undefined" && document.hidden;
      if (!isHidden) {
        await fetchOnce();
      }
      if (stoppedRef.current) return;
      // Add small jitter to avoid sync across tabs
      const jitter = Math.floor(Math.random() * 250);
      const delay = (isHidden ? intervalMs * 2 : intervalMs) + jitter;
      timerRef.current = setTimeout(loop, delay);
    };

    if (immediate) {
      loop();
    } else {
      timerRef.current = setTimeout(loop, intervalMs);
    }

    return () => {
      stoppedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [fetchOnce, intervalMs, enabled, immediate]);

  // When tab becomes visible, trigger an immediate refresh
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        fetchOnce();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVis);
      return () => document.removeEventListener("visibilitychange", onVis);
    }
  }, [fetchOnce]);

  return {
    data,
    error,
    isLoading,
    isPolling,
    refetch: fetchOnce,
  };
}
