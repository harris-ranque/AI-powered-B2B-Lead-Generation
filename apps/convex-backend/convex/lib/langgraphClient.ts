/**
 * Shared LangGraph worker URL + request helpers for Convex actions.
 */

const KNOWN_PATH_SUFFIXES = [
  "/batch-generate-emails",
  "/generate-emails",
  "/analyze-lead",
  "/research-company",
  "/discover-people",
  "/health",
  "/validate-keys",
];

/**
 * LANGGRAPH_URL must be the worker base URL (no API path).
 * Strips trailing slashes and accidental path suffixes from misconfiguration.
 */
export function normalizeLangGraphBaseUrl(url: string): string {
  let base = url.trim().replace(/\/+$/, "");

  for (const suffix of KNOWN_PATH_SUFFIXES) {
    if (base.endsWith(suffix)) {
      base = base.slice(0, -suffix.length).replace(/\/+$/, "");
      break;
    }
  }

  return base;
}

export function buildLangGraphUrl(baseUrl: string, path: string): string {
  const normalizedBase = normalizeLangGraphBaseUrl(baseUrl);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function langGraphRequestHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    // ngrok free tier: avoid interstitial HTML responses on server-side fetch
    "ngrok-skip-browser-warning": "true",
  };
}

export function formatLangGraphHealthError(
  status: number,
  statusText: string,
  baseUrl: string,
): string {
  if (status === 404) {
    return (
      `Health check failed with status 404: Not Found. ` +
      `Convex called ${buildLangGraphUrl(baseUrl, "/health")} but no worker responded. ` +
      "Start the LangGraph worker (port 8080), ensure ngrok/Railway tunnel is active, " +
      "and set LANGGRAPH_URL to the base URL only (e.g. https://your-tunnel.ngrok-free.dev)."
    );
  }

  return `Health check failed with status ${status}: ${statusText}`;
}
