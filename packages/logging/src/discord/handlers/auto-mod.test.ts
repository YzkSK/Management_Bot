import { describe, expect, mock, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import {
  registerAutoModHandlers,
  toAutoModActionExecutedLogEntry,
  toAutoModRuleCreateLogEntry,
  toAutoModRuleDeleteLogEntry,
  toAutoModRuleUpdateLogEntry,
} from "./auto-mod.js";

function fakeRule() {
  return { id: "r1", guild: { id: "g1" }, creatorId: "u1" } as never;
}

function fakeExecution(channelId: string | null = "c1") {
  return { guild: { id: "g1" }, ruleId: "r1", userId: "u1", channelId } as never;
}

describe("auto-mod category mappers", () => {
  test("ruleCreate", () => expect(toAutoModRuleCreateLogEntry(fakeRule()).action).toBe("ruleCreate"));
  test("ruleUpdate", () => expect(toAutoModRuleUpdateLogEntry(fakeRule()).action).toBe("ruleUpdate"));
  test("ruleDelete", () => expect(toAutoModRuleDeleteLogEntry(fakeRule()).action).toBe("ruleDelete"));

  test("actionExecuted: channelIdがあれば含める", () => {
    const entry = toAutoModActionExecutedLogEntry(fakeExecution("c1"));
    expect(entry).toMatchObject({ action: "actionExecuted", channelId: "c1", ruleId: "r1", userId: "u1" });
  });

  test("actionExecuted: channelIdがnullならundefinedにする", () => {
    const entry = toAutoModActionExecutedLogEntry(fakeExecution(null));
    expect(entry.channelId).toBeUndefined();
  });
});

describe("registerAutoModHandlers", () => {
  test("必要な4イベントをclient.onに登録する", () => {
    const on = mock(() => undefined);
    const ctx = { client: { on }, db: {} } as unknown as FeatureModuleContext;

    registerAutoModHandlers(ctx);

    expect(on.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining([
        "autoModerationRuleCreate",
        "autoModerationRuleUpdate",
        "autoModerationRuleDelete",
        "autoModerationActionExecution",
      ]),
    );
  });
});
