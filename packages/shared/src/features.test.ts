import { describe, expect, test } from "bun:test";
import { FEATURE_METADATA } from "./features.ts";

describe("FEATURE_METADATA", () => {
  test("各featureがkey/name/descriptionを持つ", () => {
    expect(FEATURE_METADATA.length).toBeGreaterThan(0);
    for (const feature of FEATURE_METADATA) {
      expect(feature.key.length).toBeGreaterThan(0);
      expect(feature.name.length).toBeGreaterThan(0);
      expect(feature.description.length).toBeGreaterThan(0);
    }
  });

  test("keyが重複しない", () => {
    const keys = FEATURE_METADATA.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
