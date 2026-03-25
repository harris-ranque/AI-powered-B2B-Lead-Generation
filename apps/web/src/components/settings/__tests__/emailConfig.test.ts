import { describe, expect, it } from "vitest";
import {
  buildSignature,
  hasSameEmailConfig,
  resolveInitialEmailSignature,
  resolveSignature,
} from "../emailConfig";

describe("emailConfig helpers", () => {
  it("builds the default signature from available fields", () => {
    expect(
      buildSignature("Alex Rivera", "Genni", "alex@example.com"),
    ).toBe("Best regards,\nAlex Rivera\nGenni\nalex@example.com");
  });

  it("preserves an explicitly empty saved signature", () => {
    expect(resolveSignature("")).toBe("");
  });

  it("returns empty string when no signature has been saved", () => {
    expect(resolveSignature(undefined)).toBe("");
  });

  it("compares email config snapshots accurately", () => {
    const config = {
      fromName: "Alex Rivera",
      fromEmail: "alex@example.com",
      signature: "Custom signature",
    };

    expect(hasSameEmailConfig(config, config)).toBe(true);
    expect(
      hasSameEmailConfig(config, {
        ...config,
        signature: "Different signature",
      }),
    ).toBe(false);
  });

  it("prefers a dirty draft over the backend signature", () => {
    expect(
      resolveInitialEmailSignature({
        savedSignature: "Old signature",
        draft: {
          value: "",
          mode: "dirty",
          updatedAt: 1_000,
        },
        now: 2_000,
        reconciliationWindowMs: 15_000,
      }),
    ).toEqual({
      signature: "",
      clearStoredDraft: false,
    });
  });

  it("keeps a recently saved draft during backend reconciliation", () => {
    expect(
      resolveInitialEmailSignature({
        savedSignature: "Old signature",
        draft: {
          value: "",
          mode: "saved",
          updatedAt: 10_000,
        },
        now: 20_000,
        reconciliationWindowMs: 15_000,
      }),
    ).toEqual({
      signature: "",
      clearStoredDraft: false,
    });
  });

  it("clears a saved draft once the backend matches it", () => {
    expect(
      resolveInitialEmailSignature({
        savedSignature: "",
        draft: {
          value: "",
          mode: "saved",
          updatedAt: 10_000,
        },
        now: 20_000,
        reconciliationWindowMs: 15_000,
      }),
    ).toEqual({
      signature: "",
      clearStoredDraft: true,
    });
  });
});
