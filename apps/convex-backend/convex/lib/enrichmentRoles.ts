/**
 * Resolve enrichment roles from action args or search parameters.
 */

export function normalizeEnrichmentRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) {
    return [];
  }
  return roles
    .filter((role): role is string => typeof role === "string" && role.trim().length > 0)
    .map((role) => role.trim());
}

export function resolveEnrichmentRoles(
  argsRoles: string[] | undefined,
  searchParameters?: { roles?: unknown },
): string[] {
  const fromArgs = normalizeEnrichmentRoles(argsRoles);
  if (fromArgs.length > 0) {
    return fromArgs;
  }
  return normalizeEnrichmentRoles(searchParameters?.roles);
}
