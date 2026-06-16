import type { ActionCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { isPeopleDiscoveryEnabled } from "./featureFlags";

type SchedulerCtx = Pick<ActionCtx | MutationCtx, "scheduler">;

/**
 * After Google Maps discovery: people discovery (if enabled) then email enrichment.
 */
export async function schedulePostDiscoveryPipeline(
  ctx: SchedulerCtx,
  searchId: Id<"searches">,
): Promise<void> {
  if (isPeopleDiscoveryEnabled()) {
    await ctx.scheduler.runAfter(
      0,
      internal.leads.asyncPeopleDiscovery.discoverPeopleForSearch,
      { searchId },
    );
    return;
  }

  await ctx.scheduler.runAfter(0, "leads/actions:enrichLeads" as any, {
    searchId,
  });
}
