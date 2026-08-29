import { describe, expect, test } from "bun:test";
import { initTRPC } from "@trpc/server";
import type { FeatureModule } from "@management-bot/core";
import { BotClient } from "@management-bot/core";
import { FEATURES } from "./features.ts";

const t = initTRPC.create();

describe("FEATURES registry", () => {
  test("空配列はBotClientに登録できる(雛形状態)", async () => {
    const client = new BotClient();
    await expect(client.registerFeatures(FEATURES)).resolves.toBeUndefined();
  });

  test("ダミーのFeatureModuleを追加してもBotClientに登録できる", async () => {
    const dummy: FeatureModule = {
      key: "activity",
      registerDiscordHandlers: () => {},
      router: t.router({}),
    };
    const client = new BotClient();
    await expect(client.registerFeatures([...FEATURES, dummy])).resolves.toBeUndefined();
  });
});
