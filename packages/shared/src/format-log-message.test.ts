import { describe, expect, test } from "bun:test";
import { formatLogMessage, NAME_MARKUP } from "./format-log-message.js";
import { summarizeLogEntry } from "./log-entry-summary.js";
import type { LogEntry } from "./log-entry.js";

const noNames = { users: {}, channels: {} };

describe("formatLogMessage", () => {
  test("集約bulkDeleteは投稿者や実行者を推測せず件数だけ表示する", () => {
    const entry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-09-20T00:00:00.000Z",
      channelId: "c1",
      action: "bulkDelete",
      deletedMessages: [
        { messageId: "m1", authorId: "u1", content: "first" },
        { messageId: "m2", authorId: "u2", content: "second" },
      ],
    } satisfies LogEntry;

    expect(formatLogMessage(entry, summarizeLogEntry(entry), { users: {}, channels: { c1: "一般" } })).toBe(
      "#一般 で 2件のメッセージが一括削除されました",
    );
  });

  test("従来の個別bulkDeleteも投稿者や実行者を推測しない", () => {
    const entry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-09-20T00:00:00.000Z",
      channelId: "c1",
      authorId: "u1",
      action: "bulkDelete",
    } satisfies LogEntry;

    expect(formatLogMessage(entry, summarizeLogEntry(entry), { users: { u1: "mini" }, channels: { c1: "一般" } })).toBe(
      "#一般 でメッセージが一括削除されました",
    );
  });

  test("メッセージのピン留め(実行者不明): 監査ログ相関が間に合わない場合、実行者は「不明なユーザー」にしつつ、誰の投稿かは投稿者名で示す", () => {
    const entry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-09-25T00:00:00.000Z",
      channelId: "c1",
      authorId: "u1",
      authorName: "mini",
      action: "pin",
      messageId: "m1",
    } satisfies LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, {
      users: { u1: "mini" },
      channels: { c1: "一般" },
    });

    expect(message).toBe("#一般 で 不明なユーザー が mini のメッセージをピン留めしました");
  });

  test("メッセージのピン留め(実行者判明・他人の投稿): 監査ログ相関でexecutorIdが付けば実行者名と投稿者名を両方出す", () => {
    const entry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-09-25T00:00:00.000Z",
      channelId: "c1",
      authorId: "u1",
      authorName: "mini",
      executorId: "u2",
      executorName: "Yuzuki",
      action: "pin",
      messageId: "m1",
    } satisfies LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, {
      users: { u1: "mini", u2: "Yuzuki" },
      channels: { c1: "一般" },
    });

    expect(message).toBe("#一般 で Yuzuki が mini のメッセージをピン留めしました");
  });

  test("メッセージのピン留め(自分の投稿を自分でピン留め)", () => {
    const entry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-09-25T00:00:00.000Z",
      channelId: "c1",
      authorId: "u1",
      authorName: "mini",
      executorId: "u1",
      executorName: "mini",
      action: "pin",
      messageId: "m1",
    } satisfies LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, {
      users: { u1: "mini" },
      channels: { c1: "一般" },
    });

    expect(message).toBe("#一般 で mini が自分のメッセージをピン留めしました");
  });

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

    expect(message).toBe("#ログ-推奨 で Yuzuki が自分のメッセージを削除しました");
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

    expect(message).toBe("#c1 で Admin が Yuzuki のメッセージを削除しました");
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

    expect(message).toBe("#c1 で モデレーター太郎 が Yuzuki のメッセージを削除しました");
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

    expect(message).toBe("#c1 で 退室済みユーザー が自分のメッセージを削除しました");
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

    expect(message).toBe("#c1 で Yuzuki がメッセージを投稿しました");
  });

  test("markup=trueではユーザー名・チャンネル名(スナップショット含む)を目印で囲む", () => {
    const entry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      channelId: "c1",
      authorId: "u1",
      authorName: "Yzk",
      executorId: "u2",
      executorName: "mod",
      action: "delete",
      content: "x",
    } as unknown as LogEntry;
    const { user, channel, end } = NAME_MARKUP;

    const message = formatLogMessage(entry, summarizeLogEntry(entry), {
      users: {},
      channels: { c1: "雑談" },
      markup: true,
    });

    expect(message).toBe(`${channel}#雑談${end} で ${user}mod${end} が ${user}Yzk${end} のメッセージを削除しました`);
  });

  test("markup=trueでは自由入力(絵文字等)に目印文字を混ぜても偽のピルを作れない(#564)", () => {
    const { user, end } = NAME_MARKUP;
    const entry = {
      category: "reaction",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      channelId: "c1",
      messageId: "m1",
      userId: "u1",
      emoji: `${user}admin${end}`,
      action: "add",
    } as unknown as LogEntry;

    const message = formatLogMessage(entry, summarizeLogEntry(entry), {
      users: { u1: `Yu${end}zuki` },
      channels: {},
      markup: true,
    });

    expect(message).toBe(`${user}Yuzuki${end} が admin でリアクションしました`);
  });

  test("markup=trueで除去後に検証が通らない入力でも、出力に目印文字を残さない(#564)", () => {
    const { user, end } = NAME_MARKUP;
    const entry = {
      category: "reaction",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      channelId: "c1",
      messageId: "m1",
      userId: "u1",
      emoji: `${user}${end}`,
      action: "add",
    } as unknown as LogEntry;

    const message = formatLogMessage(entry, summarizeLogEntry(entry), { users: {}, channels: {}, markup: true });

    expect(Object.values(NAME_MARKUP).some((marker) => message.includes(marker))).toBe(false);
  });

  test("markup=trueでも、未知のactionに混ぜた目印文字は除去する(#564)", () => {
    const { channel, end } = NAME_MARKUP;
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

    const message = formatLogMessage(
      entry,
      { ...summarizeLogEntry(entry), action: `${channel}#fake${end}` },
      { users: {}, channels: {}, markup: true },
    );

    expect(message).not.toContain(channel);
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

    expect(message).toBe("#c1 で Yuzuki がメッセージを編集しました");
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

  test("ボイス状態変化(スピーカーミュートはselfMuteの連動表示を省く)", () => {
    const entry = {
      category: "voice",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      userId: "u1",
      channelId: "c1",
      action: "update",
      changes: {
        selfMute: { before: false, after: true },
        selfDeaf: { before: false, after: true },
      },
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { u1: "Sora" }, channels: {} });

    expect(message).toBe("Sora がスピーカーミュートしました");
  });

  test("ボイス状態変化(スピーカーミュート解除もselfMuteの連動表示を省く)", () => {
    const entry = {
      category: "voice",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      userId: "u1",
      channelId: "c1",
      action: "update",
      changes: {
        selfMute: { before: true, after: false },
        selfDeaf: { before: true, after: false },
      },
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { u1: "Sora" }, channels: {} });

    expect(message).toBe("Sora がスピーカーミュートを解除しました");
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

describe("formatLogMessage: scheduledPost", () => {
  const names = { users: { u1: "alice", u9: "admin" }, channels: { c1: "general" } };
  const base = {
    guildId: "g1",
    createdAt: "2026-09-26T00:00:00.000Z",
    category: "scheduledPost" as const,
    postId: "p1",
    channelId: "c1",
    authorId: "u1",
    scheduledAt: "2026-10-01T00:00:00.000Z",
  };

  test("登録・編集・投稿成功", () => {
    const created: LogEntry = { ...base, action: "created", content: "hi" };
    const edited: LogEntry = {
      ...base,
      action: "edited",
      content: "after",
      previousContent: "before",
      previousScheduledAt: "2026-09-30T00:00:00.000Z",
    };
    const posted: LogEntry = { ...base, action: "posted", messageId: "m1" };
    expect(formatLogMessage(created, summarizeLogEntry(created), names)).toBe("alice が #general への予約投稿を登録しました");
    expect(formatLogMessage(edited, summarizeLogEntry(edited), names)).toBe("alice が #general への予約投稿を編集しました");
    expect(formatLogMessage(posted, summarizeLogEntry(posted), names)).toBe("alice の予約投稿を #general に投稿しました");
  });

  test("取り消しは本人/管理者で主語が変わる", () => {
    const byAuthor: LogEntry = { ...base, action: "cancelled", by: "author" };
    const byAdmin: LogEntry = { ...base, action: "cancelled", by: "admin", executorId: "u9" };
    expect(formatLogMessage(byAuthor, summarizeLogEntry(byAuthor), names)).toBe("alice が #general への予約投稿を取り消しました");
    expect(formatLogMessage(byAdmin, summarizeLogEntry(byAdmin), names)).toBe(
      "admin が alice の #general への予約投稿を取り消しました",
    );
  });

  test("失敗は原因を含む", () => {
    const failed: LogEntry = { ...base, action: "failed", reason: "author_left" };
    expect(formatLogMessage(failed, summarizeLogEntry(failed), names)).toContain("予約者がサーバーを退出していた");
  });
});

describe("formatLogMessage: チャンネル名スナップショット", () => {
  const mentionNames = { users: {}, channels: {}, mention: true };

  test("mention=trueでもchannelNameがあれば<#id>ではなく#名前を使う(削除後の「不明」表示を避ける)", () => {
    const entry: LogEntry = {
      guildId: "g1",
      createdAt: "2026-09-26T00:00:00.000Z",
      category: "tempVoice",
      action: "deleted",
      channelId: "c1",
      channelName: "YoMiのVC",
      ownerId: "u1",
    };
    expect(formatLogMessage(entry, summarizeLogEntry(entry), mentionNames)).toBe(
      "一時VC #YoMiのVC(オーナー: <@u1>)が削除されました",
    );
  });

  test("move: 移動元・移動先の両方にスナップショットを使う", () => {
    const entry: LogEntry = {
      guildId: "g1",
      createdAt: "2026-09-26T00:00:00.000Z",
      category: "voice",
      action: "move",
      userId: "u1",
      channelId: "c2",
      channelName: "ゲーム部屋",
      previousChannelId: "c1",
      previousChannelName: "雑談",
    };
    expect(formatLogMessage(entry, summarizeLogEntry(entry), mentionNames)).toBe(
      "<@u1> が #雑談 から #ゲーム部屋 に移動しました",
    );
  });

  test("スナップショットが無い既存ログは従来通り<#id>", () => {
    const entry: LogEntry = {
      guildId: "g1",
      createdAt: "2026-09-26T00:00:00.000Z",
      category: "voice",
      action: "leave",
      userId: "u1",
      channelId: "c1",
    };
    expect(formatLogMessage(entry, summarizeLogEntry(entry), mentionNames)).toBe("<@u1> が <#c1> から退出しました");
  });
});
