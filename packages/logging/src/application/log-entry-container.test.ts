import { describe, expect, test } from "bun:test";
import type { LogEntry } from "../domain/index.js";
import { buildLogEntryContainers } from "./log-entry-container.js";
import { ACCENT_COLORS } from "./log-entry-presentation.js";

interface TextDisplayJSON {
  type: 10;
  content: string;
}

type ContainerJSON = ReturnType<ReturnType<typeof buildLogEntryContainers>[number]["toJSON"]>;

/** TextDisplayはContainer直下だけでなくSection(アバター付きヘッダー)の中にも入り得るため、両方から集める。 */
function textOf(containers: ReturnType<typeof buildLogEntryContainers>): string {
  const texts: string[] = [];
  for (const container of containers) {
    for (const component of container.toJSON().components) {
      if (component.type === 10) {
        texts.push((component as TextDisplayJSON).content);
      } else if (component.type === 9) {
        const section = component as { components: TextDisplayJSON[] };
        texts.push(...section.components.map((c) => c.content));
      }
    }
  }
  return texts.join("\n---\n");
}

function allTextDisplayContents(containers: ReturnType<typeof buildLogEntryContainers>): string[] {
  const contents: string[] = [];
  for (const container of containers) {
    for (const component of container.toJSON().components) {
      if (component.type === 10) contents.push((component as TextDisplayJSON).content);
      else if (component.type === 9) {
        contents.push(...(component as { components: TextDisplayJSON[] }).components.map((c) => c.content));
      }
    }
  }
  return contents;
}

function mainContainerOf(containers: ReturnType<typeof buildLogEntryContainers>): ContainerJSON {
  return containers[0]!.toJSON();
}

describe("buildLogEntryContainers", () => {
  test("member/joinはメインContainerがpositiveアクセントでタイトル・説明文を含む", () => {
    const entry: LogEntry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      userId: "u1",
      userName: "たろう",
      action: "join",
    };
    const containers = buildLogEntryContainers(entry);
    expect(mainContainerOf(containers).accent_color).toBe(ACCENT_COLORS.positive);
    const text = textOf(containers);
    expect(text).toContain("ユーザーが参加しました");
    expect(text).toContain("<@u1> がサーバーに参加しました");
  });

  test("ヘッダーにentry.createdAtのDiscordタイムスタンプ記法(<t:unix:f>)を含む", () => {
    const entry: LogEntry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-08-31T12:34:56.000Z",
      userId: "u1",
      action: "join",
    };
    const text = textOf(buildLogEntryContainers(entry));
    const expectedUnix = Math.floor(new Date("2026-08-31T12:34:56.000Z").getTime() / 1000);
    expect(text).toContain(`-# <t:${expectedUnix}:f>`);
  });

  test("member/join かつ isRejoin=trueなら赤アクセントの警告Containerを別途追加する", () => {
    const entry: LogEntry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      userId: "u1",
      action: "join",
      isRejoin: true,
    };
    const containers = buildLogEntryContainers(entry);
    expect(containers).toHaveLength(2);
    expect(containers[1]!.toJSON().accent_color).toBe(ACCENT_COLORS.negative);
    expect(textOf(containers)).toContain("再入室");
  });

  test("member/join かつ hasModerationHistory=trueなら警告Containerにモデレーション履歴の文言を含む", () => {
    const entry: LogEntry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      userId: "u1",
      action: "join",
      hasModerationHistory: true,
    };
    const containers = buildLogEntryContainers(entry);
    expect(containers).toHaveLength(2);
    expect(textOf(containers)).toContain("モデレーション対応");
  });

  test("isRejoin/hasModerationHistory両方trueなら1つの警告Containerに両方の文言を含む", () => {
    const entry: LogEntry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      userId: "u1",
      action: "join",
      isRejoin: true,
      hasModerationHistory: true,
    };
    const containers = buildLogEntryContainers(entry);
    expect(containers).toHaveLength(2);
    const text = textOf(containers);
    expect(text).toContain("⚠️ **過去にモデレーション対応(キック/BAN)の履歴があります**");
    expect(text).toContain("🔁 **再入室です**");
  });

  test("警告フラグがfalse/undefinedなら警告Containerを追加しない", () => {
    const entry: LogEntry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      userId: "u1",
      action: "join",
    };
    const containers = buildLogEntryContainers(entry);
    expect(containers).toHaveLength(1);
  });

  test("member/leave等join以外のactionでは警告Containerを作らない", () => {
    const entry: LogEntry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      userId: "u1",
      action: "leave",
    };
    const containers = buildLogEntryContainers(entry);
    expect(containers).toHaveLength(1);
    expect(mainContainerOf(containers).accent_color).toBe(ACCENT_COLORS.negative);
  });

  test("messageカテゴリの説明文はチャンネルメンション(<#channelId>)を含む(どこで発生したか分かるように)", () => {
    const entry: LogEntry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      channelId: "c1",
      authorId: "u1",
      action: "create",
      content: "こんにちは",
    };
    const text = textOf(buildLogEntryContainers(entry));
    expect(text).toContain("<#c1>");
    expect(text).toContain("<@u1>");
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
    const text = textOf(buildLogEntryContainers(entry));
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
    const text = textOf(buildLogEntryContainers(entry));
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
    const text = textOf(buildLogEntryContainers(entry));
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
    const text = textOf(buildLogEntryContainers(entry));
    expect(text).toContain("-# 色\n−16711680 → +65280");
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
    const containers = buildLogEntryContainers(entry);
    for (const content of allTextDisplayContents(containers)) {
      expect(content.length).toBeLessThanOrEqual(4_000);
    }
    expect(textOf(containers)).toContain("(省略)");
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
    const containers = buildLogEntryContainers(entry);
    for (const content of allTextDisplayContents(containers)) {
      expect(content.length).toBeLessThanOrEqual(4_000);
    }
  });

  test("タイトルにaction固有の絵文字アイコンを含む", () => {
    const join: LogEntry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      userId: "u1",
      action: "join",
    };
    const ban: LogEntry = { ...join, action: "ban" };
    const kick: LogEntry = { ...join, action: "kick" };
    expect(textOf(buildLogEntryContainers(join))).toContain("### 📥");
    expect(textOf(buildLogEntryContainers(ban))).toContain("### 🔨");
    expect(textOf(buildLogEntryContainers(kick))).toContain("### 👢");
  });

  test("member/joinでavatarUrlがあればSectionのThumbnailアクセサリとして添える", () => {
    const entry: LogEntry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      userId: "u1",
      action: "join",
      avatarUrl: "https://cdn.example.com/avatar.png",
    };
    const components = mainContainerOf(buildLogEntryContainers(entry)).components;
    const section = components.find((c) => c.type === 9) as
      | { type: 9; accessory: { media: { url: string } } }
      | undefined;
    expect(section).toBeDefined();
    expect(section?.accessory.media.url).toBe("https://cdn.example.com/avatar.png");
  });

  test("avatarUrlがなければSectionを使わずTextDisplayのみになる", () => {
    const entry: LogEntry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      userId: "u1",
      action: "join",
    };
    const components = mainContainerOf(buildLogEntryContainers(entry)).components;
    expect(components.some((c) => c.type === 9)).toBe(false);
  });

  test("member/join以外(例: leave)ではavatarUrlがあってもSectionにしない", () => {
    const entry: LogEntry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      userId: "u1",
      action: "leave",
    };
    const components = mainContainerOf(buildLogEntryContainers(entry)).components;
    expect(components.some((c) => c.type === 9)).toBe(false);
  });

  test("member/joinはアカウント作成日・ユーザーIDを同じ行に横並びで含む", () => {
    const entry: LogEntry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      userId: "u1",
      action: "join",
      accountCreatedAt: "2020-01-01T00:00:00.000Z",
    };
    const text = textOf(buildLogEntryContainers(entry));
    expect(text).toContain("-# アカウント作成日　　ユーザーID");
    expect(text).toMatch(/<t:\d+:D>\(\d+日前\)　　u1/);
  });

  test("auditLogCorrelationはneutralアクセントかつフォールバックタイトルにならない(専用扱い)", () => {
    const entry: LogEntry = {
      category: "auditLogCorrelation",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      auditLogEntryId: "a1",
      actionType: "ChannelDelete",
    };
    expect(mainContainerOf(buildLogEntryContainers(entry)).accent_color).toBe(ACCENT_COLORS.neutral);
  });
});
