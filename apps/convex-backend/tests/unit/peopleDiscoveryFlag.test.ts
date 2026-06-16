import { describe, expect, it, afterEach } from "vitest";
import { isPeopleDiscoveryEnabled } from "../../convex/lib/featureFlags";

describe("isPeopleDiscoveryEnabled", () => {
  const original = process.env.PEOPLE_DISCOVERY_ENABLED;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PEOPLE_DISCOVERY_ENABLED;
    } else {
      process.env.PEOPLE_DISCOVERY_ENABLED = original;
    }
  });

  it("is true by default", () => {
    delete process.env.PEOPLE_DISCOVERY_ENABLED;
    expect(isPeopleDiscoveryEnabled()).toBe(true);
  });

  it("is true when env flag is explicitly true", () => {
    process.env.PEOPLE_DISCOVERY_ENABLED = "true";
    expect(isPeopleDiscoveryEnabled()).toBe(true);
  });

  it("is false only when env flag is explicitly false", () => {
    process.env.PEOPLE_DISCOVERY_ENABLED = "false";
    expect(isPeopleDiscoveryEnabled()).toBe(false);
  });
});
