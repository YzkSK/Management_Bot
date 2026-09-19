import { asc, eq } from "drizzle-orm";
import { moderationLockdownChannelSnapshots, moderationLockdownSettings, type Db } from "@management-bot/db";

export interface LockdownSettings {
  autoLockdownOnRaid: boolean;
  requestedLocked: boolean;
  isLocked: boolean;
}

export interface LockdownChannelSnapshot {
  channelId: string;
  sendMessages: boolean | null;
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

/** ロック前のチャンネル権限を初回のみ保存する。再試行で元の状態を上書きしない。 */
export async function saveLockdownChannelSnapshots(
  db: Db,
  guildId: string,
  snapshots: readonly LockdownChannelSnapshot[],
): Promise<void> {
  if (snapshots.length === 0) return;
  await db
    .insert(moderationLockdownChannelSnapshots)
    .values(snapshots.map((snapshot) => ({ guildId, ...snapshot })))
    .onConflictDoNothing();
}

export async function listLockdownChannelSnapshots(db: Db, guildId: string): Promise<LockdownChannelSnapshot[]> {
  return db
    .select({
      channelId: moderationLockdownChannelSnapshots.channelId,
      sendMessages: moderationLockdownChannelSnapshots.sendMessages,
    })
    .from(moderationLockdownChannelSnapshots)
    .where(eq(moderationLockdownChannelSnapshots.guildId, guildId))
    .orderBy(asc(moderationLockdownChannelSnapshots.channelId));
}

export async function clearLockdownChannelSnapshots(db: Db, guildId: string): Promise<void> {
  await db.delete(moderationLockdownChannelSnapshots).where(eq(moderationLockdownChannelSnapshots.guildId, guildId));
}
