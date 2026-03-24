import { describe, expect, it } from "vitest";
import {
  buildSignature,
  hasSameEmailConfig,
  resolveSignature,
} from "../emailConfig";

describe("emailConfig helpers", () => {
  it("builds the default signature from available fields", () => {
    expect(
      buildSignature("Alex Rivera", "Genni", "alex@example.com"),
    ).toBe("Best regards,\nAlex Rivera\nGenni\nalex@example.com");
  });

  it("preserves an explicitly empty saved signature", () => {
    expect(resolveSignature("", "Alex Rivera", "Genni", "alex@example.com")).toBe(
      "",
    );
  });

  it("falls back to a generated signature only when no signature is saved", () => {
    expect(
      resolveSignature(undefined, "Alex Rivera", "Genni", "alex@example.com"),
    ).toBe("Best regards,\nAlex Rivera\nGenni\nalex@example.com");
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
});
