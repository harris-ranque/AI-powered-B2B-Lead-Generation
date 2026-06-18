/**
 * Pre-flight health checks for external API providers.
 * Used to fail fast before enqueueing expensive pipeline work.
 */

import {
  classifyFindyMailError,
  classifyGoogleError,
  classifyOpenAIError,
  classifyPerplexityError,
  type ApiError,
} from "./apiErrors";

export interface ProviderHealthCheckResult {
  healthy: boolean;
  status: string;
  message: string;
  responseTimeMs: number;
  timestamp: number;
  credits?: number;
  /** Google Maps JSON API status field (OK, OVER_QUERY_LIMIT, etc.) */
  googleApiStatus?: string;
  /** OpenAI error.type from response body */
  errorType?: string;
  httpStatus?: number;
}

const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const PERPLEXITY_CHAT_URL = "https://api.perplexity.ai/chat/completions";
const FINDYMAIL_CREDITS_URL = "https://app.findymail.com/api/credits";
const GOOGLE_FIND_PLACE_URL =
  "https://maps.googleapis.com/maps/api/place/findplacefromtext/json";

async function parseJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function parseOpenAIErrorBody(bodyText: string): {
  message: string;
  type?: string;
} {
  try {
    const json = JSON.parse(bodyText) as {
      error?: { message?: string; type?: string };
    };
    return {
      message: json.error?.message ?? bodyText,
      type: json.error?.type,
    };
  } catch {
    return { message: bodyText };
  }
}

function parsePerplexityErrorBody(bodyText: string): string {
  try {
    const json = JSON.parse(bodyText) as {
      error?: { message?: string };
    };
    return json.error?.message ?? bodyText;
  } catch {
    return bodyText;
  }
}

export async function checkGoogleMapsHealth(
  apiKey: string,
): Promise<ProviderHealthCheckResult> {
  const startTime = Date.now();
  const url = new URL(GOOGLE_FIND_PLACE_URL);
  url.searchParams.set("input", "Genni");
  url.searchParams.set("inputtype", "textquery");
  url.searchParams.set("fields", "place_id");
  url.searchParams.set("key", apiKey);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    });
    const responseTime = Date.now() - startTime;
    const data = (await parseJsonSafe(response)) as {
      status?: string;
      error_message?: string;
    } | null;

    const googleStatus = data?.status ?? "UNKNOWN_ERROR";
    const errorMessage = data?.error_message ?? `HTTP ${response.status}`;

    if (googleStatus === "OK" || googleStatus === "ZERO_RESULTS") {
      return {
        healthy: true,
        status: "ok",
        message: "Google Maps API is healthy",
        responseTimeMs: responseTime,
        timestamp: Date.now(),
        googleApiStatus: googleStatus,
        httpStatus: response.status,
      };
    }

    if (
      googleStatus === "OVER_QUERY_LIMIT" ||
      googleStatus === "RESOURCE_EXHAUSTED"
    ) {
      return {
        healthy: false,
        status: "quota_exhausted",
        message: errorMessage || "Google Maps API quota exhausted",
        responseTimeMs: responseTime,
        timestamp: Date.now(),
        googleApiStatus: googleStatus,
        httpStatus: response.status,
      };
    }

    if (googleStatus === "REQUEST_DENIED") {
      const isAuth =
        errorMessage.toLowerCase().includes("api key") ||
        errorMessage.toLowerCase().includes("invalid");
      return {
        healthy: false,
        status: isAuth ? "auth_failed" : "authorization_failed",
        message: errorMessage,
        responseTimeMs: responseTime,
        timestamp: Date.now(),
        googleApiStatus: googleStatus,
        httpStatus: response.status,
      };
    }

    return {
      healthy: false,
      status: "api_error",
      message: errorMessage,
      responseTimeMs: responseTime,
      timestamp: Date.now(),
      googleApiStatus: googleStatus,
      httpStatus: response.status,
    };
  } catch (error) {
    return {
      healthy: false,
      status: "network_error",
      message:
        error instanceof Error ? error.message : "Google Maps health check failed",
      responseTimeMs: Date.now() - startTime,
      timestamp: Date.now(),
    };
  }
}

export async function checkOpenAIHealth(
  apiKey: string,
): Promise<ProviderHealthCheckResult> {
  const startTime = Date.now();

  try {
    const response = await fetch(OPENAI_MODELS_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    const responseTime = Date.now() - startTime;

    if (response.ok) {
      return {
        healthy: true,
        status: "ok",
        message: "OpenAI API is healthy",
        responseTimeMs: responseTime,
        timestamp: Date.now(),
        httpStatus: response.status,
      };
    }

    const bodyText = await response.text();
    const { message, type } = parseOpenAIErrorBody(bodyText);
    const lower = message.toLowerCase();
    const quotaExhausted =
      type === "insufficient_quota" ||
      lower.includes("quota") ||
      lower.includes("billing");

    let status = "api_error";
    if (response.status === 401) {
      status = "auth_failed";
    } else if (response.status === 429 && quotaExhausted) {
      status = "quota_exhausted";
    } else if (response.status === 429) {
      status = "rate_limited";
    }

    return {
      healthy: false,
      status,
      message: message || `OpenAI API returned status ${response.status}`,
      responseTimeMs: responseTime,
      timestamp: Date.now(),
      errorType: type,
      httpStatus: response.status,
    };
  } catch (error) {
    return {
      healthy: false,
      status: "network_error",
      message:
        error instanceof Error ? error.message : "OpenAI health check failed",
      responseTimeMs: Date.now() - startTime,
      timestamp: Date.now(),
    };
  }
}

export async function checkPerplexityHealth(
  apiKey: string,
): Promise<ProviderHealthCheckResult> {
  const startTime = Date.now();

  try {
    const response = await fetch(PERPLEXITY_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: "test" }],
        max_tokens: 16,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const responseTime = Date.now() - startTime;

    if (response.ok) {
      return {
        healthy: true,
        status: "ok",
        message: "Perplexity API is healthy",
        responseTimeMs: responseTime,
        timestamp: Date.now(),
        httpStatus: response.status,
      };
    }

    const bodyText = await response.text();
    const message = parsePerplexityErrorBody(bodyText);
    const lower = message.toLowerCase();

    let status = "api_error";
    if (response.status === 401) {
      status = "auth_failed";
    } else if (response.status === 402) {
      status = "quota_exhausted";
    } else if (
      response.status === 429 &&
      (lower.includes("quota") ||
        lower.includes("billing") ||
        lower.includes("limit exceeded"))
    ) {
      status = "quota_exhausted";
    } else if (response.status === 429) {
      status = "rate_limited";
    }

    return {
      healthy: false,
      status,
      message: message || `Perplexity API returned status ${response.status}`,
      responseTimeMs: responseTime,
      timestamp: Date.now(),
      httpStatus: response.status,
    };
  } catch (error) {
    return {
      healthy: false,
      status: "network_error",
      message:
        error instanceof Error ? error.message : "Perplexity health check failed",
      responseTimeMs: Date.now() - startTime,
      timestamp: Date.now(),
    };
  }
}

export async function checkFindyMailCreditsHealth(
  apiKey: string,
): Promise<ProviderHealthCheckResult> {
  const startTime = Date.now();

  try {
    const response = await fetch(FINDYMAIL_CREDITS_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(10000),
    });
    const responseTime = Date.now() - startTime;

    if (response.status === 401) {
      return {
        healthy: false,
        status: "auth_failed",
        message: "FindyMail API key is invalid or expired",
        responseTimeMs: responseTime,
        timestamp: Date.now(),
        httpStatus: response.status,
      };
    }

    if (response.status === 402) {
      return {
        healthy: false,
        status: "credits_exhausted",
        message: "FindyMail account has no remaining credits",
        credits: 0,
        responseTimeMs: responseTime,
        timestamp: Date.now(),
        httpStatus: response.status,
      };
    }

    if (response.status === 423) {
      return {
        healthy: false,
        status: "subscription_paused",
        message:
          "FindyMail subscription is paused. Please reactivate your subscription.",
        responseTimeMs: responseTime,
        timestamp: Date.now(),
        httpStatus: response.status,
      };
    }

    if (response.status === 429) {
      return {
        healthy: true,
        status: "rate_limited",
        message: "FindyMail API is available but currently rate limited",
        responseTimeMs: responseTime,
        timestamp: Date.now(),
        httpStatus: response.status,
      };
    }

    if (!response.ok) {
      return {
        healthy: false,
        status: "api_error",
        message: `FindyMail API returned status ${response.status}`,
        responseTimeMs: responseTime,
        timestamp: Date.now(),
        httpStatus: response.status,
      };
    }

    const creditsData = (await parseJsonSafe(response)) as { credits?: number };
    const credits = creditsData?.credits ?? 0;

    if (credits === 0) {
      return {
        healthy: false,
        status: "credits_exhausted",
        message: "FindyMail account has no remaining credits",
        credits: 0,
        responseTimeMs: responseTime,
        timestamp: Date.now(),
        httpStatus: response.status,
      };
    }

    return {
      healthy: true,
      status: credits < 10 ? "low_credits" : "ok",
      message:
        credits < 10
          ? `FindyMail API is healthy but credits are low (${credits} remaining)`
          : "FindyMail API is healthy",
      credits,
      responseTimeMs: responseTime,
      timestamp: Date.now(),
      httpStatus: response.status,
    };
  } catch (error) {
    return {
      healthy: false,
      status: "network_error",
      message:
        error instanceof Error ? error.message : "FindyMail health check failed",
      responseTimeMs: Date.now() - startTime,
      timestamp: Date.now(),
    };
  }
}

export function mapHealthCheckToApiError(
  provider: "google" | "openai" | "perplexity" | "findymail",
  health: ProviderHealthCheckResult,
): ApiError {
  switch (provider) {
    case "google":
      return classifyGoogleError(
        health.googleApiStatus ?? health.status,
        health.message,
        health.httpStatus,
      );
    case "openai":
      return classifyOpenAIError(
        health.httpStatus ?? 500,
        health.message,
        health.errorType,
      );
    case "perplexity":
      return classifyPerplexityError(health.httpStatus ?? 500, health.message);
    case "findymail": {
      const statusToHttp: Record<string, number> = {
        credits_exhausted: 402,
        auth_failed: 401,
        subscription_paused: 423,
      };
      const httpStatus =
        health.httpStatus ?? statusToHttp[health.status] ?? 500;
      return classifyFindyMailError(httpStatus, health.message);
    }
    default:
      return classifyOpenAIError(500, health.message);
  }
}

export function isBlockingHealthResult(
  health: ProviderHealthCheckResult,
): boolean {
  if (health.healthy) {
    return false;
  }
  return health.status !== "rate_limited";
}

export function apiErrorToBlockMutationArgs(apiError: ApiError) {
  return {
    errorCode: apiError.errorCode,
    errorMessage: apiError.userMessage,
    provider: apiError.provider,
    category: apiError.category,
    severity: apiError.severity,
    suggestedAction: apiError.suggestedAction,
    actionUrl: apiError.actionUrl,
    actionLabel: apiError.actionLabel,
    originalStatus: apiError.originalStatus,
  };
}
