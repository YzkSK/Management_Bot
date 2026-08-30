import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { ALL_CAPABILITIES, BASELINE_EVERYONE_CAPABILITIES, FEATURE_METADATA } from "@management-bot/shared";
import type { Db } from "./client.js";
import { capabilityGrants, guildFeatureToggles, guilds } from "./schema/index.js";

export interface OnboardGuildInput {
  guildId: string;
  guildName: string;
  ownerId: string;
}

/**
 * 新規ギルド参加時の初期化。guildsレコード作成、feature toggleのdefaultEnabled投入、
 * オーナーへの全capabilities付与、@everyone(roleId===guildId)への閲覧系ベースライン付与を行う。
 * 冪等: 同一ギルドで再実行されても既存値を壊さないようconflict時はスキップする(オーナー交代時の旧オーナー権限失効は対象外。別Issueで扱う)。
 * 3テーブルへの書き込みを1トランザクションにまとめ、途中失敗時に部分状態が残らないようにする。
 */
export async function onboardGuild(db: Db, input: OnboardGuildInput): Promise<void> {
  const { guildId, guildName, ownerId } = input;

  await db.transaction(async (tx) => {
    await tx
      .insert(guilds)
      .values({ id: guildId, name: guildName })
      .onConflictDoUpdate({
        target: guilds.id,
        set: { name: sql`excluded.name`, updatedAt: sql`now()` },
      });

    await tx
      .insert(guildFeatureToggles)
      .values(
        FEATURE_METADATA.map((feature) => ({
          guildId,
          featureKey: feature.key,
          enabled: feature.defaultEnabled,
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(capabilityGrants)
      .values([
        { id: randomUUID(), guildId, targetType: "user", targetId: ownerId, capabilities: ALL_CAPABILITIES },
        {
          id: randomUUID(),
          guildId,
          targetType: "role",
          targetId: guildId,
          capabilities: BASELINE_EVERYONE_CAPABILITIES,
        },
      ])
      .onConflictDoNothing();
  });
}
