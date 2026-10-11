import { describe, expect, test } from "bun:test";
import { ApplicationCommandOptionType } from "discord.js";
import {
  cancelButtonCustomId,
  editButtonCustomId,
  editModalCustomId,
  isScheduledPostCustomId,
  parseCancelButtonCustomId,
  parseEditButtonCustomId,
  parseEditModalCustomId,
  parseSelectedPostId,
} from "./custom-ids.js";
import { SCHEDULE_COMMAND } from "./schedule-command.js";

const id = "0b0e2f5e-3f5b-4f55-9d0e-5f4d3c2b1a09";

describe("custom ids", () => {
  test("予約IDを含むcustomIdを往復できる", () => {
    expect(parseEditButtonCustomId(editButtonCustomId(id))).toBe(id);
    expect(parseCancelButtonCustomId(cancelButtonCustomId(id))).toBe(id);
    expect(parseEditModalCustomId(editModalCustomId(id))).toBe(id);
  });

  test("不正な値・他種別のcustomIdはnullになる(クライアント入力はzodで検証)", () => {
    expect(parseEditButtonCustomId("scheduled-post:edit:not-a-uuid")).toBeNull();
    expect(parseCancelButtonCustomId(editButtonCustomId(id))).toBeNull();
    expect(parseSelectedPostId([])).toBeNull();
    expect(parseSelectedPostId(["x"])).toBeNull();
    expect(parseSelectedPostId([id])).toBe(id);
    expect(isScheduledPostCustomId("temp-voice:x")).toBe(false);
  });
});

describe("/schedule コマンド定義", () => {
  test("createは引数なし(日時と本文はモーダルで入力)、listも引数なし", () => {
    const subcommands = SCHEDULE_COMMAND.options ?? [];
    expect(subcommands.map((o) => o.name)).toEqual(["create", "list"]);
    for (const sub of subcommands) {
      expect(sub.type).toBe(ApplicationCommandOptionType.Subcommand);
      expect("options" in sub ? (sub.options ?? []) : []).toHaveLength(0);
    }
  });
});
