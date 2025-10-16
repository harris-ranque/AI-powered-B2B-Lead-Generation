export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMin?: number;
  jitterMax?: number;
  onRetry?: (info: { attempt: number; delayMs: number; error?: unknown; response?: Response }) => void;
  shouldRetry?: (response: Response | null, error: unknown | null, attempt: number) => boolean;
}

export function parseRetryAfter(headerValue: string | null): number | null {
  if (!headerValue) {
    return null;
  }

  const seconds = Number.parseFloat(headerValue);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const date = Date.parse(headerValue);
  if (Number.isNaN(date)) {
    return null;
  }
  const now = Date.now();
  return Math.max(0, date - now);
}

export function withJitter(baseDelayMs: number, jitterMin = 0.3, jitterMax = 0.7): number {
  if (baseDelayMs <= 0) {
    return 0;
  }
  const min = Math.max(0, jitterMin);
  const max = Math.max(min, jitterMax);
  const jitter = min + Math.random() * (max - min);
  return baseDelayMs * (1 + jitter);
}

export async function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  input: RequestInfo,
  init: RequestInit,
  options: RetryOptions = {},
): Promise<Response> {
  const {
    maxAttempts = 3,
    baseDelayMs = 500,
    maxDelayMs = 15_000,
    jitterMin = 0.3,
    jitterMax = 0.7,
    onRetry,
    shouldRetry,
  } = options;

  let attempt = 0;
  while (true) {
    attempt += 1;
    let response: Response | null = null;
    try {
      response = await fetch(input, init);
      if (!response.ok && shouldRetry?.(response, null, attempt)) {
        if (attempt >= maxAttempts) {
          return response;
        }
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        const computedDelay = Math.min(
          maxDelayMs,
          withJitter(baseDelayMs * 2 ** (attempt - 1), jitterMin, jitterMax),
        );
        const delayMs = retryAfter ?? computedDelay;
        onRetry?.({ attempt, delayMs, response });
        await sleep(delayMs);
        continue;
      }
      if (!response.ok && !shouldRetry) {
        return response;
      }
      if (response.ok || attempt >= maxAttempts) {
        return response;
      }
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error;
      }
      if (shouldRetry && !shouldRetry(null, error, attempt)) {
        throw error;
      }
      const delayMs = Math.min(
        maxDelayMs,
        withJitter(baseDelayMs * 2 ** (attempt - 1), jitterMin, jitterMax),
      );
      onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
}
