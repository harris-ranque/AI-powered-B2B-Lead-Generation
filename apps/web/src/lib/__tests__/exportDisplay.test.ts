import { describe, expect, it } from "vitest";
import {
  formatExportableResultsLabel,
  resolveDisplayContactCount,
} from "@/lib/exportDisplay";

describe("exportDisplay", () => {
  it("shows simple contact count labels", () => {
    expect(
      formatExportableResultsLabel(
        { exportableContacts: 5, exportableBusinesses: 3 },
        0,
        true,
      ),
    ).toBe("5 contacts");
  });

  it("shows accepted contacts when exportable is still zero", () => {
    const summary = {
      exportableContacts: 0,
      exportableBusinesses: 0,
      acceptedContacts: 3,
      linkedForReenrichment: 32,
    };
    expect(resolveDisplayContactCount(summary, 0)).toBe(3);
    expect(formatExportableResultsLabel(summary, 0, true)).toBe("3 contacts");
  });

  it("does not show re-queue boilerplate when count is zero", () => {
    const summary = {
      exportableContacts: 0,
      exportableBusinesses: 0,
      acceptedContacts: 0,
      linkedForReenrichment: 32,
    };
    expect(formatExportableResultsLabel(summary, 0, true)).toBe("0 contacts");
  });
});
