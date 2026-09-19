import { eq } from "drizzle-orm";
import { moderationLockdownSettings, type Db } from "@management-bot/db";

export interface LockdownSettings {
  autoLockdownOnRaid: boolean;
  requestedLocked: boolean;
  isLocked: boolean;
}

const DEFAULT_LOCKDOWN_SETTINGS: LockdownSettings = {
  autoLockdownOnRaid: false,
  requestedLocked: false,
  isLocked: false,
};

export async function getLockdownSettings(db: Db, guildId: string): Promise<LockdownSettings> {
  const [row] = await db
    .select({
      autoLockdownOnRaid: moderationLockdownSettings.autoLockdownOnRaid,
      requestedLocked: moderationLockdownSettings.requestedLocked,
      isLocked: moderationLockdownSettings.isLocked,
    })
    .from(moderationLockdownSettings)
    .where(eq(moderationLockdownSettings.guildId, guildId));

  return row ?? DEFAULT_LOCKDOWN_SETTINGS;
}

export async function setAutoLockdownOnRaid(db: Db, guildId: string, enabled: boolean): Promise<void> {
  await db
    .insert(moderationLockdownSettings)
    .values({ guildId, autoLockdownOnRaid: enabled })
    .onConflictDoUpdate({
      target: moderationLockdownSettings.guildId,
      set: { autoLockdownOnRaid: enabled, updatedAt: new Date() },
    });
}

export async function setLockdownRequested(db: Db, guildId: string, requestedLocked: boolean): Promise<void> {
  await db
    .insert(moderationLockdownSettings)
    .values({ guildId, requestedLocked })
    .onConflictDoUpdate({
      target: moderationLockdownSettings.guildId,
      set: { requestedLocked, updatedAt: new Date() },
    });
}

export async function markLockdownApplied(db: Db, guildId: string, isLocked: boolean): Promise<void> {
  await db
    .insert(moderationLockdownSettings)
    .values({ guildId, isLocked })
    .onConflictDoUpdate({
      target: moderationLockdownSettings.guildId,
      set: { isLocked, updatedAt: new Date() },
    });
}
