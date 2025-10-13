import { toASCII } from "node:punycode";

const PROTOCOL_REGEX = /^[a-z]+:\/\//i;
const TRAILING_DOT_REGEX = /\.+$/;

function stripProtocol(value: string): string {
  return value.replace(PROTOCOL_REGEX, "");
}

function stripPath(value: string): string {
  const slashIndex = value.indexOf("/");
  if (slashIndex === -1) {
    return value;
  }
  return value.slice(0, slashIndex);
}

function normalizeHost(host: string): string {
  let normalized = host.trim().toLowerCase();
  if (normalized.startsWith("www.")) {
    normalized = normalized.slice(4);
  }
  normalized = normalized.replace(TRAILING_DOT_REGEX, "");
  return normalized;
}

export function canonicalizeDomain(urlOrHost: string): string {
  const value = urlOrHost?.trim();
  if (!value) {
    return "";
  }

  let hostCandidate = value;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    hostCandidate = url.hostname;
  } catch {
    const withoutProtocol = stripProtocol(value);
    hostCandidate = stripPath(withoutProtocol);
  }

  const normalizedHost = normalizeHost(hostCandidate);
  if (!normalizedHost) {
    return "";
  }

  try {
    return toASCII(normalizedHost);
  } catch {
    return normalizedHost;
  }
}
