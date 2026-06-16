/**
 * Contact acceptance layer — validates provider candidates before promotion.
 */

import {
  emailDomainMatchesCompany,
  normalizeContactEmail,
  resolveContactEmailVerified,
} from "./contactVerification";
import { expandRolesForMatching, scoreRoleLaneMatch } from "./roleFamilies";

export const TITLE_MATCH_ACCEPT_THRESHOLD = 0.6;

export type ContactCandidateInput = {
  name?: string;
  title?: string;
  email?: string;
  linkedin?: string;
  confidence?: number;
  verified?: boolean;
  raw?: Record<string, unknown>;
};

export type ContactAcceptanceResult = {
  accepted: boolean;
  rejectionReason?:
    | "title_mismatch"
    | "missing_title"
    | "domain_mismatch"
    | "email_unverified"
    | "duplicate_email"
    | "missing_email";
  matchedRole?: string;
  titleMatchScore?: number;
  titleMatchReason?: string;
  emailVerified: boolean;
  domainMatchVerified: boolean;
  normalizedEmail?: string;
};

const TITLE_ABBREVIATIONS: Record<string, string[]> = {
  ceo: ["chief executive officer", "chief executive"],
  cfo: ["chief financial officer"],
  coo: ["chief operating officer"],
  cto: ["chief technology officer", "chief technical officer"],
  cmo: ["chief marketing officer"],
  vp: ["vice president", "v p"],
  svp: ["senior vice president"],
  evp: ["executive vice president"],
};

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s&/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function expandTitleTokens(title: string): string[] {
  const normalized = normalizeTitle(title);
  const tokens = new Set<string>([normalized]);

  for (const [abbr, expansions] of Object.entries(TITLE_ABBREVIATIONS)) {
    if (normalized.includes(abbr)) {
      for (const expansion of expansions) {
        tokens.add(expansion);
      }
    }
    for (const expansion of expansions) {
      if (normalized.includes(expansion)) {
        tokens.add(abbr);
      }
    }
  }

  return Array.from(tokens);
}

export function scoreTitleAgainstPatterns(
  title: string | undefined,
  rolePatterns: string[],
): { score: number; matchedRole?: string; reason: string } {
  if (!title || !title.trim()) {
    return { score: 0, reason: "missing_title" };
  }

  const titleVariants = expandTitleTokens(title);

  let bestScore = 0;
  let matchedRole: string | undefined;

  for (const rolePattern of rolePatterns) {
    const roleNorm = normalizeTitle(rolePattern);
    if (!roleNorm) continue;

    for (const titleVariant of titleVariants) {
      if (titleVariant === roleNorm) {
        return { score: 1, matchedRole: rolePattern, reason: "exact_match" };
      }
      if (titleVariant.includes(roleNorm) || roleNorm.includes(titleVariant)) {
        const score =
          Math.min(roleNorm.length, titleVariant.length) /
          Math.max(roleNorm.length, titleVariant.length);
        if (score > bestScore) {
          bestScore = score;
          matchedRole = rolePattern;
        }
      }

      const titleWords = titleVariant.split(" ").filter((w) => w.length > 2);
      const roleWords = roleNorm.split(" ").filter((w) => w.length > 2);
      const overlap = roleWords.filter((w) => titleWords.includes(w)).length;
      if (overlap > 0 && roleWords.length > 0) {
        const overlapScore = overlap / roleWords.length;
        if (overlapScore > bestScore) {
          bestScore = overlapScore;
          matchedRole = rolePattern;
        }
      }
    }
  }

  return {
    score: bestScore,
    matchedRole,
    reason: bestScore > 0 ? "partial_match" : "no_match",
  };
}

export function scoreTitleAgainstRoles(
  title: string | undefined,
  requestedRoles: string[],
  enableRoleExpansion: boolean,
): { score: number; matchedRole?: string; reason: string } {
  const rolePatterns = expandRolesForMatching(requestedRoles, enableRoleExpansion);
  let titleMatch = scoreTitleAgainstPatterns(title, rolePatterns);

  if (enableRoleExpansion && titleMatch.score < TITLE_MATCH_ACCEPT_THRESHOLD) {
    const laneMatch = scoreRoleLaneMatch(title, requestedRoles, true);
    if (laneMatch.score > titleMatch.score) {
      return laneMatch;
    }
  }

  return titleMatch;
}

/** Provider-reported job title only — never the searched role pattern. */
export function extractProviderTitle(
  candidate: ContactCandidateInput,
): string | undefined {
  const direct = candidate.title?.trim();
  if (direct) {
    return direct;
  }

  const raw = candidate.raw;
  if (!raw) {
    return undefined;
  }

  const fromRaw = [
    raw.title,
    raw.job_title,
    raw.jobTitle,
    raw.position,
    raw.occupation,
  ].find((value) => typeof value === "string" && value.trim().length > 0);

  return typeof fromRaw === "string" ? fromRaw.trim() : undefined;
}

export function resolveContactTitleForStorage(
  title: string | undefined,
): string | undefined {
  const trimmedTitle = title?.trim();
  return trimmedTitle || undefined;
}

/** Best displayable title for storage/export after provider + match fallbacks. */
export function resolveDisplayableContactTitle(input: {
  providerTitle?: string;
  matchedRole?: string;
  sourceRole?: string;
}): string | undefined {
  return resolveContactTitleForStorage(
    input.providerTitle ?? input.matchedRole ?? input.sourceRole,
  );
}

export function evaluateContactCandidate(
  candidate: ContactCandidateInput,
  options: {
    requestedRoles: string[];
    companyWebsite?: string;
    acceptedEmailsInSearch: Set<string>;
    enableRoleExpansion: boolean;
    requireVerifiedEmail: boolean;
    /** FindyMail per-role hits: trust named contacts for email verification only. */
    fromRoleContact?: boolean;
    /** Role pattern used in the API call that surfaced this contact (matching only, not storage). */
    sourceRole?: string;
    /** Cached static + AI patterns from search parameters. */
    roleMatchPatterns?: string[];
  },
): ContactAcceptanceResult {
  const normalizedEmail = normalizeContactEmail(candidate.email);
  if (!normalizedEmail) {
    return {
      accepted: false,
      rejectionReason: "missing_email",
      emailVerified: false,
      domainMatchVerified: false,
    };
  }

  if (options.acceptedEmailsInSearch.has(normalizedEmail)) {
    return {
      accepted: false,
      rejectionReason: "duplicate_email",
      emailVerified: false,
      domainMatchVerified: false,
      normalizedEmail,
    };
  }

  const emailVerified = resolveContactEmailVerified(candidate, {
    trustNamedRoleContacts: options.fromRoleContact,
  });

  if (options.requireVerifiedEmail && !emailVerified) {
    return {
      accepted: false,
      rejectionReason: "email_unverified",
      emailVerified: false,
      domainMatchVerified: false,
      normalizedEmail,
    };
  }

  const domainMatchVerified = emailDomainMatchesCompany(
    normalizedEmail,
    options.companyWebsite,
  );
  if (!domainMatchVerified) {
    return {
      accepted: false,
      rejectionReason: "domain_mismatch",
      emailVerified,
      domainMatchVerified: false,
      normalizedEmail,
    };
  }

  const providerTitle = extractProviderTitle(candidate);

  const rolePatternsForMatch =
    options.roleMatchPatterns && options.roleMatchPatterns.length > 0
      ? options.roleMatchPatterns
      : expandRolesForMatching(
          options.requestedRoles,
          options.enableRoleExpansion,
        );

  let titleMatch = scoreTitleAgainstPatterns(providerTitle, rolePatternsForMatch);

  // When FindyMail omits job title, use the searched role pattern for matching only.
  if (
    titleMatch.score < TITLE_MATCH_ACCEPT_THRESHOLD &&
    !providerTitle &&
    options.fromRoleContact &&
    options.sourceRole?.trim()
  ) {
    titleMatch = scoreTitleAgainstPatterns(
      options.sourceRole,
      rolePatternsForMatch,
    );
  }

  if (
    titleMatch.score < TITLE_MATCH_ACCEPT_THRESHOLD &&
    options.enableRoleExpansion
  ) {
    const laneMatch = scoreRoleLaneMatch(
      providerTitle ?? options.sourceRole,
      options.requestedRoles,
      true,
    );
    if (laneMatch.score > titleMatch.score) {
      titleMatch = laneMatch;
    }
  }

  if (titleMatch.score < TITLE_MATCH_ACCEPT_THRESHOLD) {
    return {
      accepted: false,
      rejectionReason: "title_mismatch",
      emailVerified,
      domainMatchVerified,
      normalizedEmail,
      titleMatchScore: titleMatch.score,
      titleMatchReason: titleMatch.reason,
    };
  }

  const displayableTitle = resolveDisplayableContactTitle({
    providerTitle,
    matchedRole: titleMatch.matchedRole,
    sourceRole: options.sourceRole,
  });
  if (!displayableTitle) {
    return {
      accepted: false,
      rejectionReason: "missing_title",
      emailVerified,
      domainMatchVerified,
      normalizedEmail,
      titleMatchScore: titleMatch.score,
      titleMatchReason: titleMatch.reason,
    };
  }

  return {
    accepted: true,
    emailVerified,
    domainMatchVerified,
    normalizedEmail,
    matchedRole: titleMatch.matchedRole,
    titleMatchScore: titleMatch.score,
    titleMatchReason: titleMatch.reason,
  };
}
