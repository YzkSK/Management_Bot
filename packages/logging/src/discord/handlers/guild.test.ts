import { describe, expect, mock, test } from "bun:test";
import type { FeatureModuleContext } from "@management-bot/core";
import { registerGuildHandlers, toGuildUpdateLogEntry } from "./guild.js";

function fakeGuild(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "g1",
    name: "guild",
    icon: null,
    banner: null,
    description: null,
    verificationLevel: 0,
    explicitContentFilter: 0,
    defaultMessageNotifications: 0,
    afkChannelId: null,
    afkTimeout: 0,
    systemChannelId: null,
    rulesChannelId: null,
    publicUpdatesChannelId: null,
    preferredLocale: "ja",
    widgetEnabled: null,
    widgetChannelId: null,
    ...overrides,
  } as never;
}

describe("toGuildUpdateLogEntry", () => {
  test("名前が変わればchangesに反映される(他の未変更フィールドは含まれない)", () => {
    const entry = toGuildUpdateLogEntry(fakeGuild({ name: "old" }), fakeGuild({ name: "new" }));
    expect(entry?.action).toBe("update");
    expect(entry?.changes).toEqual({ name: { before: "old", after: "new" } });
  });

  test("iconがnullから文字列に変わればchangesに反映される", () => {
    const entry = toGuildUpdateLogEntry(fakeGuild({ icon: null }), fakeGuild({ icon: "hash" }));
    expect(entry?.changes).toEqual({ icon: { before: null, after: "hash" } });
  });

  test("afkChannelIdが文字列からnullに変わればchangesに反映される", () => {
    const entry = toGuildUpdateLogEntry(fakeGuild({ afkChannelId: "c1" }), fakeGuild({ afkChannelId: null }));
    expect(entry?.changes).toEqual({ afkChannelId: { before: "c1", after: null } });
  });

  test("banner/description/systemChannelId/rulesChannelId/publicUpdatesChannelId/preferredLocale/widgetEnabled/widgetChannelIdの差分もそれぞれchangesに反映される", () => {
    const entry = toGuildUpdateLogEntry(
      fakeGuild({
        banner: null,
        description: null,
        systemChannelId: null,
        rulesChannelId: null,
        publicUpdatesChannelId: null,
        preferredLocale: "ja",
        widgetEnabled: false,
        widgetChannelId: null,
      }),
      fakeGuild({
        banner: "banner-hash",
        description: "desc",
        systemChannelId: "c1",
        rulesChannelId: "c2",
        publicUpdatesChannelId: "c3",
        preferredLocale: "en-US",
        widgetEnabled: true,
        widgetChannelId: "c4",
      }),
    );
    expect(entry).toMatchObject({
      changes: {
        banner: { before: null, after: "banner-hash" },
        description: { before: null, after: "desc" },
        systemChannelId: { before: null, after: "c1" },
        rulesChannelId: { before: null, after: "c2" },
        publicUpdatesChannelId: { before: null, after: "c3" },
        preferredLocale: { before: "ja", after: "en-US" },
        widgetEnabled: { before: false, after: true },
        widgetChannelId: { before: null, after: "c4" },
      },
    });
  });

  test("verificationLevel/explicitContentFilter/defaultMessageNotifications/afkChannelId/afkTimeoutの差分もそれぞれchangesに反映される", () => {
    const entry = toGuildUpdateLogEntry(
      fakeGuild({ verificationLevel: 0, explicitContentFilter: 0, defaultMessageNotifications: 0, afkChannelId: null, afkTimeout: 0 }),
      fakeGuild({ verificationLevel: 2, explicitContentFilter: 1, defaultMessageNotifications: 1, afkChannelId: "c1", afkTimeout: 300 }),
    );
    expect(entry).toMatchObject({
      changes: {
        verificationLevel: { before: 0, after: 2 },
        explicitContentFilter: { before: 0, after: 1 },
        defaultMessageNotifications: { before: 0, after: 1 },
        afkChannelId: { before: null, after: "c1" },
        afkTimeout: { before: 0, after: 300 },
      },
    });
  });

  test("差分がなければundefined(無関係な更新イベントを記録しない)", () => {
    expect(toGuildUpdateLogEntry(fakeGuild(), fakeGuild())).toBeUndefined();
  });
});

describe("registerGuildHandlers", () => {
  test("guildUpdateをclient.onに登録する", () => {
    const on = mock(() => undefined);
    const ctx = { client: { on }, db: {} } as unknown as FeatureModuleContext;

    registerGuildHandlers(ctx);

    expect(on.mock.calls.map((call) => call[0])).toEqual(["guildUpdate"]);
  });
});
