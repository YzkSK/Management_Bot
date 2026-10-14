import { describe, expect, test } from "bun:test";
import { DISCORD_PERMISSION_LABELS } from "@management-bot/shared";
import { PERMISSION_ICONS } from "./permission-icons.js";

describe("PERMISSION_ICONS", () => {
  test("DISCORD_PERMISSION_LABELSの全権限にアイコンが登録されている(追加漏れの検知)", () => {
    const missing = DISCORD_PERMISSION_LABELS.filter(({ key }) => PERMISSION_ICONS[key] === undefined).map(({ key }) => key);
    expect(missing).toEqual([]);
  });
});
