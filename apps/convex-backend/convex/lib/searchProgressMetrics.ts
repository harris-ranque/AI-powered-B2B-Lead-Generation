import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type ProgressCtx = MutationCtx | QueryCtx;

/** Never shrink discovered/total when a small enrichment batch publishes progress. */
export function mergeDiscoveredCount(
  search: Doc<"searches"> | null,
  leadCount: number,
): number {
  if (!search) {
    return leadCount;
  }
  const maxResults =
    typeof search.parameters?.maxResults === "number" &&
    search.parameters.maxResults > 0
      ? search.parameters.maxResults
      : undefined;
  const cappedLeadCount =
    maxResults !== undefined ? Math.min(leadCount, maxResults) : leadCount;
  const previous = Math.max(
    search.results?.totalFound ?? 0,
    search.progress?.discovered ?? 0,
  );
  const cappedPrevious =
    maxResults !== undefined ? Math.min(previous, maxResults) : previous;
  return Math.max(cappedLeadCount, cappedPrevious);
}

export async function countLeadsOnSearch(
  ctx: ProgressCtx,
  searchId: Id<"searches">,
): Promise<number> {
  const leads = await ctx.db
    .query("leads")
    .withIndex("by_search", (q) => q.eq("searchId", searchId))
    .collect();
  return leads.length;
}

export async function resolveDiscoveredCountForSearch(
  ctx: ProgressCtx,
  searchId: Id<"searches">,
): Promise<number> {
  const search = await ctx.db.get(searchId);
  const leadCount = await countLeadsOnSearch(ctx, searchId);
  return mergeDiscoveredCount(search, leadCount);
}
