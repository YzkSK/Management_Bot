import { afterEach, beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { GUILD_DATA_TOPICS, type GuildDataTopic } from "@management-bot/shared";
import type { QueryKey } from "@tanstack/react-query";
import { createGuildDataInvalidator, parseGuildDataMessage } from "./guild-live-updates.js";

describe("parseGuildDataMessage", () => {
  test("正しいメッセージからtopicを取り出す", () => {
    expect(parseGuildDataMessage(JSON.stringify({ type: "changed", topic: "moderation" }))).toBe("moderation");
  });

  test.each([
    ["JSONでない", "not json"],
    ["未知のtopic", JSON.stringify({ type: "changed", topic: "unknown" })],
    ["typeが違う", JSON.stringify({ type: "newLogEntry", topic: "access" })],
    ["topicが無い", JSON.stringify({ type: "changed" })],
  ])("%sは無視する", (_name, data) => {
    expect(parseGuildDataMessage(data)).toBeNull();
  });
});

describe("createGuildDataInvalidator", () => {
  const keysFor = (topic: GuildDataTopic): readonly QueryKey[] => [[topic, "a"], [topic, "b"]];
  let invalidateQueries: ReturnType<typeof mock>;

  beforeEach(() => {
    jest.useFakeTimers();
    invalidateQueries = mock(() => Promise.resolve());
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const create = () => createGuildDataInvalidator({ invalidateQueries } as never, keysFor, 300);
  const invalidatedKeys = () => invalidateQueries.mock.calls.map(([arg]) => (arg as { queryKey: QueryKey }).queryKey);

  test("topicに対応するクエリだけを遅延後にinvalidateする", () => {
    const invalidator = create();
    invalidator.notify("access");

    expect(invalidateQueries).not.toHaveBeenCalled();
    jest.advanceTimersByTime(300);
    expect(invalidatedKeys()).toEqual([["access", "a"], ["access", "b"]]);
  });

  test("同じtopicの連続通知は1回にまとめる", () => {
    const invalidator = create();
    invalidator.notify("moderation");
    jest.advanceTimersByTime(100);
    invalidator.notify("moderation");
    invalidator.notify("moderation");
    jest.advanceTimersByTime(200);

    expect(invalidateQueries).toHaveBeenCalledTimes(2); // 1回分(2キー)のみ
    jest.advanceTimersByTime(1000);
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });

  test("発火後の通知はもう一度invalidateする", () => {
    const invalidator = create();
    invalidator.notify("tempVoice");
    jest.advanceTimersByTime(300);
    invalidator.notify("tempVoice");
    jest.advanceTimersByTime(300);

    expect(invalidateQueries).toHaveBeenCalledTimes(4);
  });

  test("notifyAllは全topicをinvalidateする(再接続時の取り直し)", () => {
    const invalidator = create();
    invalidator.notifyAll();
    jest.advanceTimersByTime(300);

    const topics = new Set(invalidatedKeys().map((key) => key[0]));
    expect(topics).toEqual(new Set(GUILD_DATA_TOPICS));
  });

  test("disposeすると保留中のinvalidateを取り消す", () => {
    const invalidator = create();
    invalidator.notify("auditLog");
    invalidator.dispose();
    jest.advanceTimersByTime(1000);

    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
