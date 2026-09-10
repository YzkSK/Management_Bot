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

  test("メッセージ削除(実行者名スナップショットあり): resolveDisplayNamesの結果より優先する", () => {
    const entry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      channelId: "c1",
      authorId: "u1",
      executorId: "mod1",
      executorName: "モデレーター太郎",
      action: "delete",
      content: "spam",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, {
      users: { u1: "Yuzuki", mod1: "古い名前" },
      channels: {},
    });

    expect(message).toBe("モデレーター太郎 が Yuzuki のメッセージを削除しました");
  });

  test("メッセージ削除(投稿者名スナップショットあり): resolveDisplayNamesの結果より優先する", () => {
    const entry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      channelId: "c1",
      authorId: "u1",
      authorName: "退室済みユーザー",
      action: "delete",
      content: "spam",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, {
      users: { u1: "古い名前" },
      channels: {},
    });

    expect(message).toBe("退室済みユーザー が自分のメッセージを削除しました");
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

  test("ボイス退出(モデレーターによる強制切断、実行者判明)", () => {
    const entry = {
      category: "voice",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      userId: "u1",
      executorId: "u2",
      channelId: "c1",
      action: "leave",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { u1: "Sora", u2: "Mod" }, channels: { c1: "雑談" } });

    expect(message).toBe("Mod が Sora を #雑談 から切断させました");
  });

  test("ボイス移動(モデレーターによる強制移動、実行者判明)", () => {
    const entry = {
      category: "voice",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      userId: "u1",
      executorId: "u2",
      channelId: "c2",
      previousChannelId: "c1",
      action: "move",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, {
      users: { u1: "Sora", u2: "Mod" },
      channels: { c1: "雑談", c2: "ゲーム部屋" },
    });

    expect(message).toBe("Mod が Sora を #雑談 から #ゲーム部屋 に移動させました");
  });

  test("ボイス状態変化(ミュート+画面共有)", () => {
    const entry = {
      category: "voice",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      userId: "u1",
      channelId: "c1",
      action: "update",
      changes: {
        selfMute: { before: false, after: true },
        streaming: { before: false, after: true },
      },
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { u1: "Sora" }, channels: {} });

    expect(message).toBe("Sora がミュートしました、画面共有を開始しました");
  });

  test("ボイス状態変化(モデレーターによるサーバーミュート、実行者判明)", () => {
    const entry = {
      category: "voice",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      userId: "u1",
      executorId: "u2",
      channelId: "c1",
      action: "update",
      changes: {
        serverMute: { before: false, after: true },
      },
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { u1: "Sora", u2: "Mod" }, channels: {} });

    expect(message).toBe("Mod が Sora をサーバーミュートしました");
  });

  test("ボイス状態変化(サーバーミュート、実行者未判明)", () => {
    const entry = {
      category: "voice",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      userId: "u1",
      channelId: "c1",
      action: "update",
      changes: {
        serverMute: { before: false, after: true },
      },
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { u1: "Sora" }, channels: {} });

    expect(message).toBe("Sora がサーバーミュートしました");
  });

  test("ボイス状態変化(サーバーミュート+画面共有の混在、モデレーター操作のみexecutorName主語にする)", () => {
    const entry = {
      category: "voice",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      userId: "u1",
      executorId: "u2",
      channelId: "c1",
      action: "update",
      changes: {
        serverMute: { before: false, after: true },
        streaming: { before: false, after: true },
      },
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { u1: "Sora", u2: "Mod" }, channels: {} });

    expect(message).toBe("Mod が Sora をサーバーミュートしました、Sora が画面共有を開始しました");
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

  test("ニックネーム変更(本人): 変更前のニックネームを主語にする", () => {
    const entry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-09-11T00:00:00.000Z",
      userId: "u1",
      userName: "新しいニックネーム",
      executorId: "u1",
      action: "nicknameChange",
      changes: { nickname: { before: "以前のニックネーム", after: "新しいニックネーム" } },
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, noNames);

    expect(message).toBe("以前のニックネーム がニックネームを変更しました");
  });

  test("ニックネーム変更(本人・初回設定): 変更前の表示名を主語にする", () => {
    const entry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-09-11T00:00:00.000Z",
      userId: "u1",
      userName: "新しいニックネーム",
      executorId: "u1",
      action: "nicknameChange",
      previousUserName: "元の表示名",
      changes: { nickname: { before: null, after: "新しいニックネーム" } },
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, noNames);

    expect(message).toBe("元の表示名 がニックネームを変更しました");
  });

  test("ニックネーム変更(本人・既存ログ): 現在の対象名にフォールバックする", () => {
    const entry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-09-11T00:00:00.000Z",
      userId: "u1",
      userName: "現在の表示名",
      executorId: "u1",
      action: "nicknameChange",
      changes: { nickname: { before: null, after: "現在の表示名" } },
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, noNames);

    expect(message).toBe("現在の表示名 がニックネームを変更しました");
  });

  test("ニックネーム変更(他者): 実行者と変更前の対象者名を表示する", () => {
    const entry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-09-11T00:00:00.000Z",
      userId: "u1",
      userName: "対象者",
      executorId: "mod1",
      executorName: "モデレーター",
      action: "nicknameChange",
      changes: { nickname: { before: "以前のニックネーム", after: "対象者" } },
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, noNames);

    expect(message).toBe("モデレーター が 以前のニックネーム のニックネームを変更しました");
  });

  test("ニックネーム変更(他者・初回設定): 元の表示名を対象者名にする", () => {
    const entry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-09-11T00:00:00.000Z",
      userId: "u1",
      userName: "新しいニックネーム",
      previousUserName: "元の表示名",
      executorId: "mod1",
      executorName: "モデレーター",
      action: "nicknameChange",
      changes: { nickname: { before: null, after: "新しいニックネーム" } },
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, noNames);

    expect(message).toBe("モデレーター が 元の表示名 のニックネームを変更しました");
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
      threadName: "質問スレ",
      channelId: "c1",
      executorId: "mod1",
      action: "create",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { mod1: "Admin" }, channels: {} });

    expect(message).toBe("Admin が #質問スレ を作成しました");
  });

  test("スレッド作成(threadName未設定、移行前の既存ログ): チャンネル名解決経由の#threadIdをフォールバック表示する", () => {
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

    expect(message).toBe("Admin が #t1 を作成しました");
  });

  test("スレッド更新", () => {
    const entry = {
      category: "thread",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      threadId: "t1",
      threadName: "質問スレ",
      channelId: "c1",
      executorId: "mod1",
      action: "update",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { mod1: "Admin" }, channels: {} });

    expect(message).toBe("Admin が #質問スレ を更新しました");
  });

  test("スレッド削除", () => {
    const entry = {
      category: "thread",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      threadId: "t1",
      threadName: "質問スレ",
      channelId: "c1",
      executorId: "mod1",
      action: "delete",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { mod1: "Admin" }, channels: {} });

    expect(message).toBe("Admin が #質問スレ を削除しました");
  });

  test("スレッドアーカイブ", () => {
    const entry = {
      category: "thread",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      threadId: "t1",
      threadName: "質問スレ",
      channelId: "c1",
      executorId: "mod1",
      action: "archive",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { mod1: "Admin" }, channels: {} });

    expect(message).toBe("Admin が #質問スレ をアーカイブしました");
  });

  test("スレッドアーカイブ解除", () => {
    const entry = {
      category: "thread",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      threadId: "t1",
      threadName: "質問スレ",
      channelId: "c1",
      executorId: "mod1",
      action: "unarchive",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { mod1: "Admin" }, channels: {} });

    expect(message).toBe("Admin が #質問スレ のアーカイブを解除しました");
  });

  test("スレッドメンバー追加", () => {
    const entry = {
      category: "thread",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      threadId: "t1",
      threadName: "質問スレ",
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

    expect(message).toBe("Admin が Yuzuki を #質問スレ に追加しました");
  });

  test("スレッドメンバー追加(実行者未相関): 対象者自身の参加として表示する", () => {
    const entry = {
      category: "thread",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      threadId: "t1",
      threadName: "質問スレ",
      channelId: "c1",
      userId: "u1",
      action: "memberAdd",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { u1: "Yuzuki" }, channels: {} });

    expect(message).toBe("Yuzuki が #質問スレ に参加しました");
  });

  test("スレッドメンバー削除(実行者未相関): 対象者自身の退出として表示する", () => {
    const entry = {
      category: "thread",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      threadId: "t1",
      threadName: "質問スレ",
      channelId: "c1",
      userId: "u1",
      action: "memberRemove",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { u1: "Yuzuki" }, channels: {} });

    expect(message).toBe("Yuzuki が #質問スレ から退出しました");
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

  test("AutoModルール更新", () => {
    const entry = {
      category: "autoMod",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      ruleId: "r1",
      userId: "u1",
      executorId: "mod1",
      action: "ruleUpdate",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { mod1: "Admin" }, channels: {} });

    expect(message).toBe("Admin がAutoModルールを更新しました");
  });

  test("AutoModルール削除", () => {
    const entry = {
      category: "autoMod",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      ruleId: "r1",
      userId: "u1",
      executorId: "mod1",
      action: "ruleDelete",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { mod1: "Admin" }, channels: {} });

    expect(message).toBe("Admin がAutoModルールを削除しました");
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

  test("連携追加", () => {
    const entry = {
      category: "integration",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      integrationId: "i1",
      executorId: "mod1",
      action: "create",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { mod1: "Admin" }, channels: {} });

    expect(message).toBe("Admin が連携を追加しました");
  });

  test("連携更新", () => {
    const entry = {
      category: "integration",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      integrationId: "i1",
      executorId: "mod1",
      action: "update",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { mod1: "Admin" }, channels: {} });

    expect(message).toBe("Admin が連携を更新しました");
  });

  test("連携削除", () => {
    const entry = {
      category: "integration",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      integrationId: "i1",
      executorId: "mod1",
      action: "delete",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { mod1: "Admin" }, channels: {} });

    expect(message).toBe("Admin が連携を削除しました");
  });

  test("投票作成: 投稿者(executorId)の表示名を実行者として表示する", () => {
    const entry = {
      category: "poll",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      messageId: "m1",
      channelId: "c1",
      executorId: "u1",
      action: "create",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { u1: "Alice" }, channels: { c1: "アンケート" } });

    expect(message).toBe("Alice が #アンケート に投票を作成しました");
  });

  test("投票作成(executorId未設定の過去データ): 不明なユーザーにフォールバックする", () => {
    const entry = {
      category: "poll",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      messageId: "m1",
      channelId: "c1",
      action: "create",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: {}, channels: { c1: "アンケート" } });

    expect(message).toBe("不明なユーザー が #アンケート に投票を作成しました");
  });

  test("投票終了", () => {
    const entry = {
      category: "poll",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      messageId: "m1",
      channelId: "c1",
      action: "end",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: {}, channels: { c1: "アンケート" } });

    expect(message).toBe("#アンケート の投票が終了しました");
  });

  test("イベント作成", () => {
    const entry = {
      category: "scheduledEvent",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      eventId: "e1",
      executorId: "mod1",
      action: "create",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { mod1: "Admin" }, channels: {} });

    expect(message).toBe("Admin がイベントを作成しました");
  });

  test("イベント更新", () => {
    const entry = {
      category: "scheduledEvent",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      eventId: "e1",
      executorId: "mod1",
      action: "update",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { mod1: "Admin" }, channels: {} });

    expect(message).toBe("Admin がイベントを更新しました");
  });

  test("イベント削除", () => {
    const entry = {
      category: "scheduledEvent",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      eventId: "e1",
      executorId: "mod1",
      action: "delete",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { mod1: "Admin" }, channels: {} });

    expect(message).toBe("Admin がイベントを削除しました");
  });

  test("イベント終了", () => {
    const entry = {
      category: "scheduledEvent",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      eventId: "e1",
      action: "complete",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, noNames);

    expect(message).toBe("イベントが終了しました");
  });

  test("イベント開始(実行者なし)", () => {
    const entry = {
      category: "scheduledEvent",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      eventId: "e1",
      action: "start",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, noNames);

    expect(message).toBe("イベントが開始しました");
  });

  test("イベント中止(実行者なし)", () => {
    const entry = {
      category: "scheduledEvent",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      eventId: "e1",
      action: "cancel",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, noNames);

    expect(message).toBe("イベントが中止されました");
  });

  test("イベント中止(実行者あり)", () => {
    const entry = {
      category: "scheduledEvent",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      eventId: "e1",
      executorId: "mod1",
      action: "cancel",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { mod1: "Admin" }, channels: {} });

    expect(message).toBe("Admin がイベントを中止しました");
  });

  test("ステージ開始", () => {
    const entry = {
      category: "stage",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      stageInstanceId: "si1",
      channelId: "c1",
      executorId: "mod1",
      action: "start",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, {
      users: { mod1: "Admin" },
      channels: { c1: "ステージ" },
    });

    expect(message).toBe("Admin が #ステージ でステージを開始しました");
  });

  test("ステージ開始(実行者未相関)", () => {
    const entry = {
      category: "stage",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      stageInstanceId: "si1",
      channelId: "c1",
      action: "start",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: {}, channels: { c1: "ステージ" } });

    expect(message).toBe("不明なユーザー が #ステージ でステージを開始しました");
  });

  test("ステージ終了(実行者未相関)", () => {
    const entry = {
      category: "stage",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      stageInstanceId: "si1",
      channelId: "c1",
      action: "end",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: {}, channels: { c1: "ステージ" } });

    expect(message).toBe("不明なユーザー が #ステージ のステージを終了しました");
  });

  test("ステージ更新(実行者未相関)", () => {
    const entry = {
      category: "stage",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      stageInstanceId: "si1",
      channelId: "c1",
      action: "update",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, noNames);

    expect(message).toBe("不明なユーザー がステージを更新しました");
  });

  test("ステージ終了", () => {
    const entry = {
      category: "stage",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      stageInstanceId: "si1",
      channelId: "c1",
      executorId: "mod1",
      action: "end",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, {
      users: { mod1: "Admin" },
      channels: { c1: "ステージ" },
    });

    expect(message).toBe("Admin が #ステージ のステージを終了しました");
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
