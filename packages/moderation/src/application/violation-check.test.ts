import { describe, expect, test } from "bun:test";
import type { NgwordRow } from "./ngwords.js";
import {
  bufferedMessageIdsInWindow,
  checkFloodOrDuplicate,
  checkInviteLink,
  checkMentionSpam,
  checkNgword,
} from "./violation-check.js";
import type { IncomingMessage } from "./detect-and-escalate.js";
import type { BufferedMessage } from "./message-buffer.js";

function message(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    guildId: "guild-1",
    userId: "user-1",
    channelId: "channel-1",
    roleIds: [],
    messageId: "msg-trigger",
    content: "hello",
    createdAt: new Date("2026-01-01T00:00:10.000Z"),
    ...overrides,
  };
}

function bufferedMessage(overrides: Partial<BufferedMessage> = {}): BufferedMessage {
  return {
    messageId: "msg-1",
    channelId: "channel-1",
    content: "hello",
    createdAt: new Date("2026-01-01T00:00:05.000Z"),
    ...overrides,
  };
}

describe("checkFloodOrDuplicate (flood)", () => {
  test("mediumプリセットの閾値(5件)未満ならhit=falseでstrikeLockMode=burst", () => {
    const buffer = Array.from({ length: 3 }, (_, i) => bufferedMessage({ messageId: `msg-${i}` }));
    const result = checkFloodOrDuplicate(buffer, message(), "medium", "flood");
    expect(result.hit).toBe(false);
    expect(result.strikeLockMode).toBe("burst");
  });

  test("mediumプリセットの閾値(5件)以上ならhit=true", () => {
    const buffer = Array.from({ length: 5 }, (_, i) =>
      bufferedMessage({ messageId: `msg-${i}`, createdAt: new Date("2026-01-01T00:00:05.000Z") }),
    );
    const result = checkFloodOrDuplicate(buffer, message(), "medium", "flood");
    expect(result.hit).toBe(true);
  });
});

describe("checkFloodOrDuplicate (duplicate_content)", () => {
  test("類似メッセージがバッファになければhit=false", () => {
    const buffer = [bufferedMessage({ content: "全く別の内容です" })];
    const result = checkFloodOrDuplicate(buffer, message({ content: "hello world" }), "medium", "duplicate_content");
    expect(result.hit).toBe(false);
  });

  test("類似度閾値(medium=0.9)以上の投稿がバッファにあればhit=true", () => {
    const buffer = [bufferedMessage({ content: "hello" })];
    const result = checkFloodOrDuplicate(buffer, message({ content: "hello" }), "medium", "duplicate_content");
    expect(result.hit).toBe(true);
  });

  test("自分自身(同一messageId)はバッファ比較から除外される", () => {
    const buffer = [bufferedMessage({ messageId: "msg-trigger", content: "hello" })];
    const result = checkFloodOrDuplicate(buffer, message({ content: "hello", messageId: "msg-trigger" }), "medium", "duplicate_content");
    expect(result.hit).toBe(false);
  });
});

describe("checkNgword", () => {
  const ngwords: NgwordRow[] = [{ id: "ng-1", matchType: "exact", pattern: "ng" }];

  test("NGワードに一致すればhit=trueでstrikeLockMode=single-shot", () => {
    const result = checkNgword(message({ content: "ng" }), ngwords);
    expect(result.hit).toBe(true);
    expect(result.strikeLockMode).toBe("single-shot");
    expect(result.bufferedMessageIds).toEqual(["msg-trigger"]);
  });

  test("NGワードに一致しなければhit=false", () => {
    const result = checkNgword(message({ content: "clean message" }), ngwords);
    expect(result.hit).toBe(false);
  });
});

describe("checkMentionSpam", () => {
  test("単発メンション数が閾値(medium=6)以上ならhit=true", () => {
    const mentions = Array.from({ length: 6 }, () => "<@1>").join(" ");
    const result = checkMentionSpam(message({ content: mentions }), "medium", []);
    expect(result.hit).toBe(true);
    expect(result.strikeLockMode).toBe("single-shot");
  });

  test("累積メンション数が閾値(medium=10)以上ならhit=true", () => {
    const mentionBuffer = [
      { mentionCount: 5, createdAt: new Date("2026-01-01T00:00:08.000Z") },
      { mentionCount: 5, createdAt: new Date("2026-01-01T00:00:09.000Z") },
    ];
    const result = checkMentionSpam(message({ content: "<@1>" }), "medium", mentionBuffer);
    expect(result.hit).toBe(true);
  });

  test("単発・累積いずれも閾値未満ならhit=false", () => {
    const result = checkMentionSpam(message({ content: "<@1>" }), "medium", [
      { mentionCount: 1, createdAt: new Date("2026-01-01T00:00:09.000Z") },
    ]);
    expect(result.hit).toBe(false);
  });
});

describe("checkInviteLink", () => {
  test("他ギルドの招待リンク(解決成功・自ギルド以外)ならhit=true", () => {
    const result = checkInviteLink(message(), ["other-guild"]);
    expect(result.hit).toBe(true);
    expect(result.strikeLockMode).toBe("single-shot");
  });

  test("自ギルドの招待リンクのみならhit=false", () => {
    const result = checkInviteLink(message({ guildId: "guild-1" }), ["guild-1"]);
    expect(result.hit).toBe(false);
  });

  test("解決失敗(null)は安全側に倒し他ギルドとして扱いhit=true", () => {
    const result = checkInviteLink(message(), [null]);
    expect(result.hit).toBe(true);
  });

  test("招待コードなし(空配列)ならhit=false", () => {
    const result = checkInviteLink(message(), []);
    expect(result.hit).toBe(false);
  });
});

describe("bufferedMessageIdsInWindow", () => {
  test("同一チャンネル・時間窓内のメッセージIDのみ抽出する", () => {
    const trigger = message({ createdAt: new Date("2026-01-01T00:00:10.000Z") });
    const inWindow = bufferedMessage({ messageId: "in", channelId: "channel-1", createdAt: new Date("2026-01-01T00:00:05.000Z") });
    const otherChannel = bufferedMessage({ messageId: "other-channel", channelId: "channel-2", createdAt: new Date("2026-01-01T00:00:05.000Z") });
    const tooOld = bufferedMessage({ messageId: "too-old", channelId: "channel-1", createdAt: new Date("2025-12-31T23:00:00.000Z") });
    const result = bufferedMessageIdsInWindow([inWindow, otherChannel, tooOld], trigger, 10);
    expect(result).toEqual(["in"]);
  });
});
