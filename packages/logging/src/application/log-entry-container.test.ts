import { describe, expect, test } from "bun:test";
import type { LogEntry } from "../domain/index.js";
import { buildLogEntryContainer } from "./log-entry-container.js";
import { ACCENT_COLORS } from "./log-entry-presentation.js";

function textOf(container: ReturnType<typeof buildLogEntryContainer>): string {
  return container
    .toJSON()
    .components.filter((c): c is { type: 10; content: string } => c.type === 10)
    .map((c) => c.content)
    .join("\n---\n");
}

describe("buildLogEntryContainer", () => {
  test("member/joinはpositiveアクセントでタイトル・説明文を含む", () => {
    const entry: LogEntry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      userId: "u1",
      userName: "たろう",
      action: "join",
    };
    const container = buildLogEntryContainer(entry);
    expect(container.toJSON().accent_color).toBe(ACCENT_COLORS.positive);
    const text = textOf(container);
    expect(text).toContain("ユーザーが参加しました");
    expect(text).toContain("たろう がサーバーに参加しました");
  });

  test("member/join かつ isRejoin=trueなら再入室の警告行を含む", () => {
    const entry: LogEntry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      userId: "u1",
      action: "join",
      isRejoin: true,
    };
    expect(textOf(buildLogEntryContainer(entry))).toContain("再入室");
  });

  test("member/join かつ hasModerationHistory=trueならモデレーション履歴の警告行を含む", () => {
    const entry: LogEntry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      userId: "u1",
      action: "join",
      hasModerationHistory: true,
    };
    expect(textOf(buildLogEntryContainer(entry))).toContain("モデレーション対応");
  });

  test("警告フラグがfalse/undefinedなら警告行を含まない", () => {
    const entry: LogEntry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      userId: "u1",
      action: "join",
    };
    const text = textOf(buildLogEntryContainer(entry));
    expect(text).not.toContain("再入室");
    expect(text).not.toContain("モデレーション対応");
  });

  test("member/leaveはnegativeアクセントになる", () => {
    const entry: LogEntry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      userId: "u1",
      action: "leave",
    };
    expect(buildLogEntryContainer(entry).toJSON().accent_color).toBe(ACCENT_COLORS.negative);
  });

  test("message/deleteは本文を引用ブロックで含む", () => {
    const entry: LogEntry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      channelId: "c1",
      authorId: "u1",
      action: "delete",
      content: "こんにちは",
    };
    const text = textOf(buildLogEntryContainer(entry));
    expect(text).toContain("> こんにちは");
  });

  test("message/deleteの添付ファイルはリンク一覧として含む", () => {
    const entry: LogEntry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      channelId: "c1",
      authorId: "u1",
      action: "delete",
      attachments: [{ url: "https://cdn.example.com/a.png", filename: "a.png" }],
    };
    const text = textOf(buildLogEntryContainer(entry));
    expect(text).toContain("[a.png](https://cdn.example.com/a.png)");
  });

  test("role/updateのpermissions変更は剥奪を−、付与を+で列挙する", () => {
    const entry: LogEntry = {
      category: "role",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      roleId: "r1",
      action: "update",
      changes: { permissions: { before: "0", after: (1n << 5n).toString() } },
    };
    const text = textOf(buildLogEntryContainer(entry));
    expect(text).toContain("+サーバーの管理");
  });

  test("role/updateの色変更はbefore→after形式で表示する", () => {
    const entry: LogEntry = {
      category: "role",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      roleId: "r1",
      action: "update",
      changes: { color: { before: 16711680, after: 65280 } },
    };
    const text = textOf(buildLogEntryContainer(entry));
    expect(text).toContain("**色**: −16711680 → +65280");
  });

  test("本文が4000文字を超える場合は切り詰めて上限内に収める(TextDisplayの上限4000文字対応)", () => {
    const entry: LogEntry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      channelId: "c1",
      authorId: "u1",
      action: "delete",
      content: "x".repeat(5_000),
    };
    const container = buildLogEntryContainer(entry);
    for (const component of container.toJSON().components) {
      if (component.type === 10) {
        expect(component.content.length).toBeLessThanOrEqual(4_000);
      }
    }
    const text = textOf(container);
    expect(text).toContain("(省略)");
  });

  test("改行を大量に含む長文でも切り詰め後に上限を超えない", () => {
    const entry: LogEntry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      channelId: "c1",
      authorId: "u1",
      action: "delete",
      content: "line\n".repeat(2_000),
    };
    const container = buildLogEntryContainer(entry);
    for (const component of container.toJSON().components) {
      if (component.type === 10) {
        expect(component.content.length).toBeLessThanOrEqual(4_000);
      }
    }
  });

  test("auditLogCorrelationはneutralアクセントかつフォールバックタイトルにならない(専用扱い)", () => {
    const entry: LogEntry = {
      category: "auditLogCorrelation",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      auditLogEntryId: "a1",
      actionType: "ChannelDelete",
    };
    expect(buildLogEntryContainer(entry).toJSON().accent_color).toBe(ACCENT_COLORS.neutral);
  });
});
