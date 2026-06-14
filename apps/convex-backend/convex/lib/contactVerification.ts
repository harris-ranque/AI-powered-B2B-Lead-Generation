/**
 * Shared email verification heuristics (aligned with FindyMail response parsing).
 */

function isTruthyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function extractConfidence(entry: Record<string, unknown>): number | undefined {
  const raw =
    entry.confidence ??
    entry.score ??
    entry.email_confidence ??
    entry.emailConfidence;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function normalizeContactEmail(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const candidate = value.trim().toLowerCase();
  if (!candidate.includes("@")) {
    return null;
  }
  return candidate;
}

export function isContactEmailVerified(entry: Record<string, unknown>): boolean {
  const flags = [
    entry.verified,
    entry.is_verified,
    entry.email_verified,
    entry.emailVerified,
    entry.deliverable,
    entry.status,
    entry.email_status,
  ];

  for (const flag of flags) {
    if (typeof flag === "boolean") {
      return flag;
    }
    if (typeof flag === "string" && flag.trim()) {
      const normalized = flag.trim().toLowerCase();
      if (
        ["verified", "valid", "deliverable", "success", "accept_all"].includes(
          normalized,
        )
      ) {
        return true;
      }
      if (
        ["unverified", "invalid", "undeliverable", "unknown"].includes(
          normalized,
        )
      ) {
        return false;
      }
    }
  }

  const confidence = extractConfidence(entry);
  if (typeof confidence === "number") {
    return confidence >= 0.7;
  }

  return false;
}

export function extractDomainFromWebsite(website: string | undefined | null): string | null {
  if (!website || !website.trim()) {
    return null;
  }
  try {
    const withProtocol = website.includes("://") ? website : `https://${website}`;
    const hostname = new URL(withProtocol).hostname.toLowerCase();
    return hostname.replace(/^www\./, "");
  } catch {
    const cleaned = website
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "");
    const host = cleaned.split("/")[0] ?? "";
    return host.includes(".") ? host : null;
  }
}

export function emailDomainMatchesCompany(
  email: string,
  companyWebsite: string | undefined | null,
): boolean {
  const emailDomain = email.split("@")[1]?.toLowerCase();
  const companyDomain = extractDomainFromWebsite(companyWebsite);
  if (!emailDomain || !companyDomain) {
    return false;
  }
  return emailDomain === companyDomain || emailDomain.endsWith(`.${companyDomain}`);
}
