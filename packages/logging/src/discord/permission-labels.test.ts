import { describe, expect, test } from "bun:test";
import { PermissionFlagsBits } from "discord.js";
import { DISCORD_PERMISSION_LABELS } from "@management-bot/shared";

/**
 * DISCORD_PERMISSION_LABELS(dashboard-web表示用、discord.js非依存)のkeyが
 * discord.jsのPermissionFlagsBitsと同期していることを検証する。dashboard-webは
 * discord.jsを持ち込めないためkey名のみ手動管理しており、Discordに新しい権限が
 * 追加された際の追記漏れをここで検知する(issue #225)。
 */
describe("DISCORD_PERMISSION_LABELS", () => {
  test("すべてのkeyがPermissionFlagsBitsの既知のキーと一致し、bitの値も一致する", () => {
    for (const { key, bit } of DISCORD_PERMISSION_LABELS) {
      const actual = PermissionFlagsBits[key as keyof typeof PermissionFlagsBits];
      expect(actual).toBeDefined();
      expect(bit).toBe(actual);
    }
  });

  test("PermissionFlagsBitsの全ビット値がDISCORD_PERMISSION_LABELSでカバーされる(追記漏れ検知)", () => {
    // ManageEmojisAndStickers/ManageGuildExpressionsのように同一ビット値へのエイリアスが
    // discord.js側に存在するため、キー名ではなくビット値の集合で比較する。
    const labeledBits = new Set(DISCORD_PERMISSION_LABELS.map(({ bit }) => bit));
    const missingBits = Object.entries(PermissionFlagsBits)
      .filter(([, bit]) => !labeledBits.has(bit))
      .map(([key]) => key);
    expect(missingBits).toEqual([]);
  });

  test("keyの重複がない", () => {
    const keys = DISCORD_PERMISSION_LABELS.map(({ key }) => key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
