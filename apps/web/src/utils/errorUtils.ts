export interface NormalizedError {
  message: string;
  code?: string;
  statusCode?: number;
}

const FALLBACK_MESSAGE = "Something went wrong. Please try again.";

const coerceRecord = (
  value: unknown,
): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  return value as Record<string, unknown>;
};

const assignFromRecord = (
  target: NormalizedError,
  source: Record<string, unknown>,
) => {
  const messageCandidate = source.message;
  if (
    typeof messageCandidate === "string" &&
    messageCandidate.trim().length > 0
  ) {
    target.message = messageCandidate.trim();
  }

  const altMessage = source.error;
  if (
    target.message === FALLBACK_MESSAGE &&
    typeof altMessage === "string" &&
    altMessage.trim().length > 0
  ) {
    target.message = altMessage.trim();
  }

  const codeCandidate = source.code;
  if (typeof codeCandidate === "string" && codeCandidate.trim().length > 0) {
    target.code = codeCandidate.trim();
  }

  const statusKeys = ["statusCode", "status", "status_code"];
  for (const key of statusKeys) {
    const statusValue = source[key];
    if (typeof statusValue === "number") {
      target.statusCode = statusValue;
      break;
    }
  }
};

export function normalizeError(
  error: unknown,
  fallbackMessage: string = FALLBACK_MESSAGE,
): NormalizedError {
  const normalized: NormalizedError = {
    message: fallbackMessage,
  };

  if (!error) {
    return normalized;
  }

  if (typeof error === "string") {
    normalized.message = error.trim() || fallbackMessage;
    return normalized;
  }

  if (error instanceof Error) {
    normalized.message = error.message || fallbackMessage;

    const dataRecord = coerceRecord((error as Error & { data?: unknown }).data);
    if (dataRecord) {
      assignFromRecord(normalized, dataRecord);
    }

    return normalized;
  }

  const errorRecord = coerceRecord(error);
  if (errorRecord) {
    assignFromRecord(normalized, errorRecord);

    const nestedData = coerceRecord(errorRecord.data);
    if (nestedData) {
      assignFromRecord(normalized, nestedData);
    }

    return normalized;
  }

  try {
    normalized.message = String(error);
  } catch {
    normalized.message = fallbackMessage;
  }

  return normalized;
}

export function extractErrorMessage(
  error: unknown,
  fallbackMessage?: string,
): string {
  return normalizeError(error, fallbackMessage ?? FALLBACK_MESSAGE).message;
}
