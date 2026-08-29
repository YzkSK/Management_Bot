import { describe, expect, test } from "bun:test";
import { ALL_CAPABILITIES, BASELINE_EVERYONE_CAPABILITIES, canGrantCapabilities, CAPABILITIES } from "./capabilities.ts";

describe("canGrantCapabilities", () => {
  test("付与者が持つcapabilityの部分集合は付与できる", () => {
    const granter = CAPABILITIES.VIEW_LOGS | CAPABILITIES.MANAGE_LOGGING_SETTINGS;
    expect(canGrantCapabilities(granter, CAPABILITIES.VIEW_LOGS)).toBe(true);
  });

  test("付与者が持たないcapabilityへの昇格は拒否する", () => {
    const granter = CAPABILITIES.VIEW_LOGS;
    expect(canGrantCapabilities(granter, CAPABILITIES.MANAGE_ACCESS)).toBe(false);
  });

  test("ALL_CAPABILITIESを持つ付与者は何でも付与できる", () => {
    expect(canGrantCapabilities(ALL_CAPABILITIES, CAPABILITIES.MANAGE_ACCESS)).toBe(true);
  });

  test("未定義ビットを含む値は拒否する", () => {
    expect(canGrantCapabilities(ALL_CAPABILITIES, 1 << 20)).toBe(false);
  });

  test("負数は拒否する", () => {
    expect(canGrantCapabilities(-1, CAPABILITIES.VIEW_LOGS)).toBe(false);
  });
});

describe("BASELINE_EVERYONE_CAPABILITIES", () => {
  test("ALL_CAPABILITIESの部分集合である", () => {
    expect((BASELINE_EVERYONE_CAPABILITIES & ~ALL_CAPABILITIES) === 0).toBe(true);
  });
});
