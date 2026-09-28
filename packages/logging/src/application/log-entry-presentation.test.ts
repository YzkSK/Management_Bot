import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LOG_ENTRY_SCHEMAS, MODERATION_ACTION_TYPES, VOICE_STATE_FLAG_NAMES, setAppEmojis } from "@management-bot/shared";
import { ACCENT_COLORS, appEmojiNameFor, getPresentation } from "./log-entry-presentation.js";

/**
 * 各カテゴリのzodスキーマからaction候補を取り出す。z.enum(shape.action.def.entries)と
 * z.discriminatedUnion(voice、各optionのaction.def.values[0]がz.literal値)の両方に対応する。
 */
function actionsOf(category: keyof typeof LOG_ENTRY_SCHEMAS): string[] {
  const schema = LOG_ENTRY_SCHEMAS[category];
  const def = schema.def as {
    shape?: { action: { def: { entries?: Record<string, string> } } };
    options?: { def: { shape: { action: { def: { entries?: Record<string, string>; values?: string[] } } } } }[];
  };
  if (def.shape) return Object.values(def.shape.action.def.entries ?? {});
  if (def.options) {
    return def.options.flatMap((option) => {
      const actionDef = option.def.shape.action.def;
      return Object.values(actionDef.entries ?? actionDef.values ?? []);
    });
  }
  return [];
}

describe("getPresentation", () => {
  test("auditLogCorrelation以外の全カテゴリ×actionでフォールバックにならず、個別のiconを持つ", () => {
    for (const category of Object.keys(LOG_ENTRY_SCHEMAS) as (keyof typeof LOG_ENTRY_SCHEMAS)[]) {
      if (category === "auditLogCorrelation") continue;
      for (const action of actionsOf(category)) {
        const entry =
          category === "moderationCase" && action === "resolve"
            ? { category, action, result: "success" }
            : category === "voice" && action === "update"
              ? { category, action, changes: { streaming: { before: false, after: true } } }
              : { category, action };
        const presentation = getPresentation(entry as never);
        expect(presentation.title, `${category}/${action}`).not.toBe("ログイベント");
        expect(presentation.icon, `${category}/${action}`).not.toBe("ℹ️");
      }
    }
  });

  test("未定義の(category, action)組み合わせはneutralのフォールバックを返す", () => {
    expect(getPresentation({ category: "auditLogCorrelation", action: "correlate" } as never)).toEqual({
      accent: "neutral",
      title: "ログイベント",
      icon: "ℹ️",
    });
  });

  test("ACCENT_COLORSは4分類すべてを持つ", () => {
    expect(Object.keys(ACCENT_COLORS).sort()).toEqual(["negative", "neutral", "positive", "warning"]);
  });
});

describe("appEmojiNameFor", () => {
  const emojiDir = fileURLToPath(new URL("../../../../assets/emojis", import.meta.url));

  /** 全カテゴリ×action、およびフィールドで絵文字を出し分けるバリアントを列挙する。 */
  function allEntries(): object[] {
    // フィールドで出し分けるactionはcategory+actionだけでは名前が決まらないため、下で個別に列挙する。
    const fieldDependent = new Set(["moderationCase/create", "moderationCase/resolve", "voice/update", "tempVoice/permissionChanged", "tempVoice/ownerTransferred", "tempVoice/memberPermissionChanged"]);
    const entries: object[] = [{ category: "auditLogCorrelation", action: "correlate" }];
    for (const category of Object.keys(LOG_ENTRY_SCHEMAS) as (keyof typeof LOG_ENTRY_SCHEMAS)[]) {
      if (category === "auditLogCorrelation") continue;
      for (const action of actionsOf(category)) {
        if (!fieldDependent.has(`${category}/${action}`)) entries.push({ category, action });
      }
    }
    for (const actionType of MODERATION_ACTION_TYPES) entries.push({ category: "moderationCase", action: "create", actionType });
    for (const result of ["success", "failed", "skipped"]) entries.push({ category: "moderationCase", action: "resolve", result });
    for (const flag of VOICE_STATE_FLAG_NAMES) {
      entries.push({ category: "voice", action: "update", changes: { [flag]: { before: false, after: true } } });
    }
    for (const permission of ["connect", "view"]) entries.push({ category: "tempVoice", action: "permissionChanged", permission });
    for (const trigger of ["manual", "autoGraceExpired"]) entries.push({ category: "tempVoice", action: "ownerTransferred", trigger });
    for (const targetType of ["user", "role"]) {
      for (const state of ["allow", "deny", "cleared"]) {
        entries.push({ category: "tempVoice", action: "memberPermissionChanged", targetType, state });
      }
    }
    return entries;
  }

  test("全ログ種別の絵文字名がassets/emojis/に存在する", () => {
    for (const entry of allEntries()) {
      const name = appEmojiNameFor(entry as never);
      expect(existsSync(`${emojiDir}/${name}.png`), `${JSON.stringify(entry)} -> ${name}`).toBe(true);
    }
  });

  test("selfDeafとselfMuteが同時に変化した場合はvoice_self_deaf、複数フラグならvoice_update", () => {
    const flag = { before: false, after: true };
    expect(appEmojiNameFor({ category: "voice", action: "update", changes: { selfMute: flag, selfDeaf: flag } } as never)).toBe("voice_self_deaf");
    expect(appEmojiNameFor({ category: "voice", action: "update", changes: { selfMute: flag, streaming: flag } } as never)).toBe("voice_update");
  });

  test("アプリ絵文字が登録済みならそれを、未登録ならUnicode絵文字を使う", () => {
    const entry = { category: "message", action: "pin" } as never;
    try {
      setAppEmojis([{ id: "1", name: "message_pin", animated: false }]);
      expect(getPresentation(entry).icon).toBe("<:message_pin:1>");
      expect(getPresentation({ category: "message", action: "unpin" } as never).icon).toBe("📌");
    } finally {
      setAppEmojis([]);
    }
  });
});
