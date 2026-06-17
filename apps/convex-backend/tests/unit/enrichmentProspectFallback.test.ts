import { describe, expect, it } from "vitest";

/**
 * Documents hybrid enrichment: role search runs when prospect name search
 * did not produce accepted contacts (or when no prospects exist).
 */
function shouldRunRoleDomainSearch(
  prospectAttempt: {
    hadProspects: boolean;
    acceptedCount: number;
    pipelineBlockingError?: unknown;
  } | null,
): boolean {
  if (prospectAttempt?.pipelineBlockingError) {
    return false;
  }
  if (!prospectAttempt?.hadProspects) {
    return true;
  }
  return prospectAttempt.acceptedCount === 0;
}

describe("enrichment prospect → role hybrid fallback", () => {
  it("runs role search when there are no prospects", () => {
    expect(shouldRunRoleDomainSearch(null)).toBe(true);
  });

  it("runs role search when prospects exist but none accepted", () => {
    expect(
      shouldRunRoleDomainSearch({
        hadProspects: true,
        acceptedCount: 0,
      }),
    ).toBe(true);
  });

  it("skips role search when prospect path already accepted contacts", () => {
    expect(
      shouldRunRoleDomainSearch({
        hadProspects: true,
        acceptedCount: 2,
      }),
    ).toBe(false);
  });

  it("skips role search when prospect path hit a pipeline-blocking error", () => {
    expect(
      shouldRunRoleDomainSearch({
        hadProspects: true,
        acceptedCount: 0,
        pipelineBlockingError: { errorCode: "credits_exhausted" },
      }),
    ).toBe(false);
  });
});
