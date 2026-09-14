import { describe, expect, test } from "bun:test";
import { ALL_CAPABILITIES, CAPABILITIES } from "@management-bot/shared";
import { CAPABILITY_GROUPS, CAPABILITY_OPTIONS } from "./capability-labels.js";

describe("CAPABILITY_OPTIONS", () => {
  test("CAPABILITIESの全キーを含む", () => {
    expect(CAPABILITY_OPTIONS).toHaveLength(Object.keys(CAPABILITIES).length);
  });

  test("bitの論理和はALL_CAPABILITIESと一致する", () => {
    const combined = CAPABILITY_OPTIONS.reduce((acc, option) => acc | option.bit, 0);
    expect(combined).toBe(ALL_CAPABILITIES);
  });

  test("各optionのbitはCAPABILITIES[value]と一致する", () => {
    for (const option of CAPABILITY_OPTIONS) {
      expect(option.bit).toBe(CAPABILITIES[option.value]);
    }
  });
});

describe("CAPABILITY_GROUPS", () => {
  test("全capabilityがちょうど1つの表示グループに属する(新規capability追加時に編集UIから漏れることを防ぐ)", () => {
    const grouped = CAPABILITY_GROUPS.flatMap((group) => group.items);

    expect(new Set(grouped)).toEqual(new Set(Object.keys(CAPABILITIES)));
    expect(grouped).toHaveLength(Object.keys(CAPABILITIES).length);
  });
});
