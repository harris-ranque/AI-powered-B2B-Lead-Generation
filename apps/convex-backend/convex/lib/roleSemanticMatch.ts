/**
 * Meaning-based title matching for arbitrary user-entered roles (not only static families).
 */

import { normalizeRoleText } from "./roleFamilies";

/** Stripped before comparing core role tokens. */
export const SENIORITY_TOKENS = new Set([
  "senior",
  "sr",
  "junior",
  "jr",
  "lead",
  "principal",
  "staff",
  "associate",
  "global",
  "regional",
  "executive",
  "interim",
  "acting",
]);

/** Tokens treated as the same profession lane when domain tokens also overlap. */
export const PROFESSION_EQUIVALENCE_GROUPS: string[][] = [
  ["engineer", "developer", "dev", "programmer", "practitioner", "coder"],
  ["specialist", "consultant", "expert", "advisor"],
  ["manager", "mgr"],
  ["director", "dir"],
  ["president", "pres"],
  ["vice", "vp"],
  ["officer", "exec"],
  ["representative", "rep"],
  ["administrator", "admin"],
  ["architect", "arch"],
];

function tokenizeRole(value: string): string[] {
  return normalizeRoleText(value)
    .split(" ")
    .filter((token) => token.length > 1 && !SENIORITY_TOKENS.has(token));
}

function expandProfessionTokens(tokens: string[]): Set<string> {
  const expanded = new Set(tokens);
  for (const group of PROFESSION_EQUIVALENCE_GROUPS) {
    if (group.some((token) => expanded.has(token))) {
      for (const token of group) {
        expanded.add(token);
      }
    }
  }
  return expanded;
}

export function scoreSemanticTitleMatch(
  title: string | undefined,
  requestedRoles: string[],
): { score: number; matchedRole?: string; reason: string } {
  if (!title?.trim() || requestedRoles.length === 0) {
    return { score: 0, reason: "missing_title_or_roles" };
  }

  const titleTokens = expandProfessionTokens(tokenizeRole(title));
  if (titleTokens.size === 0) {
    return { score: 0, reason: "no_title_tokens" };
  }

  let bestScore = 0;
  let matchedRole: string | undefined;

  for (const role of requestedRoles) {
    const roleTokens = expandProfessionTokens(tokenizeRole(role));
    if (roleTokens.size === 0) continue;

    let overlap = 0;
    for (const token of roleTokens) {
      if (titleTokens.has(token)) {
        overlap += 1;
      }
    }

    const overlapRatio = overlap / roleTokens.size;
    const titleCoverage = overlap / titleTokens.size;
    const score = Math.max(overlapRatio, titleCoverage * overlapRatio);

    if (score > bestScore) {
      bestScore = score;
      matchedRole = role;
    }
  }

  return {
    score: bestScore,
    matchedRole,
    reason: bestScore > 0 ? "semantic_token_match" : "no_semantic_match",
  };
}
