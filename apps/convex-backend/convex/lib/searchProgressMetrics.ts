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
  return Math.max(
    leadCount,
    search.results?.totalFound ?? 0,
    search.progress?.discovered ?? 0,
  );
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
