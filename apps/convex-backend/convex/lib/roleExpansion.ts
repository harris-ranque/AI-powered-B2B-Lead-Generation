/**
 * Hybrid static + AI role expansion for FindyMail queries and title matching.
 */

import { expandRolesForMatching } from "./roleFamilies";
import { normalizeEnrichmentRoles } from "./enrichmentRoles";

export const MAX_AI_PATTERNS_PER_ROLE = 10;
/** Stored on search for title matching; FindyMail API uses a lower cap */
export const MAX_TOTAL_ROLE_PATTERNS = 18;

export type SearchRoleParameters = {
  roles?: unknown;
  expandedRolePatterns?: unknown;
  roleExpansionSource?: unknown;
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

export function parseAiRoleExpansionResponse(
  content: string,
  rolesNeedingAi: string[],
): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }

  const record = parsed as Record<string, unknown>;
  const expansions: string[] = [];

  const expansionsByRole = record.expansions_by_role;
  if (expansionsByRole && typeof expansionsByRole === "object" && !Array.isArray(expansionsByRole)) {
    for (const role of rolesNeedingAi) {
      const key = Object.keys(expansionsByRole).find(
        (candidate) =>
          normalizeRolePattern(candidate) === normalizeRolePattern(role),
      );
      const value = key ? (expansionsByRole as Record<string, unknown>)[key] : undefined;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string" && item.trim()) {
            expansions.push(item.trim());
          }
        }
      }
    }
  }

  const flatPatterns = record.patterns;
  if (Array.isArray(flatPatterns)) {
    for (const item of flatPatterns) {
      if (typeof item === "string" && item.trim()) {
        expansions.push(item.trim());
      }
    }
  }

  return expansions;
}

export const ROLE_EXPANSION_SYSTEM_PROMPT = `You expand B2B sales target job roles into FindyMail search patterns.

Return JSON only:
{
  "expansions_by_role": {
    "<exact user role>": ["pattern1", "pattern2", ...]
  }
}

Rules:
- For each user role, return up to ${MAX_AI_PATTERNS_PER_ROLE} senior decision-maker title patterns in the SAME functional lane.
- Include variations: VP, Head, Director, Chief, SVP, Global Head, etc.
- Patterns must be short strings suitable for email enrichment APIs (lowercase words, no company names).
- Exclude coordinators, assistants, interns, analysts, and individual contributors unless the user role itself is IC-level.
- If the user role is already a chief/VP/head title, include close synonyms and abbreviated forms (e.g. CMO, chief marketing officer).
- Do not include explanations.`;
