/**
 * Hybrid static + AI role expansion for FindyMail queries and title matching.
 */

import { expandRolesForMatching } from "./roleFamilies";
import { normalizeEnrichmentRoles } from "./enrichmentRoles";

export const MAX_AI_PATTERNS_PER_ROLE = 10;
export const MAX_AI_TITLE_SYNONYMS_PER_ROLE = 12;
/** FindyMail API query cap */
export const MAX_TOTAL_ROLE_PATTERNS = 18;
/** Acceptance matching can use a larger synonym list */
export const MAX_TOTAL_TITLE_MATCHERS = 50;

export type SearchRoleParameters = {
  roles?: unknown;
  expandedRolePatterns?: unknown;
  expandedPatternsByRole?: unknown;
  expandedTitleMatchers?: unknown;
  roleExpansionSource?: unknown;
};

export type ParsedAiRoleExpansion = {
  findymailPatterns: string[];
  titleSynonyms: string[];
  findymailPatternsByRole: Record<string, string[]>;
};

export function normalizeRolePattern(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s&/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildStaticRolePatterns(userRoles: string[]): string[] {
  const merged = new Set<string>();
  for (const role of userRoles) {
    for (const pattern of expandRolesForMatching([role], true)) {
      const normalized = normalizeRolePattern(pattern);
      if (normalized) {
        merged.add(normalized);
      }
    }
    const userNormalized = normalizeRolePattern(role);
    if (userNormalized) {
      merged.add(userNormalized);
    }
  }
  return Array.from(merged);
}

/** Roles where static families add little beyond the literal input. */
export function rolesNeedingAiExpansion(userRoles: string[]): string[] {
  return userRoles.filter((role) => expandRolesForMatching([role], true).length <= 2);
}

export function mergeRolePatterns(
  userRoles: string[],
  staticPatterns: string[],
  aiPatterns: string[],
): string[] {
  const merged = new Set<string>();

  const add = (pattern: string) => {
    const normalized = normalizeRolePattern(pattern);
    if (normalized) {
      merged.add(normalized);
    }
  };

  for (const role of userRoles) {
    add(role);
  }
  for (const pattern of staticPatterns) {
    add(pattern);
  }
  for (const pattern of aiPatterns) {
    add(pattern);
  }

  return Array.from(merged).slice(0, MAX_TOTAL_ROLE_PATTERNS);
}

export function resolveEnrichmentRolePatterns(
  userRoles: string[],
  searchParameters?: SearchRoleParameters,
): string[] {
  const cached = normalizeEnrichmentRoles(searchParameters?.expandedRolePatterns);
  if (cached.length > 0) {
    return cached.map((role) => normalizeRolePattern(role)).filter(Boolean);
  }
  if (userRoles.length === 0) {
    return [];
  }
  return buildStaticRolePatterns(userRoles);
}

/** Patterns used when accepting FindyMail contacts (string + semantic matching). */
export function resolveTitleMatchPatterns(
  userRoles: string[],
  searchParameters?: SearchRoleParameters,
): string[] {
  const cachedMatchers = normalizeEnrichmentRoles(
    searchParameters?.expandedTitleMatchers,
  );
  if (cachedMatchers.length > 0) {
    return cachedMatchers
      .map((role) => normalizeRolePattern(role))
      .filter(Boolean);
  }

  const enrichmentPatterns = resolveEnrichmentRolePatterns(
    userRoles,
    searchParameters,
  );
  if (userRoles.length === 0) {
    return enrichmentPatterns;
  }

  return mergeTitleMatchers(
    userRoles,
    buildStaticRolePatterns(userRoles),
    enrichmentPatterns,
  );
}

function findRoleKey(
  record: Record<string, unknown>,
  role: string,
): string | undefined {
  return Object.keys(record).find(
    (candidate) =>
      normalizeRolePattern(candidate) === normalizeRolePattern(role),
  );
}

function collectStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

export function parseAiRoleExpansionResponse(
  content: string,
  userRoles: string[],
): ParsedAiRoleExpansion {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { findymailPatterns: [], titleSynonyms: [], findymailPatternsByRole: {} };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { findymailPatterns: [], titleSynonyms: [], findymailPatternsByRole: {} };
  }

  const record = parsed as Record<string, unknown>;
  const findymailPatterns: string[] = [];
  const titleSynonyms: string[] = [];
  const findymailPatternsByRole: Record<string, string[]> = {};

  const expansionsByRole = record.expansions_by_role;
  if (
    expansionsByRole &&
    typeof expansionsByRole === "object" &&
    !Array.isArray(expansionsByRole)
  ) {
    for (const role of userRoles) {
      const key = findRoleKey(expansionsByRole as Record<string, unknown>, role);
      const value = key
        ? (expansionsByRole as Record<string, unknown>)[key]
        : undefined;
      const roleNorm = normalizeRolePattern(role);
      const rolePatterns: string[] = [];

      if (Array.isArray(value)) {
        rolePatterns.push(...collectStringArray(value));
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        const structured = value as Record<string, unknown>;
        rolePatterns.push(...collectStringArray(structured.findymail_patterns));
        titleSynonyms.push(...collectStringArray(structured.title_synonyms));
      }

      if (roleNorm && rolePatterns.length > 0) {
        findymailPatternsByRole[roleNorm] = rolePatterns
          .map((pattern) => normalizeRolePattern(pattern))
          .filter(Boolean);
      }

      findymailPatterns.push(...rolePatterns);
    }
  }

  const titleSynonymsByRole = record.title_synonyms_by_role;
  if (
    titleSynonymsByRole &&
    typeof titleSynonymsByRole === "object" &&
    !Array.isArray(titleSynonymsByRole)
  ) {
    for (const role of userRoles) {
      const key = findRoleKey(
        titleSynonymsByRole as Record<string, unknown>,
        role,
      );
      const value = key
        ? (titleSynonymsByRole as Record<string, unknown>)[key]
        : undefined;
      titleSynonyms.push(...collectStringArray(value));
    }
  }

  const flatPatterns = record.patterns;
  findymailPatterns.push(...collectStringArray(flatPatterns));

  const flatSynonyms = record.title_synonyms;
  titleSynonyms.push(...collectStringArray(flatSynonyms));

  return { findymailPatterns, titleSynonyms, findymailPatternsByRole };
}

/** Static + optional AI patterns grouped per user role (excludes the literal role). */
export function buildExpandedPatternsByRole(
  userRoles: string[],
  aiPatternsByRole: Record<string, string[]> = {},
): Record<string, string[]> {
  const groups: Record<string, string[]> = {};

  for (const role of userRoles) {
    const roleNorm = normalizeRolePattern(role);
    if (!roleNorm) continue;

    const merged = new Set<string>();
    for (const pattern of expandRolesForMatching([role], true)) {
      const normalized = normalizeRolePattern(pattern);
      if (normalized && normalized !== roleNorm) {
        merged.add(normalized);
      }
    }

    const aiPatterns = aiPatternsByRole[roleNorm] ?? [];
    for (const pattern of aiPatterns) {
      const normalized = normalizeRolePattern(pattern);
      if (normalized && normalized !== roleNorm) {
        merged.add(normalized);
      }
    }

    groups[roleNorm] = Array.from(merged);
  }

  return groups;
}

/**
 * Round-robin expanded patterns across role groups: A1, B1, C1, A2, B2, C2, ...
 */
export function buildRoundRobinExpandedPatterns(
  userRoles: string[],
  patternsByRole: Record<string, string[]>,
  maxPatterns: number,
): string[] {
  const userRoleNorms = userRoles
    .map((role) => normalizeRolePattern(role))
    .filter(Boolean);
  const userRoleSet = new Set(userRoleNorms);

  const queues: string[][] = [];
  for (const roleNorm of userRoleNorms) {
    const seenInGroup = new Set<string>();
    const queue: string[] = [];
    for (const pattern of patternsByRole[roleNorm] ?? []) {
      const normalized = normalizeRolePattern(pattern);
      if (
        !normalized ||
        normalized === roleNorm ||
        userRoleSet.has(normalized) ||
        seenInGroup.has(normalized)
      ) {
        continue;
      }
      seenInGroup.add(normalized);
      queue.push(normalized);
    }
    queues.push(queue);
  }

  if (queues.length === 0 || maxPatterns <= 0) {
    return [];
  }

  const result: string[] = [];
  const globalSeen = new Set<string>(userRoleSet);
  let round = 0;

  while (result.length < maxPatterns) {
    let addedInRound = false;
    for (const queue of queues) {
      const pattern = queue[round];
      if (!pattern || globalSeen.has(pattern)) {
        continue;
      }
      globalSeen.add(pattern);
      result.push(pattern);
      addedInRound = true;
      if (result.length >= maxPatterns) {
        break;
      }
    }
    if (!addedInRound) {
      break;
    }
    round += 1;
  }

  return result;
}

export function resolveExpandedPatternsByRole(
  userRoles: string[],
  searchParameters?: SearchRoleParameters,
): Record<string, string[]> {
  const raw = searchParameters?.expandedPatternsByRole;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    const groups: Record<string, string[]> = {};
    for (const role of userRoles) {
      const roleNorm = normalizeRolePattern(role);
      const key = Object.keys(record).find(
        (candidate) => normalizeRolePattern(candidate) === roleNorm,
      );
      const value = key ? record[key] : undefined;
      if (Array.isArray(value)) {
        groups[roleNorm] = value
          .filter((item): item is string => typeof item === "string")
          .map((item) => normalizeRolePattern(item))
          .filter(Boolean);
      }
    }
    if (Object.keys(groups).length > 0) {
      return groups;
    }
  }

  return buildExpandedPatternsByRole(userRoles);
}

export function mergeTitleMatchers(
  userRoles: string[],
  staticPatterns: string[],
  extraPatterns: string[],
): string[] {
  const merged = new Set<string>();

  const add = (pattern: string) => {
    const normalized = normalizeRolePattern(pattern);
    if (normalized) {
      merged.add(normalized);
    }
  };

  for (const role of userRoles) {
    add(role);
  }
  for (const pattern of staticPatterns) {
    add(pattern);
  }
  for (const pattern of extraPatterns) {
    add(pattern);
  }

  return Array.from(merged).slice(0, MAX_TOTAL_TITLE_MATCHERS);
}

export const ROLE_EXPANSION_SYSTEM_PROMPT = `You expand user-entered B2B job roles for lead enrichment and title acceptance.

Return JSON only:
{
  "expansions_by_role": {
    "<exact user role>": {
      "findymail_patterns": ["pattern1", ...],
      "title_synonyms": ["synonym1", ...]
    }
  }
}

Rules for findymail_patterns (up to ${MAX_AI_PATTERNS_PER_ROLE} per role):
- Patterns for email enrichment APIs: short lowercase strings, no company names.
- For executive/manager roles: include VP, Head, Director, Chief, SVP, etc. in the same lane.
- For individual-contributor / specialist roles (e.g. DevOps Engineer, Data Scientist): include senior IC variants and related lane titles, NOT unrelated executives.

Rules for title_synonyms (up to ${MAX_AI_TITLE_SYNONYMS_PER_ROLE} per role):
- Titles a provider might return that mean the SAME role lane as the user input.
- Include seniority variants (senior, lead, principal), phrasing variants (practitioner, specialist, developer), and abbreviated forms.
- Examples for "DevOps Engineer": senior devops engineer, devops practitioner, devops developer, lead devops engineer, devops specialist.
- Examples for "Founder": co-founder, cofounder, founding partner, company founder.
- Examples for "Marketing Manager": marketing director, head of marketing, vp marketing, cmo.
- Do NOT include unrelated roles (e.g. accountant for DevOps Engineer).

Do not include explanations.`;
