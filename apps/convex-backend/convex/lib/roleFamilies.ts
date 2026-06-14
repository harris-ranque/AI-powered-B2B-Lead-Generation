/**
 * Role family expansion for title matching (Phase 2).
 * Expands user-entered roles into related decision-maker titles.
 */

const ROLE_FAMILY_PATTERNS: Record<string, string[]> = {
  marketing: [
    "marketing",
    "cmo",
    "chief marketing",
    "vp marketing",
    "vice president marketing",
    "head of marketing",
    "marketing director",
    "marketing manager",
    "director of marketing",
  ],
  sales: [
    "sales",
    "cro",
    "chief revenue",
    "vp sales",
    "vice president sales",
    "head of sales",
    "sales director",
    "sales manager",
    "director of sales",
  ],
  operations: [
    "operations",
    "coo",
    "chief operating",
    "vp operations",
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
  ],
  executive: [
    "ceo",
    "chief executive",
    "founder",
    "co-founder",
    "owner",
    "president",
    "managing director",
  ],
  finance: [
    "cfo",
    "chief financial",
    "vp finance",
    "finance director",
    "head of finance",
    "controller",
  ],
  technology: [
    "cto",
    "chief technology",
    "chief technical",
    "vp engineering",
    "head of engineering",
    "engineering director",
    "it director",
  ],
  hr: [
    "hr",
    "human resources",
    "chief people",
    "head of people",
    "vp people",
    "talent",
  ],
};

function normalizeRoleToken(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s&/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectRoleFamilies(role: string): string[] {
  const normalized = normalizeRoleToken(role);
  const families: string[] = [];

  for (const [family, patterns] of Object.entries(ROLE_FAMILY_PATTERNS)) {
    if (patterns.some((pattern) => normalized.includes(pattern) || pattern.includes(normalized))) {
      families.push(family);
    }
  }

  if (families.length === 0) {
    families.push(normalized);
  }

  return families;
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
        for (const pattern of ROLE_FAMILY_PATTERNS[family]) {
          expanded.add(pattern);
        }
      } else {
        expanded.add(family);
      }
    }
  }

  return Array.from(expanded);
}
