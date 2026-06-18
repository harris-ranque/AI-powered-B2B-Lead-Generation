/**
 * Rank prospects for FindyMail /search/name.
 * Multi-contact: try every role-matched person returned by people discovery.
 */

export const FINDYMAIL_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type RankableProspect = {
  name?: string;
  confidence: number;
  matchedRole?: string | null;
  rankScore?: number | null;
  title: string;
};

export function computeEffectiveRankScore(
  prospect: RankableProspect,
  requestedRoles: string[],
): number {
  if (typeof prospect.rankScore === "number" && prospect.rankScore > 0) {
    return prospect.rankScore * 0.55 + prospect.confidence * 0.45;
  }

  let rolePriorityScore = 0.5;
  if (prospect.matchedRole && requestedRoles.length > 0) {
    const matchedNorm = prospect.matchedRole.toLowerCase().trim();
    const index = requestedRoles.findIndex(
      (role) => role.toLowerCase().trim() === matchedNorm,
    );
    if (index === 0) {
      rolePriorityScore = 0.98;
    } else if (index > 0) {
      rolePriorityScore = Math.max(0.72, 0.95 - index * 0.03);
    } else {
      rolePriorityScore = 0.75;
    }
  }

  return rolePriorityScore * 0.55 + prospect.confidence * 0.45;
}

export function rankProspectsForFindyMail<T extends RankableProspect>(
  prospects: T[],
  requestedRoles: string[],
): T[] {
  return [...prospects].sort(
    (a, b) =>
      computeEffectiveRankScore(b, requestedRoles) -
      computeEffectiveRankScore(a, requestedRoles),
  );
}

function prospectNameKey(prospect: RankableProspect): string {
  return prospect.name?.toLowerCase().trim() ?? "";
}

/**
 * All discovered prospects for email lookup (deduped by name).
 * Orders so each requested role is represented first, then remaining people.
 */
export function selectProspectsForFindyMailNameSearch<T extends RankableProspect>(
  prospects: T[],
  requestedRoles: string[],
): T[] {
  if (prospects.length === 0) {
    return [];
  }

  const ranked = rankProspectsForFindyMail(prospects, requestedRoles);
  const selected: T[] = [];
  const seenNames = new Set<string>();

  const tryAdd = (prospect: T): void => {
    const nameKey = prospectNameKey(prospect);
    if (nameKey && seenNames.has(nameKey)) {
      return;
    }
    if (nameKey) {
      seenNames.add(nameKey);
    }
    selected.push(prospect);
  };

  const normalizedRoles = requestedRoles
    .map((role) => role.toLowerCase().trim())
    .filter(Boolean);

  for (const role of normalizedRoles) {
    const match = ranked.find(
      (prospect) =>
        !seenNames.has(prospectNameKey(prospect)) &&
        prospect.matchedRole?.toLowerCase().trim() === role,
    );
    if (match) {
      tryAdd(match);
    }
  }

  for (const prospect of ranked) {
    tryAdd(prospect);
  }

  return selected;
}

export function normalizeCacheKeyPart(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}
