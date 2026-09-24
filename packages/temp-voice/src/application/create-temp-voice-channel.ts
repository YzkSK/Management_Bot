import type { Db } from "@management-bot/db";
import { tempVoiceChannels, tempVoiceConfigs } from "@management-bot/db";
import { and, eq, isNotNull, isNull, lt, type TablesRelationalConfig } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";

export interface TempVoiceConfig {
  guildId: string;
  /**
   * createChannelId/categoryIdは作成用VC・カテゴリの実体がDiscord上で削除された場合、
   * #412の消失検知によりnullに戻る(Dashboardでは「未設定」と同じ表示になる)。
   * 行自体は存在するが未設定、というケースを表すためnullableにしている。
   */
  createChannelId: string | null;
  categoryId: string | null;
  nameTemplate: string;
  defaultUserLimit: number;
  defaultBitrate: number | null;
}

/** ギルドの一時VC設定を取得する。未設定(temp-voice機能が未セットアップ)ならnull。 */
export async function getTempVoiceConfig(db: Db, guildId: string): Promise<TempVoiceConfig | null> {
  const [row] = await db.select().from(tempVoiceConfigs).where(eq(tempVoiceConfigs.guildId, guildId));
  return row ?? null;
}

/**
 * 起動時リコンサイル(#412)の対象ギルド一覧を返す。temp_voice_configsに行がある
 * (=機能セットアップ済み)ギルドと、temp_voice_channelsに一時VCが残っているギルドの
 * 両方を対象にする(configだけ削除されVCだけ残る異常系もカバーする)。
 */
export async function listTempVoiceGuildIds(db: Db): Promise<string[]> {
  const [configGuildIds, channelGuildIds] = await Promise.all([
    db.selectDistinct({ guildId: tempVoiceConfigs.guildId }).from(tempVoiceConfigs),
    db.selectDistinct({ guildId: tempVoiceChannels.guildId }).from(tempVoiceChannels),
  ]);
  return [...new Set([...configGuildIds.map((r) => r.guildId), ...channelGuildIds.map((r) => r.guildId)])];
}

/**
 * 作成用VC・カテゴリのどちらかがDiscord上で削除されたことを検知した際に呼ぶ(#412)。
 * 両方をnullに戻すことで、Dashboardでは「未設定」と同じ扱いになり「自動でセットアップ」
 * ボタンが再表示される。名前テンプレート・デフォルト人数制限・デフォルト音質は保持する。
 */
export async function clearTempVoiceCreateChannel(db: Db, guildId: string): Promise<void> {
  await db
    .update(tempVoiceConfigs)
    .set({ createChannelId: null, categoryId: null })
    .where(eq(tempVoiceConfigs.guildId, guildId));
}

/** ユーザーが既にオーナーとして持っている一時VCのchannelIdを返す。無ければnull(1ユーザー1VCまでの事前チェック用)。 */
export async function findOwnedTempVoiceChannelId(db: Db, guildId: string, ownerId: string): Promise<string | null> {
  const [match] = await db
    .select({ channelId: tempVoiceChannels.channelId })
    .from(tempVoiceChannels)
    .where(and(eq(tempVoiceChannels.guildId, guildId), eq(tempVoiceChannels.ownerId, ownerId)));
  return match?.channelId ?? null;
}

export interface InsertTempVoiceChannelInput {
  channelId: string;
  guildId: string;
  controlChannelId: string;
  ownerId: string;
}

/**
 * Discord側のVC・制御チャンネル作成が完了した後に呼ぶ。guildId+ownerIdのunique制約
 * (#406)がrace conditionをすり抜けた多重作成を弾く。制約違反時は呼び出し元
 * (registerVoiceCreateHandler)がDiscord側の孤児チャンネルを削除してロールバックする。
 */
export async function insertTempVoiceChannel(db: Db, input: InsertTempVoiceChannelInput): Promise<void> {
  await db.insert(tempVoiceChannels).values(input);
}

/** channelId主キーのため、ロールバック(手順7のunique制約違反時)はchannelId指定で削除する。 */
export async function deleteTempVoiceChannel(db: Db, channelId: string): Promise<void> {
  await db.delete(tempVoiceChannels).where(eq(tempVoiceChannels.channelId, channelId));
}

export interface TempVoiceChannelRow {
  channelId: string;
  guildId: string;
  controlChannelId: string;
  ownerId: string;
}

export interface TempVoiceChannelReconcileRow extends TempVoiceChannelRow {
  gracePeriodOwnerId: string | null;
  gracePeriodEndsAt: Date | null;
}

/**
 * 起動時リコンサイル(#412)向け。ギルド内の一時VC全行(猶予情報含む)を取得する。
 * 片肺状態の解消・削除タイマー再セット・セッション再構築・猶予未登録検知の対象列挙に使う。
 */
export async function listTempVoiceChannelsByGuild(db: Db, guildId: string): Promise<TempVoiceChannelReconcileRow[]> {
  return db
    .select({
      channelId: tempVoiceChannels.channelId,
      guildId: tempVoiceChannels.guildId,
      controlChannelId: tempVoiceChannels.controlChannelId,
      ownerId: tempVoiceChannels.ownerId,
      gracePeriodOwnerId: tempVoiceChannels.gracePeriodOwnerId,
      gracePeriodEndsAt: tempVoiceChannels.gracePeriodEndsAt,
    })
    .from(tempVoiceChannels)
    .where(eq(tempVoiceChannels.guildId, guildId));
}

/**
 * 起動時リコンサイル(#412)専用: bot停止中にオーナーが退出し猶予登録処理自体が行われなかった
 * ケースを補正する。startGracePeriod(通常の退出検知用、expectedOwnerIdでCAS)と異なり、
 * 「現在ownerIdが誰であっても、gracePeriodEndsAtがまだ設定されていなければ設定する」条件で
 * 更新する(bot再起動を跨ぐと退出検知イベント自体が発火しないため、ownerIdの事前一致チェックは
 * 不要かつ不可能)。
 */
export async function startGracePeriodIfMissing(db: Db, channelId: string, ownerId: string, gracePeriodEndsAt: Date): Promise<void> {
  await db
    .update(tempVoiceChannels)
    .set({ gracePeriodOwnerId: ownerId, gracePeriodEndsAt })
    .where(and(eq(tempVoiceChannels.channelId, channelId), isNull(tempVoiceChannels.gracePeriodEndsAt)));
}

/** 制御パネルのボタン/モーダル処理(#408)のオーナーチェック・controlChannelId解決に使う。無ければnull。 */
export async function findTempVoiceChannel(db: Db, channelId: string): Promise<TempVoiceChannelRow | null> {
  const [row] = await db
    .select({
      channelId: tempVoiceChannels.channelId,
      guildId: tempVoiceChannels.guildId,
      controlChannelId: tempVoiceChannels.controlChannelId,
      ownerId: tempVoiceChannels.ownerId,
    })
    .from(tempVoiceChannels)
    .where(eq(tempVoiceChannels.channelId, channelId));
  return row ?? null;
}

/** guildId+ownerIdのunique制約(#406)違反かどうかを判定する(voice-create.tsのisOwnerUniqueViolationと同じ判定)。 */
function isOwnerUniqueViolation(error: unknown): boolean {
  const matches = (value: unknown): boolean => {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as { code?: unknown; constraint_name?: unknown };
    return candidate.code === "23505" && candidate.constraint_name === "temp_voice_channels_guild_id_owner_id_key";
  };
  return matches(error) || (error instanceof Error && matches(error.cause));
}

export type TransferTempVoiceOwnerResult = "committed" | "lostRace" | "newOwnerAlreadyOwnsChannel";

/**
 * オーナーを更新し、猶予情報(gracePeriodOwnerId/gracePeriodEndsAt)を同時にクリアする(#410)。
 * 手動移譲(#410)から呼ぶcompare-and-swap版。`WHERE channelId AND ownerId = expectedOwnerId`で
 * 更新することで、手動移譲と自動再割当cronが同一チャンネルに対して同時に走った場合の
 * 二重移譲・イベント重複を防ぐ(codexレビュー指摘)。戻り値"lostRace"は、読み取り後に
 * 既に他の処理でownerIdが変わっている(競合に負けた)ことを意味する。
 * 戻り値"newOwnerAlreadyOwnsChannel"は、移譲先が別の一時VCのオーナーになっており
 * guildId+ownerIdのunique制約(#406)に違反したことを意味する(codexレビュー指摘:
 * この事前チェックが無いと、権限付与済みのまま例外が伝播しロールバックされない)。
 * どちらの場合も呼び出し元は付与済みの制御チャンネル閲覧権限をロールバックしユーザーにエラー表示する。
 * decayStrikes(@management-bot/moderation)と同じ理由で、PgDatabase(通常のDb)・
 * PgTransaction(db.transaction内のtx)のどちらでも受け取れるようジェネリクスで受ける。
 */
export async function transferTempVoiceOwner<TFullSchema extends Record<string, unknown>, TSchema extends TablesRelationalConfig>(
  db: PgDatabase<PostgresJsQueryResultHKT, TFullSchema, TSchema>,
  channelId: string,
  expectedOwnerId: string,
  newOwnerId: string,
): Promise<TransferTempVoiceOwnerResult> {
  try {
    const updated = await db
      .update(tempVoiceChannels)
      .set({ ownerId: newOwnerId, gracePeriodOwnerId: null, gracePeriodEndsAt: null })
      .where(and(eq(tempVoiceChannels.channelId, channelId), eq(tempVoiceChannels.ownerId, expectedOwnerId)))
      .returning({ channelId: tempVoiceChannels.channelId });
    return updated.length > 0 ? "committed" : "lostRace";
  } catch (error) {
    if (isOwnerUniqueViolation(error)) return "newOwnerAlreadyOwnsChannel";
    throw error;
  }
}

/**
 * 猶予期限切れによる自動再割当(#410)から呼ぶcompare-and-swap版。手動移譲の完了と競合した場合、
 * `WHERE gracePeriodOwnerId = expectedGracePeriodOwnerId AND gracePeriodEndsAt = expectedGracePeriodEndsAt`
 * が満たされず0行更新となり、cron側は何もしない(codexレビュー指摘: 手動移譲後に遅れて到達した
 * cronが上書きするのを防ぐ)。期限値そのものも条件に含めるのは、オーナーが猶予中に一度再入室して
 * 猶予解除→即座に再退出して新しい猶予が始まった場合、gracePeriodOwnerId(同一ユーザー)だけを
 * 条件にすると新しい猶予の期限切れを待たずに誤って確定してしまうため(codexレビュー指摘)。
 * unique制約違反時の扱いはtransferTempVoiceOwnerと同じ。
 */
export async function completeExpiredGracePeriod<TFullSchema extends Record<string, unknown>, TSchema extends TablesRelationalConfig>(
  db: PgDatabase<PostgresJsQueryResultHKT, TFullSchema, TSchema>,
  channelId: string,
  expectedGracePeriodOwnerId: string,
  expectedGracePeriodEndsAt: Date,
  newOwnerId: string,
): Promise<TransferTempVoiceOwnerResult> {
  try {
    const updated = await db
      .update(tempVoiceChannels)
      .set({ ownerId: newOwnerId, gracePeriodOwnerId: null, gracePeriodEndsAt: null })
      .where(
        and(
          eq(tempVoiceChannels.channelId, channelId),
          eq(tempVoiceChannels.gracePeriodOwnerId, expectedGracePeriodOwnerId),
          eq(tempVoiceChannels.gracePeriodEndsAt, expectedGracePeriodEndsAt),
        ),
      )
      .returning({ channelId: tempVoiceChannels.channelId });
    return updated.length > 0 ? "committed" : "lostRace";
  } catch (error) {
    if (isOwnerUniqueViolation(error)) return "newOwnerAlreadyOwnsChannel";
    throw error;
  }
}

/**
 * オーナー退出を検知した時点で呼ぶ。猶予期間(オーナー不在10分)を開始する(#410)。
 * `WHERE ownerId = expectedOwnerId`で、退出検知の直前に手動移譲が完了していた場合
 * (このユーザーは既にオーナーでない)は何もしない(codexレビュー指摘)。
 */
export async function startGracePeriod(
  db: Db,
  channelId: string,
  expectedOwnerId: string,
  gracePeriodEndsAt: Date,
): Promise<void> {
  await db
    .update(tempVoiceChannels)
    .set({ gracePeriodOwnerId: expectedOwnerId, gracePeriodEndsAt })
    .where(and(eq(tempVoiceChannels.channelId, channelId), eq(tempVoiceChannels.ownerId, expectedOwnerId)));
}

/**
 * オーナーが猶予期間内に同じVCへ再入室した際に呼ぶ。猶予情報をクリアしオーナーのまま継続する(#410)。
 * `WHERE gracePeriodOwnerId = expectedOwnerId`で、既に猶予期限切れcronが処理済み(オーナー変更済み)
 * なら何もしない(codexレビュー指摘: 再入室と自動再割当がほぼ同時に起きた場合の競合)。
 */
export async function clearGracePeriod(db: Db, channelId: string, expectedOwnerId: string): Promise<void> {
  await db
    .update(tempVoiceChannels)
    .set({ gracePeriodOwnerId: null, gracePeriodEndsAt: null })
    .where(and(eq(tempVoiceChannels.channelId, channelId), eq(tempVoiceChannels.gracePeriodOwnerId, expectedOwnerId)));
}

export interface ExpiredGracePeriodChannelRow {
  channelId: string;
  guildId: string;
  controlChannelId: string;
  gracePeriodOwnerId: string;
  gracePeriodEndsAt: Date;
}

/**
 * 猶予期限が切れたVCを検索する(#410、apps/bot内の自動再割当cronから呼ぶ)。
 * updateTempVoiceOwnerと同じ理由でPgDatabase/PgTransactionどちらでも受け取れるようにする。
 */
export async function findExpiredGracePeriodChannels<TFullSchema extends Record<string, unknown>, TSchema extends TablesRelationalConfig>(
  db: PgDatabase<PostgresJsQueryResultHKT, TFullSchema, TSchema>,
  now: Date,
): Promise<ExpiredGracePeriodChannelRow[]> {
  const rows = await db
    .select({
      channelId: tempVoiceChannels.channelId,
      guildId: tempVoiceChannels.guildId,
      controlChannelId: tempVoiceChannels.controlChannelId,
      gracePeriodOwnerId: tempVoiceChannels.gracePeriodOwnerId,
      gracePeriodEndsAt: tempVoiceChannels.gracePeriodEndsAt,
    })
    .from(tempVoiceChannels)
    .where(and(isNotNull(tempVoiceChannels.gracePeriodEndsAt), lt(tempVoiceChannels.gracePeriodEndsAt, now)));
  return rows.filter(
    (row): row is ExpiredGracePeriodChannelRow => row.gracePeriodOwnerId !== null && row.gracePeriodEndsAt !== null,
  );
}
