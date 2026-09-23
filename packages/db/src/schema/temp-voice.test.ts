import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "../client.ts";
import {
  guilds,
  tempVoiceChannels,
  tempVoiceConfigs,
  tempVoiceDenyProtectedRoles,
  tempVoicePermissionOverrides,
} from "./index.ts";

const INVALID = "unknown" as never;

interface PgErrorCause {
  code?: string;
  constraint_name?: string;
}

async function expectConstraintViolation(operation: Promise<unknown>, constraintName: string): Promise<void> {
  try {
    await operation;
  } catch (e) {
    const cause = (e as { cause?: PgErrorCause }).cause;
    expect(cause?.constraint_name).toBe(constraintName);
    return;
  }
  throw new Error(`expected constraint "${constraintName}" violation, but the operation succeeded`);
}

describe("temp-voice schema", () => {
  let db: Db;
  let close: () => Promise<void>;
  const guildId = `test-guild-${randomUUID()}`;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    ({ db, close } = createDb(databaseUrl));
    await db.insert(guilds).values({ id: guildId, name: "Test Guild" });
  });

  afterAll(async () => {
    await db.delete(guilds).where(eq(guilds.id, guildId));
    await close();
  });

  test("temp_voice_configsはguild_idを主キーに持ち、default_user_limitはCHECK制約で0〜99に検証される", async () => {
    await db.insert(tempVoiceConfigs).values({
      guildId,
      createChannelId: `create-ch-${randomUUID()}`,
      categoryId: `category-${randomUUID()}`,
    });

    await expectConstraintViolation(
      db.insert(tempVoiceConfigs).values({
        guildId,
        createChannelId: `create-ch-${randomUUID()}`,
        categoryId: `category-${randomUUID()}`,
      }),
      "temp_voice_configs_pkey",
    );

    await expectConstraintViolation(
      db.insert(tempVoiceConfigs).values({
        guildId: `test-guild-${randomUUID()}`,
        createChannelId: `create-ch-${randomUUID()}`,
        categoryId: `category-${randomUUID()}`,
        defaultUserLimit: 100,
      }),
      "temp_voice_configs_default_user_limit_check",
    );
  });

  test("temp_voice_channelsはchannel_idを主キーに持ち、guild_id+owner_idで一意", async () => {
    const ownerId = `test-user-${randomUUID()}`;
    const channelId = `channel-${randomUUID()}`;
    await db.insert(tempVoiceChannels).values({
      channelId,
      guildId,
      controlChannelId: `control-${randomUUID()}`,
      ownerId,
    });

    await expectConstraintViolation(
      db.insert(tempVoiceChannels).values({
        channelId: `channel-${randomUUID()}`,
        guildId,
        controlChannelId: `control-${randomUUID()}`,
        ownerId,
      }),
      "temp_voice_channels_guild_id_owner_id_key",
    );

    await expectConstraintViolation(
      db.insert(tempVoiceChannels).values({
        channelId,
        guildId,
        controlChannelId: `control-${randomUUID()}`,
        ownerId: `test-user-${randomUUID()}`,
      }),
      "temp_voice_channels_pkey",
    );
  });

  test("temp_voice_permission_overridesはchannel_id+target_type+target_idで一意、target_type/stateはCHECK制約で検証される", async () => {
    const channelId = `channel-${randomUUID()}`;
    await db.insert(tempVoiceChannels).values({
      channelId,
      guildId,
      controlChannelId: `control-${randomUUID()}`,
      ownerId: `test-user-${randomUUID()}`,
    });

    const targetId = `test-role-${randomUUID()}`;
    await db.insert(tempVoicePermissionOverrides).values({ channelId, targetType: "role", targetId, state: "deny" });

    await expectConstraintViolation(
      db.insert(tempVoicePermissionOverrides).values({ channelId, targetType: "role", targetId, state: "allow" }),
      "temp_voice_permission_overrides_pk",
    );
    await expectConstraintViolation(
      db.insert(tempVoicePermissionOverrides).values({ channelId, targetType: INVALID, targetId, state: "allow" }),
      "temp_voice_permission_overrides_target_type_check",
    );
    await expectConstraintViolation(
      db.insert(tempVoicePermissionOverrides).values({
        channelId,
        targetType: "user",
        targetId: `test-user-${randomUUID()}`,
        state: INVALID,
      }),
      "temp_voice_permission_overrides_state_check",
    );
  });

  test("temp_voice_deny_protected_rolesはguild_id+role_idで一意", async () => {
    const roleId = `test-role-${randomUUID()}`;
    await db.insert(tempVoiceDenyProtectedRoles).values({ guildId, roleId });

    await expectConstraintViolation(
      db.insert(tempVoiceDenyProtectedRoles).values({ guildId, roleId }),
      "temp_voice_deny_protected_roles_guild_id_role_id_pk",
    );
  });
});
