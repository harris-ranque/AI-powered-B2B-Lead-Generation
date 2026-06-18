/**
 * Rank prospects for sequential FindyMail name search (credit optimization).
 */

export const FINDYMAIL_MIN_CONFIDENCE = 0.85;
export const MAX_FINDYMAIL_NAME_ATTEMPTS = 2;
export const FINDYMAIL_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type RankableProspect = {
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

export function normalizeCacheKeyPart(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}
