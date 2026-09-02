import { describe, expect, test } from "bun:test";
import { initTRPC } from "@trpc/server";
import type { DomainEventBus, FeatureModule } from "@management-bot/core";
import { BotClient } from "@management-bot/core";
import type { Db } from "@management-bot/db";
import { FEATURES } from "./features.ts";

const t = initTRPC.create();
const fakeDb = {} as Db;
const fakeEventBus = { subscribe: () => Promise.resolve() } as unknown as DomainEventBus;
const testDeps = { db: fakeDb, eventBusFor: () => fakeEventBus };

describe("FEATURES registry", () => {
  test("Phase0で予定された4機能がすべて登録されている", () => {
    expect(FEATURES.map((feature) => feature.key)).toEqual([
      "activity",
      "logging",
      "temp-voice",
      "moderation",
    ]);
  });

  test("登録済みの4機能をBotClientに登録できる", async () => {
    const client = new BotClient();
    await expect(client.registerFeatures(FEATURES, testDeps)).resolves.toBeUndefined();
  });

  test("重複したkeyのFeatureModuleは登録を拒否する", async () => {
    const duplicate: FeatureModule = {
      key: FEATURES[0]!.key,
      registerDiscordHandlers: () => {},
      router: t.router({}),
    };
    const client = new BotClient();
    await expect(client.registerFeatures([...FEATURES, duplicate], testDeps)).rejects.toThrow(
      "Duplicate FeatureModule key",
    );
  });
});
