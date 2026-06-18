import { describe, expect, it } from "vitest";
import {
  mapHealthCheckToApiError,
  isBlockingHealthResult,
} from "../../convex/lib/providerHealthCheck";
import { shouldBlockPipeline } from "../../convex/lib/apiErrors";
import { API_ERROR_CODES } from "@genni/shared-types";

describe("providerHealthCheck", () => {
  it("maps Google quota exhaustion to blocking API error", () => {
    const apiError = mapHealthCheckToApiError("google", {
      healthy: false,
      status: "quota_exhausted",
      message: "You have exceeded your daily request quota",
      responseTimeMs: 100,
      timestamp: Date.now(),
      googleApiStatus: "OVER_QUERY_LIMIT",
      httpStatus: 200,
    });

    expect(apiError.errorCode).toBe(API_ERROR_CODES.GOOGLE_QUOTA_EXHAUSTED);
    expect(shouldBlockPipeline(apiError)).toBe(true);
  });

  it("maps OpenAI insufficient quota to blocking API error", () => {
    const apiError = mapHealthCheckToApiError("openai", {
      healthy: false,
      status: "quota_exhausted",
      message: "You exceeded your current quota",
      responseTimeMs: 100,
      timestamp: Date.now(),
      errorType: "insufficient_quota",
      httpStatus: 429,
    });

    expect(apiError.errorCode).toBe(API_ERROR_CODES.OPENAI_QUOTA_EXHAUSTED);
    expect(shouldBlockPipeline(apiError)).toBe(true);
  });

  it("does not block on transient rate limits", () => {
    const health = {
      healthy: false,
      status: "rate_limited",
      message: "Rate limited",
      responseTimeMs: 50,
      timestamp: Date.now(),
    };
    expect(isBlockingHealthResult(health)).toBe(false);
  });
});
