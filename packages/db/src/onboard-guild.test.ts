import { describe, expect, test } from "bun:test";
import { ALL_CAPABILITIES, BASELINE_EVERYONE_CAPABILITIES, FEATURE_METADATA } from "@management-bot/shared";
import { onboardGuild } from "./onboard-guild.ts";
import { capabilityGrants, guildFeatureToggles, guilds } from "./schema/index.ts";
import type { Db } from "./client.ts";

interface RecordedInsert {
  table: unknown;
  values: unknown;
  conflict: { type: "update"; target: unknown; set: unknown } | { type: "nothing" };
}

function fakeDb(inserts: RecordedInsert[]): Db {
  const tx = {
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        onConflictDoUpdate: (opts: { target: unknown; set: unknown }) => {
          inserts.push({ table, values, conflict: { type: "update", ...opts } });
          return Promise.resolve();
        },
        onConflictDoNothing: () => {
          inserts.push({ table, values, conflict: { type: "nothing" } });
          return Promise.resolve();
        },
      }),
    }),
  };
  return {
    transaction: (fn: (tx: unknown) => Promise<void>) => fn(tx),
  } as unknown as Db;
}

describe("onboardGuild", () => {
  test("guilds/guild_feature_toggles/capability_grantsへ初期値をトランザクション内でinsertする", async () => {
    const inserts: RecordedInsert[] = [];
    const db = fakeDb(inserts);

    await onboardGuild(db, { guildId: "g1", guildName: "Test Guild", ownerId: "owner1" });

    expect(inserts[0]?.table).toBe(guilds);
    expect(inserts[0]?.values).toEqual({ id: "g1", name: "Test Guild" });
    expect(inserts[0]?.conflict).toMatchObject({ type: "update", target: guilds.id });

    expect(inserts[1]?.table).toBe(guildFeatureToggles);
    expect(inserts[1]?.values).toEqual(
      FEATURE_METADATA.map((f) => ({ guildId: "g1", featureKey: f.key, enabled: f.defaultEnabled })),
    );
    expect(inserts[1]?.conflict).toEqual({ type: "nothing" });

    expect(inserts[2]?.table).toBe(capabilityGrants);
    expect(inserts[2]?.conflict).toEqual({ type: "nothing" });
    const grants = inserts[2]?.values as { targetType: string; targetId: string; capabilities: number }[];
    expect(grants).toContainEqual(
      expect.objectContaining({ targetType: "user", targetId: "owner1", capabilities: ALL_CAPABILITIES }),
    );
    expect(grants).toContainEqual(
      expect.objectContaining({
        targetType: "role",
        targetId: "g1",
        capabilities: BASELINE_EVERYONE_CAPABILITIES,
      }),
    );
  });
});
