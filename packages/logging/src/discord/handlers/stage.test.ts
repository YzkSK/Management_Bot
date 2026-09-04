import { describe, expect, mock, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import { registerStageHandlers, toStageEndLogEntry, toStageStartLogEntry, toStageUpdateLogEntry } from "./stage.js";

function fakeStageInstance() {
  return { id: "s1", guildId: "g1", channelId: "c1" } as never;
}

describe("stage category mappers", () => {
  test("create相当はstart", () => expect(toStageStartLogEntry(fakeStageInstance()).action).toBe("start"));
  test("update", () => expect(toStageUpdateLogEntry(null, fakeStageInstance()).action).toBe("update"));
  test("delete相当はend", () => expect(toStageEndLogEntry(fakeStageInstance()).action).toBe("end"));
});

describe("registerStageHandlers", () => {
  test("必要な3イベントをclient.onに登録する", () => {
    const on = mock(() => undefined);
    const ctx = { client: { on }, db: {} } as unknown as FeatureModuleContext;

    registerStageHandlers(ctx);

    expect(on.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining(["stageInstanceCreate", "stageInstanceUpdate", "stageInstanceDelete"]),
    );
  });
});
