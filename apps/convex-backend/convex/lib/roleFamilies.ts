/**
 * Role family expansion for title matching (Phase 2).
 * Expands user-entered roles into related decision-maker titles.
 */

const ROLE_FAMILY_PATTERNS: Record<string, string[]> = {
  marketing: [
    "marketing",
    "cmo",
    "chief marketing officer",
    "chief marketing",
    "vp of marketing",
    "vp marketing",
    "vice president of marketing",
    "vice president marketing",
    "head of marketing",
    "marketing director",
    "marketing manager",
    "director of marketing",
    "senior marketing manager",
    "global head of marketing",
  ],
  sales: [
    "sales",
    "cro",
    "chief revenue officer",
    "chief revenue",
    "vp of sales",
    "vp sales",
    "vice president of sales",
    "vice president sales",
    "head of sales",
    "sales director",
    "sales manager",
    "director of sales",
    "regional sales director",
  ],
  operations: [
    "operations",
    "coo",
    "chief operating officer",
    "chief operating",
    "vp of operations",
    "vp operations",
    "vice president of operations",
    "vice president operations",
    "head of operations",
    "operations director",
    "operations manager",
    "director of operations",
  ],
  property: [
    "property",
    "property management",
    "property manager",
    "regional property",
    "director of property",
    "head of property",
    "vp property",
    "vp of property",
  ],
  executive: [
    "ceo",
    "chief executive officer",
    "chief executive",
    "founder",
    "co-founder",
    "owner",
    "president",
    "managing director",
  ],
  finance: [
    "cfo",
    "chief financial officer",
    "chief financial",
    "vp of finance",
    "vp finance",
    "vice president of finance",
    "finance director",
    "head of finance",
    "controller",
    "director of finance",
  ],
  technology: [
    "cto",
    "chief technology officer",
    "chief technology",
    "chief technical officer",
    "vp of engineering",
    "vp engineering",
    "vice president of engineering",
    "head of engineering",
    "engineering director",
    "it director",
    "director of engineering",
  ],
  hr: [
    "hr",
    "human resources",
    "chief people officer",
    "chief people",
    "head of people",
    "head of hr",
    "vp people",
    "vp of people",
    "vp hr",
    "talent",
    "people operations",
  ],
};

const ROLE_ABBREVIATIONS = new Set([
  "cmo",
  "cro",
  "cto",
  "cfo",
  "coo",
  "ceo",
  "svp",
  "evp",
  "vp",
  "hr",
]);

/** Lane match score — same functional area, different seniority/title wording. */
export const ROLE_LANE_MATCH_SCORE = 0.85;

function normalizeRoleToken(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s&/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isDecisionMakerPattern(pattern: string): boolean {
  return pattern.includes(" ") || ROLE_ABBREVIATIONS.has(pattern);
}

function patternMatchesText(textNorm: string, patternNorm: string): boolean {
  if (!textNorm || !patternNorm) {
    return false;
  }
  if (textNorm === patternNorm) {
    return true;
  }
  if (textNorm.includes(patternNorm) || patternNorm.includes(textNorm)) {
    return true;
  }

  const textWords = textNorm.split(" ").filter((w) => w.length > 2);
  const patternWords = patternNorm.split(" ").filter((w) => w.length > 2);
  if (patternWords.length === 0) {
    return false;
  }

  const overlap = patternWords.filter((w) => textWords.includes(w)).length;
  return overlap > 0 && overlap / patternWords.length >= 0.5;
}

function detectRoleFamilies(role: string): string[] {
  const normalized = normalizeRoleToken(role);
  const families: string[] = [];

  for (const [family, patterns] of Object.entries(ROLE_FAMILY_PATTERNS)) {
    if (
      patterns.some(
        (pattern) =>
          patternMatchesText(normalized, normalizeRoleToken(pattern)),
      )
    ) {
      families.push(family);
    }
  }

  if (families.length === 0) {
    families.push(normalized);
  }

  return families;
}

/**
 * Detect which role families a job title belongs to.
 */
export function detectFamiliesInText(text: string): string[] {
  const normalized = normalizeRoleToken(text);
  if (!normalized) {
    return [];
  }

  const families: string[] = [];
  for (const [family, patterns] of Object.entries(ROLE_FAMILY_PATTERNS)) {
    const matched = patterns.some((pattern) =>
      patternMatchesText(normalized, normalizeRoleToken(pattern)),
    );
    if (matched) {
      families.push(family);
    }
  }
  return families;
}

/**
 * When expansion is enabled, accept decision-makers in the same lane as requested roles
 * (e.g. Marketing Director when user searched Marketing Manager).
 */
export function scoreRoleLaneMatch(
  title: string,
  requestedRoles: string[],
  enableExpansion: boolean,
): { score: number; matchedRole?: string; reason: string } {
  if (!enableExpansion || !title.trim()) {
    return { score: 0, reason: "no_lane_match" };
  }

  const titleNorm = normalizeRoleToken(title);
  const titleFamilies = detectFamiliesInText(title);
  if (titleFamilies.length === 0) {
    return { score: 0, reason: "no_lane_match" };
  }

  let bestScore = 0;
  let matchedRole: string | undefined;

  for (const requestedRole of requestedRoles) {
    const requestedFamilies = detectRoleFamilies(requestedRole);
    const sharedFamilies = requestedFamilies.filter(
      (family) => titleFamilies.includes(family) && ROLE_FAMILY_PATTERNS[family],
    );

    for (const family of sharedFamilies) {
      const decisionMakerPatterns =
        ROLE_FAMILY_PATTERNS[family].filter(isDecisionMakerPattern);
      const titleIsDecisionMaker = decisionMakerPatterns.some((pattern) =>
        patternMatchesText(titleNorm, normalizeRoleToken(pattern)),
      );

      if (!titleIsDecisionMaker) {
        continue;
      }

      if (ROLE_LANE_MATCH_SCORE > bestScore) {
        bestScore = ROLE_LANE_MATCH_SCORE;
        matchedRole = requestedRole;
      }
    }
  }

  return {
    score: bestScore,
    matchedRole,
    reason: bestScore > 0 ? "lane_match" : "no_lane_match",
  };
}

/**
 * Expand requested roles into matchable title patterns.
 */
export function expandRolesForMatching(
  roles: string[],
  enableExpansion: boolean,
): string[] {
  const expanded = new Set<string>();

  for (const role of roles) {
    const normalized = normalizeRoleToken(role);
    if (!normalized) continue;
    expanded.add(normalized);

    if (!enableExpansion) continue;

    const families = detectRoleFamilies(role);
    for (const family of families) {
      if (ROLE_FAMILY_PATTERNS[family]) {
        for (const pattern of ROLE_FAMILY_PATTERNS[family]!) {
          expanded.add(pattern);
        }
      } else {
        expanded.add(family);
      }
    }
  }

  return Array.from(expanded);
}
