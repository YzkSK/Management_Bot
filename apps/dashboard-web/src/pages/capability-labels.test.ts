import { describe, expect, test } from "bun:test";
import { ALL_CAPABILITIES, CAPABILITIES } from "@management-bot/shared";
import { CAPABILITY_GROUPS, CAPABILITY_OPTIONS, CAPABILITY_PRESETS, presetLabelFor } from "./capability-labels.js";

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

describe("presetLabelFor(#505)", () => {
  test("プリセットと完全一致すればそのプリセット名を返す", () => {
    for (const preset of CAPABILITY_PRESETS) {
      expect(presetLabelFor(preset.capabilities)).toBe(preset.label);
    }
  });

  test("どのプリセットとも一致しなければカスタムを返す", () => {
    const moderator = CAPABILITY_PRESETS.find((p) => p.label === "モデレーター")?.capabilities ?? 0;
    expect(presetLabelFor(moderator | CAPABILITIES.VIEW_LOGS_RAW)).toBe("カスタム");
  });

  test("権限が1つもなければ権限なしを返す", () => {
    expect(presetLabelFor(0)).toBe("権限なし");
  });
});
