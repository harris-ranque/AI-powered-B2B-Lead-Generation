/**
 * Contact acceptance layer — validates provider candidates before promotion.
 */

import {
  emailDomainMatchesCompany,
  normalizeContactEmail,
  resolveContactEmailVerified,
} from "./contactVerification";
import { expandRolesForMatching } from "./roleFamilies";

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

export function scoreTitleAgainstRoles(
  title: string | undefined,
  requestedRoles: string[],
  enableRoleExpansion: boolean,
): { score: number; matchedRole?: string; reason: string } {
  if (!title || !title.trim()) {
    return { score: 0, reason: "missing_title" };
  }

  const titleVariants = expandTitleTokens(title);
  const rolePatterns = expandRolesForMatching(requestedRoles, enableRoleExpansion);

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
        const score = Math.min(roleNorm.length, titleVariant.length) /
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

export function resolveContactTitleForStorage(
  title: string | undefined,
  matchedRole: string | undefined,
  sourceRole: string | undefined,
  requestedRoles: string[],
): string | undefined {
  const trimmedTitle = title?.trim();
  if (trimmedTitle) {
    return trimmedTitle;
  }
  const trimmedMatched = matchedRole?.trim();
  if (trimmedMatched) {
    return trimmedMatched;
  }
  const trimmedSource = sourceRole?.trim();
  if (trimmedSource) {
    return trimmedSource;
  }
  const firstRequested = requestedRoles.find((role) => role.trim().length > 0);
  return firstRequested?.trim() || undefined;
}

export function evaluateContactCandidate(
  candidate: ContactCandidateInput,
  options: {
    requestedRoles: string[];
    companyWebsite?: string;
    acceptedEmailsInSearch: Set<string>;
    enableRoleExpansion: boolean;
    requireVerifiedEmail: boolean;
    trustNamedRoleContacts?: boolean;
    sourceRole?: string;
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
    trustNamedRoleContacts: options.trustNamedRoleContacts,
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

  const titleMatch = scoreTitleAgainstRoles(
    candidate.title,
    options.requestedRoles,
    options.enableRoleExpansion,
  );

  const hasTitle = Boolean(candidate.title?.trim());
  const titleAccepted =
    titleMatch.score >= TITLE_MATCH_ACCEPT_THRESHOLD ||
    (!hasTitle &&
      options.trustNamedRoleContacts &&
      domainMatchVerified &&
      emailVerified);

  if (!titleAccepted) {
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

  const matchedRole =
    titleMatch.matchedRole ??
    (options.trustNamedRoleContacts && !hasTitle
      ? options.sourceRole?.trim() || options.requestedRoles.find((r) => r.trim())
      : undefined);

  return {
    accepted: true,
    emailVerified,
    domainMatchVerified,
    normalizedEmail,
    matchedRole,
    titleMatchScore: titleMatch.score,
    titleMatchReason: titleMatch.reason,
  };
}
