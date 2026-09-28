import { asc, eq, ne } from "drizzle-orm";
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

/** 指定したカラムだけを書き込むupsert。行がなければ残りのカラムはDBのデフォルト値で作る。 */
async function upsertLockdownFields(db: Db, guildId: string, patch: Partial<LockdownSettings>): Promise<void> {
  await db
    .insert(moderationLockdownSettings)
    .values({ guildId, ...patch })
    .onConflictDoUpdate({
      target: moderationLockdownSettings.guildId,
      set: { ...patch, updatedAt: new Date() },
    });
}

export async function setAutoLockdownOnRaid(db: Db, guildId: string, enabled: boolean): Promise<void> {
  await upsertLockdownFields(db, guildId, { autoLockdownOnRaid: enabled });
}

export async function setLockdownRequested(db: Db, guildId: string, requestedLocked: boolean): Promise<void> {
  await upsertLockdownFields(db, guildId, { requestedLocked });
}

export async function markLockdownApplied(db: Db, guildId: string, isLocked: boolean): Promise<void> {
  await upsertLockdownFields(db, guildId, { isLocked });
}

/** Bot 再起動中に変更された、Discord 側へ未反映のロックダウン設定を返す。 */
export async function listLockdownsNeedingSynchronization(db: Db): Promise<string[]> {
  const rows = await db
    .select({ guildId: moderationLockdownSettings.guildId })
    .from(moderationLockdownSettings)
    .where(ne(moderationLockdownSettings.requestedLocked, moderationLockdownSettings.isLocked));

  return rows.map((row) => row.guildId);
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
