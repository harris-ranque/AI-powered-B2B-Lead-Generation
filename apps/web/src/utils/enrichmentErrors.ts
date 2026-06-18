import {
  API_ERROR_CODES,
  getErrorMessage,
  type ApiError,
  type ApiErrorCategory,
  type ApiProvider,
  type ErrorAction,
  type ErrorSeverity,
} from "@genni/shared-types";
import type { Search } from "@/lib/types";
import type { StatusBroadcast } from "@/hooks/base/useStatusBroadcastsBase";

type BroadcastApiErrorPayload = {
  code?: string;
  errorCode?: string;
  provider?: string;
  category?: string;
  userMessage?: string;
  suggestedAction?: string;
  actionUrl?: string;
  actionLabel?: string;
};

function isKnownErrorCode(code: string): boolean {
  return Object.values(API_ERROR_CODES).includes(
    code as (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES],
  );
}

function buildApiError(
  errorCode: string,
  userMessage: string,
  overrides: Partial<ApiError> = {},
): ApiError {
  const template = isKnownErrorCode(errorCode)
    ? getErrorMessage(
        errorCode as (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES],
      )
    : null;

  let inferredCategory: ApiErrorCategory = "unknown";
  if (errorCode.includes("CREDITS") || errorCode.includes("QUOTA")) {
    inferredCategory = "quota_exhausted";
  } else if (errorCode.includes("AUTH")) {
    inferredCategory = "authentication";
  } else if (errorCode.includes("SUBSCRIPTION")) {
    inferredCategory = "subscription_paused";
  }

  return {
    errorCode,
    provider: (overrides.provider ?? "findymail") as ApiProvider,
    category: (overrides.category ?? inferredCategory) as ApiErrorCategory,
    userMessage,
    suggestedAction: (overrides.suggestedAction ??
      template?.suggestedAction ??
      "none") as ErrorAction,
    severity: (overrides.severity ?? template?.severity ?? "error") as ErrorSeverity,
    actionLabel: overrides.actionLabel ?? template?.actionLabel,
    actionUrl: overrides.actionUrl ?? template?.actionUrl,
    retryable: overrides.retryable ?? template?.retryable ?? false,
    timestamp: Date.now(),
    ...overrides,
  };
}

function apiErrorFromBroadcastPayload(
  payload: BroadcastApiErrorPayload,
  fallbackMessage?: string,
): ApiError | null {
  const errorCode = payload.code ?? payload.errorCode;
  if (!errorCode) return null;

  const userMessage =
    payload.userMessage ??
    fallbackMessage ??
    "Enrichment was paused due to an external API issue.";

  return buildApiError(errorCode, userMessage, {
    provider: payload.provider as ApiProvider | undefined,
    category: payload.category as ApiErrorCategory | undefined,
    suggestedAction: payload.suggestedAction as ErrorAction | undefined,
    actionUrl: payload.actionUrl,
    actionLabel: payload.actionLabel,
  });
}

export function extractEnrichmentBlockingError(
  search: Search | null | undefined,
  broadcasts: StatusBroadcast[],
): ApiError | null {
  for (const broadcast of broadcasts) {
    if (broadcast.type === "pipeline_blocked") {
      const data =
        broadcast.data && typeof broadcast.data === "object"
          ? (broadcast.data as Record<string, unknown>)
          : undefined;
      const nested = data?.apiError as BroadcastApiErrorPayload | undefined;
      if (nested) {
        return apiErrorFromBroadcastPayload(nested, broadcast.message);
      }
      if (typeof data?.errorCode === "string") {
        return buildApiError(data.errorCode as string, broadcast.message, {
          category: data.category as ApiErrorCategory | undefined,
          actionUrl: data.actionUrl as string | undefined,
          suggestedAction: data.actionRequired as ErrorAction | undefined,
        });
      }
    }

    const data =
      broadcast.data && typeof broadcast.data === "object"
        ? (broadcast.data as Record<string, unknown>)
        : undefined;

    if (data?.stage === "error" && data.apiError) {
      const parsed = apiErrorFromBroadcastPayload(
        data.apiError as BroadcastApiErrorPayload,
        broadcast.message,
      );
      if (parsed) return parsed;
    }
  }

  const checkpoint = search?.enrichmentCheckpoint;
  if (search?.enrichmentPaused && checkpoint?.errorCode) {
    return buildApiError(
      checkpoint.errorCode,
      checkpoint.errorMessage ??
        "Email enrichment was paused and requires your attention.",
    );
  }

  if (search?.status === "failed" && search.error) {
    return buildApiError(
      "PIPELINE_BLOCKED",
      search.error,
      { severity: "error", category: "unknown" },
    );
  }

  return null;
}

export function isEnrichmentBlocked(
  search: Search | null | undefined,
): boolean {
  return Boolean(
    search?.enrichmentPaused && search?.enrichmentCheckpoint?.errorCode,
  );
}

/** True when enrichment paused or search failed with a blocking API error. */
export function isPipelineBlocked(
  search: Search | null | undefined,
): boolean {
  return (
    isEnrichmentBlocked(search) ||
    (search?.status === "failed" && Boolean(search.error))
  );
}
