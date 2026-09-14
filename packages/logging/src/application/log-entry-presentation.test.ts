import { describe, expect, test } from "bun:test";
import { LOG_ENTRY_SCHEMAS } from "@management-bot/shared";
import { ACCENT_COLORS, getPresentation } from "./log-entry-presentation.js";

/**
 * 各カテゴリのzodスキーマからaction候補を取り出す。z.enum(shape.action.def.entries)と
 * z.discriminatedUnion(voice、各optionのaction.def.values[0]がz.literal値)の両方に対応する。
 */
function actionsOf(category: keyof typeof LOG_ENTRY_SCHEMAS): string[] {
  const schema = LOG_ENTRY_SCHEMAS[category];
  const def = schema.def as {
    shape?: { action: { def: { entries?: Record<string, string> } } };
    options?: { def: { shape: { action: { def: { values: string[] } } } } }[];
  };
  if (def.shape) return Object.values(def.shape.action.def.entries ?? {});
  if (def.options) return def.options.map((option) => option.def.shape.action.def.values[0]!);
  return [];
}

describe("getPresentation", () => {
  test("auditLogCorrelation以外の全カテゴリ×actionでフォールバックにならない", () => {
    for (const category of Object.keys(LOG_ENTRY_SCHEMAS) as (keyof typeof LOG_ENTRY_SCHEMAS)[]) {
      if (category === "auditLogCorrelation") continue;
      for (const action of actionsOf(category)) {
        const presentation = getPresentation({ category, action } as never);
        expect(presentation.title, `${category}/${action}`).not.toBe("ログイベント");
      }
    }
  });

  test("未定義の(category, action)組み合わせはneutralのフォールバックを返す", () => {
    expect(getPresentation({ category: "auditLogCorrelation", action: "correlate" } as never)).toEqual({
      accent: "neutral",
      title: "ログイベント",
    });
  });

  test("ACCENT_COLORSは4分類すべてを持つ", () => {
    expect(Object.keys(ACCENT_COLORS).sort()).toEqual(["negative", "neutral", "positive", "warning"]);
  });
});
