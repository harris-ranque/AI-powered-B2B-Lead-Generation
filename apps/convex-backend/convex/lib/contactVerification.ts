/**
 * Shared email verification heuristics (aligned with FindyMail response parsing).
 */

function isTruthyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function extractConfidence(entry: Record<string, unknown>): number | undefined {
  const raw =
    entry.confidence ??
    entry.confidence_score ??
    entry.confidenceScore ??
    entry.score ??
    entry.certainty ??
    entry.accuracy ??
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
    entry.verification_status,
    entry.verificationStatus,
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

function isRecognizablePersonName(
  name: string | undefined,
  email: string | undefined,
): boolean {
  const trimmed = name?.trim();
  if (!trimmed || trimmed === "Unknown" || trimmed === "Unknown contact") {
    return false;
  }

  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount >= 2) {
    return true;
  }

  const local = email?.split("@")[0]?.toLowerCase().replace(/[._-]/g, " ");
  const normalizedName = trimmed.toLowerCase();
  if (local) {
    const compactLocal = local.replace(/\s+/g, "");
    const compactName = normalizedName.replace(/\s+/g, "");
    if (normalizedName === local || compactName === compactLocal) {
      return false;
    }
  }

  return trimmed.length > 2;
}

/**
 * Resolve whether a provider contact email should be treated as verified.
 * Merges candidate fields with raw provider payload (FindyMail often omits verified on contacts).
 */
export function resolveContactEmailVerified(
  candidate: {
    email?: string;
    name?: string;
    title?: string;
    confidence?: number;
    verified?: boolean;
    raw?: Record<string, unknown>;
  },
  options?: { trustNamedRoleContacts?: boolean },
): boolean {
  if (candidate.verified === true) {
    return true;
  }

  const entry: Record<string, unknown> = {
    ...(candidate.raw ?? {}),
  };

  if (candidate.confidence !== undefined) {
    entry.confidence = candidate.confidence;
    if (entry.score === undefined) {
      entry.score = candidate.confidence;
    }
  }

  if (candidate.verified !== undefined) {
    entry.verified = candidate.verified;
  }

  if (isContactEmailVerified(entry)) {
    return true;
  }

  if (!options?.trustNamedRoleContacts) {
    return false;
  }

  if (!normalizeContactEmail(candidate.email)) {
    return false;
  }

  if (candidate.title?.trim()) {
    return true;
  }

  return isRecognizablePersonName(candidate.name, candidate.email);
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
