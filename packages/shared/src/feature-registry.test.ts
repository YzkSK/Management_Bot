import { describe, expect, test } from "bun:test";
import { FEATURE_KEYS, FEATURE_METADATA } from "./feature-registry.ts";

describe("FEATURE_METADATA", () => {
  test("FEATURE_KEYSと1対1で対応する", () => {
    expect(FEATURE_METADATA.map((f) => f.key).sort()).toEqual([...FEATURE_KEYS].sort());
  });

  test("keyが重複しない", () => {
    const keys = FEATURE_METADATA.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("各featureがview/manage capabilityを持つ", () => {
    for (const feature of FEATURE_METADATA) {
      expect(feature.viewCapability).toBeGreaterThan(0);
      expect(feature.manageCapability).toBeGreaterThan(0);
    }
  });
});
