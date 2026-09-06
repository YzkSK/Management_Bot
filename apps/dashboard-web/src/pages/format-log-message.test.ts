import { describe, expect, test } from "bun:test";
import { formatLogMessage } from "./format-log-message.js";
import { summarizeLogEntry } from "./log-entry-summary.js";
import type { LogEntry } from "@management-bot/shared";

const noNames = { users: {}, channels: {} };

describe("formatLogMessage", () => {
  test("メッセージ削除(自分で削除): 実行者=投稿者", () => {
    const entry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      channelId: "c1",
      authorId: "u1",
      action: "delete",
      content: "ああああ",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, {
      users: { u1: "Yuzuki" },
      channels: { c1: "ログ-推奨" },
    });

    expect(message).toBe("Yuzuki が自分のメッセージを削除しました");
  });

  test("メッセージ削除(第三者が削除): 実行者=モデレーター", () => {
    const entry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      channelId: "c1",
      authorId: "u1",
      executorId: "mod1",
      action: "delete",
      content: "spam",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, {
      users: { u1: "Yuzuki", mod1: "Admin" },
      channels: {},
    });

    expect(message).toBe("Admin が Yuzuki のメッセージを削除しました");
  });

  test("メッセージ投稿", () => {
    const entry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      channelId: "c1",
      authorId: "u1",
      action: "create",
      content: "こんにちは",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { u1: "Yuzuki" }, channels: {} });

    expect(message).toBe("Yuzuki がメッセージを投稿しました");
  });

  test("メッセージ編集", () => {
    const entry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      channelId: "c1",
      authorId: "u1",
      action: "update",
      content: "編集後",
      previousContent: "編集前",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { u1: "Yuzuki" }, channels: {} });

    expect(message).toBe("Yuzuki がメッセージを編集しました");
  });

  test("ボイス移動: from/toのチャンネル名を含む", () => {
    const entry = {
      category: "voice",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      userId: "u1",
      channelId: "c2",
      previousChannelId: "c1",
      action: "move",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, {
      users: { u1: "Sora" },
      channels: { c1: "雑談", c2: "ゲーム部屋" },
    });

    expect(message).toBe("Sora が #雑談 から #ゲーム部屋 に移動しました");
  });

  test("ボイス参加", () => {
    const entry = {
      category: "voice",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      userId: "u1",
      channelId: "c1",
      action: "join",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { u1: "Sora" }, channels: { c1: "雑談" } });

    expect(message).toBe("Sora が #雑談 に参加しました");
  });

  test("ボイス退出", () => {
    const entry = {
      category: "voice",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      userId: "u1",
      channelId: "c1",
      action: "leave",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { u1: "Sora" }, channels: { c1: "雑談" } });

    expect(message).toBe("Sora が #雑談 から退出しました");
  });

  test("メンバー参加", () => {
    const entry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      userId: "u1",
      action: "join",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { u1: "Rin" }, channels: {} });

    expect(message).toBe("Rin がサーバーに参加しました");
  });

  test("メンバータイムアウト: 実行者があれば含める", () => {
    const entry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      userId: "u1",
      executorId: "mod1",
      action: "timeout",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, {
      users: { u1: "Nao", mod1: "Moderator_Bot" },
      channels: {},
    });

    expect(message).toBe("Moderator_Bot が Nao をタイムアウトしました");
  });

  test("名前解決できないIDはIDのままフォールバックする", () => {
    const entry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      userId: "u1",
      action: "leave",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, noNames);

    expect(message).toBe("u1 がサーバーから退出しました");
  });

  test("リアクション追加", () => {
    const entry = {
      category: "reaction",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      channelId: "c1",
      messageId: "m1",
      userId: "u1",
      emoji: "👍",
      action: "add",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { u1: "Yuzuki" }, channels: {} });

    expect(message).toBe("Yuzuki が 👍 でリアクションしました");
  });

  test("リアクション削除", () => {
    const entry = {
      category: "reaction",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      channelId: "c1",
      messageId: "m1",
      userId: "u1",
      emoji: "👍",
      action: "remove",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { u1: "Yuzuki" }, channels: {} });

    expect(message).toBe("Yuzuki が 👍 のリアクションを外しました");
  });

  test("スレッド作成", () => {
    const entry = {
      category: "thread",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      threadId: "t1",
      channelId: "c1",
      executorId: "mod1",
      action: "create",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { mod1: "Admin" }, channels: {} });

    expect(message).toBe("Admin がスレッドを作成しました");
  });

  test("スレッド更新", () => {
    const entry = {
      category: "thread",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      threadId: "t1",
      channelId: "c1",
      executorId: "mod1",
      action: "update",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { mod1: "Admin" }, channels: {} });

    expect(message).toBe("Admin がスレッドを更新しました");
  });

  test("スレッド削除", () => {
    const entry = {
      category: "thread",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      threadId: "t1",
      channelId: "c1",
      executorId: "mod1",
      action: "delete",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { mod1: "Admin" }, channels: {} });

    expect(message).toBe("Admin がスレッドを削除しました");
  });

  test("スレッドアーカイブ", () => {
    const entry = {
      category: "thread",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      threadId: "t1",
      channelId: "c1",
      executorId: "mod1",
      action: "archive",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { mod1: "Admin" }, channels: {} });

    expect(message).toBe("Admin がスレッドをアーカイブしました");
  });

  test("スレッドアーカイブ解除", () => {
    const entry = {
      category: "thread",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      threadId: "t1",
      channelId: "c1",
      executorId: "mod1",
      action: "unarchive",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { mod1: "Admin" }, channels: {} });

    expect(message).toBe("Admin がスレッドのアーカイブを解除しました");
  });

  test("スレッドメンバー追加", () => {
    const entry = {
      category: "thread",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      threadId: "t1",
      channelId: "c1",
      executorId: "mod1",
      userId: "u1",
      action: "memberAdd",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, {
      users: { mod1: "Admin", u1: "Yuzuki" },
      channels: {},
    });

    expect(message).toBe("Admin が Yuzuki をスレッドに追加しました");
  });

  test("スレッドメンバー追加(実行者未相関): 対象者自身の参加として表示する", () => {
    const entry = {
      category: "thread",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      threadId: "t1",
      channelId: "c1",
      userId: "u1",
      action: "memberAdd",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { u1: "Yuzuki" }, channels: {} });

    expect(message).toBe("Yuzuki がスレッドに参加しました");
  });

  test("スレッドメンバー削除(実行者未相関): 対象者自身の退出として表示する", () => {
    const entry = {
      category: "thread",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      threadId: "t1",
      channelId: "c1",
      userId: "u1",
      action: "memberRemove",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { u1: "Yuzuki" }, channels: {} });

    expect(message).toBe("Yuzuki がスレッドから退出しました");
  });

  test("未対応の組み合わせは汎用フォールバック文言になる", () => {
    const entry = {
      category: "guild",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      action: "update",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, noNames);

    expect(message).toBe("サーバー設定が更新されました");
  });

  test("招待リンク作成", () => {
    const entry = {
      category: "invite",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      code: "abc123",
      channelId: "c1",
      executorId: "mod1",
      action: "create",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, {
      users: { mod1: "Admin" },
      channels: { c1: "招待用" },
    });

    expect(message).toBe("Admin が #招待用 の招待リンクを作成しました");
  });

  test("招待リンク削除", () => {
    const entry = {
      category: "invite",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      code: "abc123",
      channelId: "c1",
      executorId: "mod1",
      action: "delete",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { mod1: "Admin" }, channels: {} });

    expect(message).toBe("Admin が招待リンクを削除しました");
  });

  test("招待リンク作成(実行者未相関): 不明なユーザーにフォールバックする", () => {
    const entry = {
      category: "invite",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      code: "abc123",
      channelId: "c1",
      action: "create",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, noNames);

    expect(message).toBe("不明なユーザー が #c1 の招待リンクを作成しました");
  });

  test("絵文字追加", () => {
    const entry = {
      category: "emoji",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      emojiId: "e1",
      executorId: "mod1",
      action: "create",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { mod1: "Admin" }, channels: {} });

    expect(message).toBe("Admin が絵文字を追加しました");
  });

  test("絵文字更新", () => {
    const entry = {
      category: "emoji",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      emojiId: "e1",
      executorId: "mod1",
      action: "update",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { mod1: "Admin" }, channels: {} });

    expect(message).toBe("Admin が絵文字を更新しました");
  });

  test("絵文字削除(実行者未相関)", () => {
    const entry = {
      category: "emoji",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      emojiId: "e1",
      action: "delete",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, noNames);

    expect(message).toBe("不明なユーザー が絵文字を削除しました");
  });

  test("スタンプ追加", () => {
    const entry = {
      category: "sticker",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      stickerId: "s1",
      executorId: "mod1",
      action: "create",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { mod1: "Admin" }, channels: {} });

    expect(message).toBe("Admin がスタンプを追加しました");
  });

  test("スタンプ更新", () => {
    const entry = {
      category: "sticker",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      stickerId: "s1",
      executorId: "mod1",
      action: "update",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { mod1: "Admin" }, channels: {} });

    expect(message).toBe("Admin がスタンプを更新しました");
  });

  test("スタンプ削除(実行者未相関)", () => {
    const entry = {
      category: "sticker",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      stickerId: "s1",
      action: "delete",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, noNames);

    expect(message).toBe("不明なユーザー がスタンプを削除しました");
  });

  test("AutoModルール作成", () => {
    const entry = {
      category: "autoMod",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      ruleId: "r1",
      userId: "u1",
      executorId: "mod1",
      action: "ruleCreate",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { mod1: "Admin" }, channels: {} });

    expect(message).toBe("Admin がAutoModルールを作成しました");
  });

  test("AutoModルール作成(実行者未相関): 不明なユーザーにフォールバックする", () => {
    const entry = {
      category: "autoMod",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      ruleId: "r1",
      userId: "u1",
      action: "ruleCreate",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { u1: "Yuzuki" }, channels: {} });

    expect(message).toBe("不明なユーザー がAutoModルールを作成しました");
  });

  test("AutoMod作動", () => {
    const entry = {
      category: "autoMod",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      ruleId: "r1",
      userId: "u1",
      action: "actionExecuted",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { u1: "Yuzuki" }, channels: {} });

    expect(message).toBe("Yuzuki の発言に対してAutoModが作動しました");
  });

  test("actionを持たないカテゴリ(auditLogCorrelation)は「更新」にフォールバックする", () => {
    const entry = {
      category: "auditLogCorrelation",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      auditLogEntryId: "a1",
      actionType: "MEMBER_UPDATE",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, noNames);

    expect(message).toBe("監査ログ相関: 更新");
  });
});
