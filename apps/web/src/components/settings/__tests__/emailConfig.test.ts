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
      signatureEnabled: true,
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
        savedSignatureEnabled: true,
        draft: {
          value: "",
          signatureEnabled: false,
          mode: "dirty",
          updatedAt: 1_000,
        },
        now: 2_000,
        reconciliationWindowMs: 15_000,
      }),
    ).toEqual({
      signature: "",
      signatureEnabled: false,
      clearStoredDraft: false,
    });
  });

  it("keeps a recently saved draft during backend reconciliation", () => {
    expect(
      resolveInitialEmailSignature({
        savedSignature: "Old signature",
        savedSignatureEnabled: true,
        draft: {
          value: "",
          signatureEnabled: false,
          mode: "saved",
          updatedAt: 10_000,
        },
        now: 20_000,
        reconciliationWindowMs: 15_000,
      }),
    ).toEqual({
      signature: "",
      signatureEnabled: false,
      clearStoredDraft: false,
    });
  });

  it("clears a saved draft once the backend matches it", () => {
    expect(
      resolveInitialEmailSignature({
        savedSignature: "",
        savedSignatureEnabled: false,
        draft: {
          value: "",
          signatureEnabled: false,
          mode: "saved",
          updatedAt: 10_000,
        },
        now: 20_000,
        reconciliationWindowMs: 15_000,
      }),
    ).toEqual({
      signature: "",
      signatureEnabled: false,
      clearStoredDraft: true,
    });
  });

  it("keeps a recently saved toggle draft during backend reconciliation", () => {
    expect(
      resolveInitialEmailSignature({
        savedSignature: "Best regards,\nAlex Rivera",
        savedSignatureEnabled: true,
        draft: {
          value: "Best regards,\nAlex Rivera",
          signatureEnabled: false,
          mode: "saved",
          updatedAt: 10_000,
        },
        now: 20_000,
        reconciliationWindowMs: 15_000,
      }),
    ).toEqual({
      signature: "Best regards,\nAlex Rivera",
      signatureEnabled: false,
      clearStoredDraft: false,
    });
  });
});
