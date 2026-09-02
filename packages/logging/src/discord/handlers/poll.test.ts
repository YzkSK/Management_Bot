import { describe, expect, mock, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import { registerPollHandlers, toPollCreateLogEntry, toPollEndLogEntry } from "./poll.js";

function fakeMessage(
  overrides: Partial<{
    guildId: string | null;
    author: { id: string; bot: boolean } | null;
    poll: { resultsFinalized: boolean } | null;
  }> = {},
) {
  return {
    id: "m1",
    guildId: "g1",
    channelId: "c1",
    author: { id: "u1", bot: false },
    poll: { resultsFinalized: false },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  } as never;
}

describe("toPollCreateLogEntry", () => {
  test("pollを持つメッセージはcreateエントリを返す", () => {
    expect(toPollCreateLogEntry(fakeMessage())?.action).toBe("create");
  });

  test("pollがなければundefined", () => {
    expect(toPollCreateLogEntry(fakeMessage({ poll: null }))).toBeUndefined();
  });

  test("Botの投稿はundefined", () => {
    expect(toPollCreateLogEntry(fakeMessage({ author: { id: "b1", bot: true } }))).toBeUndefined();
  });
});

describe("toPollEndLogEntry", () => {
  test("resultsFinalizedがfalse→trueになればendエントリを返す", () => {
    const entry = toPollEndLogEntry(
      fakeMessage({ poll: { resultsFinalized: false } }),
      fakeMessage({ poll: { resultsFinalized: true } }),
    );
    expect(entry?.action).toBe("end");
  });

  test("既にresultsFinalizedがtrueだった場合はundefined(重複防止)", () => {
    const entry = toPollEndLogEntry(
      fakeMessage({ poll: { resultsFinalized: true } }),
      fakeMessage({ poll: { resultsFinalized: true } }),
    );
    expect(entry).toBeUndefined();
  });

  test("resultsFinalizedがfalseのままならundefined", () => {
    const entry = toPollEndLogEntry(
      fakeMessage({ poll: { resultsFinalized: false } }),
      fakeMessage({ poll: { resultsFinalized: false } }),
    );
    expect(entry).toBeUndefined();
  });
});

describe("registerPollHandlers", () => {
  test("messageCreate/messageUpdateをclient.onに登録する", () => {
    const on = mock(() => undefined);
    const ctx = { client: { on }, db: {} } as unknown as FeatureModuleContext;

    registerPollHandlers(ctx);

    expect(on.mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining(["messageCreate", "messageUpdate"]));
  });
});
