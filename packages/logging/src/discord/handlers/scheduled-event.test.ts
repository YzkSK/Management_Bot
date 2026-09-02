import { describe, expect, mock, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import {
  registerScheduledEventHandlers,
  toScheduledEventCreateLogEntry,
  toScheduledEventDeleteLogEntry,
  toScheduledEventUpdateLogEntry,
} from "./scheduled-event.js";

function fakeEvent(status: "scheduled" | "active" | "completed" | "canceled" = "scheduled", id = "e1") {
  return {
    id,
    guildId: "g1",
    isActive: () => status === "active",
    isCompleted: () => status === "completed",
    isCanceled: () => status === "canceled",
  } as never;
}

describe("scheduled-event category mappers", () => {
  test("create", () => expect(toScheduledEventCreateLogEntry(fakeEvent()).action).toBe("create"));
  test("delete", () => expect(toScheduledEventDeleteLogEntry(fakeEvent()).action).toBe("delete"));

  test("update: scheduled→activeはstart", () => {
    expect(toScheduledEventUpdateLogEntry(fakeEvent("scheduled"), fakeEvent("active")).action).toBe("start");
  });

  test("update: active→completedはcomplete", () => {
    expect(toScheduledEventUpdateLogEntry(fakeEvent("active"), fakeEvent("completed")).action).toBe("complete");
  });

  test("update: scheduled→canceledはcancel", () => {
    expect(toScheduledEventUpdateLogEntry(fakeEvent("scheduled"), fakeEvent("canceled")).action).toBe("cancel");
  });

  test("update: statusが変わらない編集(日時変更等)はupdate", () => {
    expect(toScheduledEventUpdateLogEntry(fakeEvent("active"), fakeEvent("active")).action).toBe("update");
  });

  test("update: oldEventがnull(uncached)でもエラーにならない", () => {
    expect(toScheduledEventUpdateLogEntry(null, fakeEvent("active")).action).toBe("start");
  });
});

describe("registerScheduledEventHandlers", () => {
  test("必要な3イベントをclient.onに登録する", () => {
    const on = mock(() => undefined);
    const ctx = { client: { on }, db: {} } as unknown as FeatureModuleContext;

    registerScheduledEventHandlers(ctx);

    expect(on.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining(["guildScheduledEventCreate", "guildScheduledEventDelete", "guildScheduledEventUpdate"]),
    );
  });
});
