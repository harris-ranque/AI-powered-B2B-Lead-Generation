import { describe, expect, it } from "vitest";
import {
  PIPELINE_BROADCAST_COALESCE_MS,
  shouldCoalescePipelineBroadcast,
} from "../../convex/realtime/broadcaster";

describe("pipeline broadcast coalescing", () => {
  const now = 1_700_000_000_000;

  it("skips when same stage was broadcast recently", () => {
    expect(
      shouldCoalescePipelineBroadcast(
        {
          createdAt: now - 500,
          data: { stage: "analysis", progress: 10 },
        },
        "analysis",
        now,
      ),
    ).toBe(true);
  });

  it("allows broadcast when stage changed", () => {
    expect(
      shouldCoalescePipelineBroadcast(
        {
          createdAt: now - 500,
          data: { stage: "enrichment", progress: 50 },
        },
        "analysis",
        now,
      ),
    ).toBe(false);
  });

  it("allows broadcast after coalesce window", () => {
    expect(
      shouldCoalescePipelineBroadcast(
        {
          createdAt: now - PIPELINE_BROADCAST_COALESCE_MS - 1,
          data: { stage: "analysis", progress: 10 },
        },
        "analysis",
        now,
      ),
    ).toBe(false);
  });

  it("allows broadcast when there is no prior row", () => {
    expect(shouldCoalescePipelineBroadcast(null, "analysis", now)).toBe(false);
  });
});
