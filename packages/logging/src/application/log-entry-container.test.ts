import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setAppEmojis } from "@management-bot/shared";
import type { LogEntry } from "../domain/index.js";
import { LOG_CARD_APP_EMOJIS, buildBulkDeleteSummaryContainers, buildLogEntryContainers } from "./log-entry-container.js";
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

  test("本文の一番下にentry.createdAtのDiscordタイムスタンプ記法(<t:unix:f>)を含む(ヘッダーより下)", () => {
    const entry: LogEntry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-08-31T12:34:56.000Z",
      channelId: "c1",
      authorId: "u1",
      action: "create",
      content: "こんにちは",
    };
    const expectedUnix = Math.floor(new Date("2026-08-31T12:34:56.000Z").getTime() / 1000);
    const contents = allTextDisplayContents(buildLogEntryContainers(entry));
    const [headerContent, bodyContent] = contents;
    expect(headerContent).not.toContain(`<t:${expectedUnix}:f>`);
    expect(bodyContent).toContain(`-# <t:${expectedUnix}:f>`);
    // 時刻は本文中の他フィールド(本文・changes・添付)より後ろ(末尾)に来る。
    expect(bodyContent?.trimEnd().endsWith(`-# <t:${expectedUnix}:f>`)).toBe(true);
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

  test("GIFリンクのみの投稿は本文URL・添付リンクを省き、プレビューの下に日時を表示する(#528)", () => {
    const entry: LogEntry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      channelId: "c1",
      authorId: "u1",
      action: "create",
      content: "https://klipy.com/gifs/x",
      attachments: [
        {
          url: "https://media.klipy.com/a.mp4",
          filename: "a.mp4",
          contentType: "video/mp4",
          gifv: true,
          sourceUrl: "https://klipy.com/gifs/x",
          previewUrl: "https://media.klipy.com/a.webp",
        },
      ],
    };
    const containers = buildLogEntryContainers(entry);
    const text = textOf(containers);
    expect(text).not.toContain("https://klipy.com/gifs/x");
    expect(text).not.toContain("添付ファイル");
    const types = containers[0]!.toJSON().components.map((c) => c.type);
    expect(types.slice(-2)).toEqual([12, 10]);
    // mp4ではなくアニメーション画像版を表示し、Discord上で自動ループ再生させる。
    expect(JSON.stringify(containers[0]!.toJSON())).toContain('"url":"https://media.klipy.com/a.webp"');
  });

  test("画像・動画の添付はMediaGalleryでプレビュー表示する(#528)", () => {
    const entry: LogEntry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      channelId: "c1",
      authorId: "u1",
      action: "create",
      attachments: [
        { url: "https://media.tenor.com/abc/cat.mp4", filename: "cat.mp4", contentType: "video/mp4" },
        { url: "https://cdn.example.com/SPOILER_a.png", filename: "SPOILER_a.png", contentType: "image/png" },
        { url: "https://cdn.example.com/a.txt", filename: "a.txt", contentType: "text/plain" },
      ],
    };
    const gallery = buildLogEntryContainers(entry)[0]!.toJSON().components.find((c) => c.type === 12);
    expect(gallery).toEqual({
      type: 12,
      items: [
        { media: { url: "https://media.tenor.com/abc/cat.mp4" }, spoiler: false },
        { media: { url: "https://cdn.example.com/SPOILER_a.png" }, spoiler: true },
      ],
    });
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
    expect(text).toContain("```diff\n+サーバーの管理\n```");
  });

  test("role/updateのpermissions変更(剥奪+付与混在)は半角ハイフンの削除行を付与行より先に列挙する", () => {
    const entry: LogEntry = {
      category: "role",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      roleId: "r1",
      action: "update",
      changes: { permissions: { before: (1n << 1n).toString(), after: (1n << 5n).toString() } },
    };
    const text = textOf(buildLogEntryContainers(entry));
    const diffBlock = text.match(/```diff\n([\s\S]*?)\n```/)?.[1];
    expect(diffBlock?.split("\n")).toEqual(["-メンバーをキック", "+サーバーの管理"]);
  });

  test("voice/updateはdescriptionの文章のみでchangesの生の値行を表示しない", () => {
    const entry: LogEntry = {
      category: "voice",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      userId: "u1",
      channelId: "c1",
      action: "update",
      changes: { selfMute: { before: false, after: true } },
    };
    const text = textOf(buildLogEntryContainers(entry));
    expect(text).not.toContain("selfMute");
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

  test("member/joinはアカウント作成日・ユーザーIDのフィールドをそれぞれラベル付きで含む", () => {
    const entry: LogEntry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      userId: "u1",
      action: "join",
      accountCreatedAt: "2020-01-01T00:00:00.000Z",
    };
    const text = textOf(buildLogEntryContainers(entry));
    expect(text).toContain("**アカウント作成日**:");
    expect(text).toMatch(/<t:\d+:D>\(\d+日前\)/);
    expect(text).toContain("**ユーザーID**: u1");
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

describe("buildBulkDeleteSummaryContainers", () => {
  test("赤アクセントの一括削除カードに見出し・件数・チャンネル・時刻を入れる", () => {
    const [container] = buildBulkDeleteSummaryContainers({
      count: 5,
      channelId: "c1",
      createdAt: "2026-09-16T00:50:00.000Z",
    });

    expect(container!.toJSON()).toMatchObject({
      accent_color: 0xf23f42,
      components: expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining("🧹 メッセージが一括削除されました") }),
        expect.objectContaining({ content: expect.stringContaining("5件のメッセージが<#c1>で一括削除されました") }),
        expect.objectContaining({ content: expect.stringContaining("<t:1789519800:f>") }),
      ]),
    });
  });
});

describe("ログカードのアプリ絵文字", () => {
  afterEach(() => setAppEmojis([]));

  const pinEntry: LogEntry = {
    category: "message",
    guildId: "g1",
    createdAt: "2026-08-31T00:00:00.000Z",
    channelId: "c1",
    authorId: "u1",
    messageId: "m1",
    action: "pin",
    executorId: "u9",
  };

  test("使用する絵文字名はすべてassets/emojis/に画像がある", () => {
    for (const { name } of Object.values(LOG_CARD_APP_EMOJIS)) {
      const path = fileURLToPath(new URL(`../../../../assets/emojis/${name}.png`, import.meta.url));
      expect(existsSync(path), name).toBe(true);
    }
  });

  test("実行者が判明していれば実行者行をメンションで表示し、未判明なら表示しない", () => {
    expect(textOf(buildLogEntryContainers(pinEntry))).toContain("**👤 実行者**: <@u9>");
    expect(textOf(buildLogEntryContainers({ ...pinEntry, executorId: undefined }))).not.toContain("実行者**");
  });

  test("アプリ絵文字が登録済みなら各行でそれを使う", () => {
    setAppEmojis(
      Object.values(LOG_CARD_APP_EMOJIS).map(({ name }, i) => ({ id: String(i + 1), name, animated: false })),
    );
    const emoji = (key: keyof typeof LOG_CARD_APP_EMOJIS) => {
      const index = Object.keys(LOG_CARD_APP_EMOJIS).indexOf(key);
      return `<:${LOG_CARD_APP_EMOJIS[key].name}:${index + 1}>`;
    };

    expect(textOf(buildLogEntryContainers(pinEntry))).toContain(`**${emoji("executor")} 実行者**: <@u9>`);

    const deleted: LogEntry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      channelId: "c1",
      authorId: "u1",
      action: "delete",
      attachments: [{ url: "https://cdn.example.com/a.png", filename: "a.png" }],
    };
    expect(textOf(buildLogEntryContainers(deleted))).toContain(`-# ${emoji("attachment")} 添付ファイル`);

    const roleUpdate: LogEntry = {
      category: "role",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      roleId: "r1",
      action: "update",
      changes: { color: { before: 16711680, after: 65280 } },
    };
    expect(textOf(buildLogEntryContainers(roleUpdate))).toContain(`**色**: −16711680 ${emoji("beforeAfter")} +65280`);

    const join: LogEntry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-08-31T00:00:00.000Z",
      userId: "u1",
      action: "join",
      isRejoin: true,
      hasModerationHistory: true,
    };
    const joinText = textOf(buildLogEntryContainers(join));
    expect(joinText).toContain(`${emoji("moderationHistory")} **過去にモデレーション対応(キック/BAN)の履歴があります**`);
    expect(joinText).toContain(`${emoji("rejoin")} **再入室です**`);

    const bulk = buildBulkDeleteSummaryContainers({ count: 3, channelId: "c1", createdAt: "2026-08-31T00:00:00.000Z" });
    expect(JSON.stringify(bulk[0]!.toJSON())).toContain(`### ${emoji("bulkDelete")} メッセージが一括削除されました`);
  });
});

describe("member/joinの新しいアカウント警告・Bot表示", () => {
  const join = (overrides: Partial<Extract<LogEntry, { category: "member" }>>): LogEntry => ({
    category: "member",
    guildId: "g1",
    createdAt: "2026-08-31T00:00:00.000Z",
    userId: "u1",
    action: "join",
    ...overrides,
  });

  test("参加時点でアカウント作成から7日以内なら警告Containerに表示する", () => {
    const containers = buildLogEntryContainers(join({ accountCreatedAt: "2026-08-24T00:00:00.000Z" }));
    expect(containers).toHaveLength(2);
    expect(textOf(containers)).toContain("🔰 **アカウント作成から7日以内です**");
  });

  test("7日を超えていれば警告しない", () => {
    const containers = buildLogEntryContainers(join({ accountCreatedAt: "2026-08-23T23:59:59.000Z" }));
    expect(containers).toHaveLength(1);
    expect(textOf(containers)).not.toContain("7日以内");
  });

  test("作成日時が無ければ警告しない", () => {
    expect(buildLogEntryContainers(join({}))).toHaveLength(1);
  });

  test("Botの参加ならBotアカウント行を表示し、人間なら表示しない", () => {
    expect(textOf(buildLogEntryContainers(join({ actorIsBot: true })))).toContain("🤖 **Botアカウントです**");
    expect(textOf(buildLogEntryContainers(join({ actorIsBot: false })))).not.toContain("Botアカウント");
  });
});
