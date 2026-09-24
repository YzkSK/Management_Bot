import type { DomainEventBus } from "@management-bot/core";
import type { Db } from "@management-bot/db";
import { TEMP_VOICE_DELETE_REASON, suppressTempVoiceChannelLog } from "@management-bot/shared";
import { DiscordAPIError, RESTJSONErrorCodes, type Client, type Guild, type GuildBasedChannel } from "discord.js";
import {
  clearTempVoiceCreateChannel,
  deleteTempVoiceChannel,
  getTempVoiceConfig,
  listTempVoiceChannelsByGuild,
  listTempVoiceGuildIds,
  startGracePeriodIfMissing,
  type TempVoiceChannelReconcileRow,
} from "../application/index.js";
import { EmptyChannelDeletionScheduler, finalizeDeletion } from "./handle-empty-channel.js";
import type { VoiceSessionStore } from "./voice-session-store.js";

/** オーナー不在からVC自動再割当までの猶予期間(#410、discord/index.tsのOWNER_GRACE_PERIOD_MSと同値)。 */
const OWNER_GRACE_PERIOD_MS = 10 * 60 * 1000;
/** 無人VC削除の猶予(#411のDEFAULT_GRACE_MSと同値)。 */
const EMPTY_CHANNEL_GRACE_MS = 30_000;

export interface ReconcileDeps {
  db: Db;
  client: Client;
  eventBus: DomainEventBus;
  sessionStore: VoiceSessionStore;
  emptyChannelScheduler: EmptyChannelDeletionScheduler;
}

/**
 * "found"(取得できた)/"notFound"(Discordが404 Unknown Channelを返した=確実に存在しない)/
 * "indeterminate"(429や権限エラー等の一時的な失敗で判定できない)の3状態を区別する
 * (codexレビュー指摘: fetch().catch(() => null)だと一時的な失敗まで「削除済み」扱いになり、
 * 誤ってDB行・チャンネルを削除したり設定をリセットしてしまう)。呼び出し元はindeterminateの
 * 場合、そのギルドの当該チャンネルについて破壊的な操作(削除・リセット)をスキップする。
 */
export type ChannelLookup = { state: "found"; channel: GuildBasedChannel } | { state: "notFound" } | { state: "indeterminate" };

export async function lookupChannel(guild: Guild, channelId: string): Promise<ChannelLookup> {
  const cached = guild.channels.cache.get(channelId);
  if (cached) return { state: "found", channel: cached };
  try {
    const fetched = await guild.channels.fetch(channelId);
    return fetched ? { state: "found", channel: fetched } : { state: "notFound" };
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownChannel) return { state: "notFound" };
    console.error(`temp-voice: reconcile failed to fetch channel ${channelId} (treating as indeterminate, not deleted)`, error);
    return { state: "indeterminate" };
  }
}

/**
 * 1件の一時VC行を検証・補正する(#412、手順2)。
 * - 片肺(VC・制御チャンネルのどちらか一方だけ存在しない): 残っている方も削除しDB行(CASCADE含む)を削除する。
 * - 両方存在し無人: 削除猶予タイマーを再セットする(即時削除にはしない)。
 * - 両方存在し在室あり: 起動時刻を入室時刻としてセッションを再構築する。ownerIdが不在かつ
 *   猶予未登録なら猶予を開始する。
 */
async function reconcileChannel(deps: ReconcileDeps, guild: Guild, row: TempVoiceChannelReconcileRow, now: Date): Promise<void> {
  const [voiceLookup, controlLookup] = await Promise.all([
    lookupChannel(guild, row.channelId),
    lookupChannel(guild, row.controlChannelId),
  ]);
  // どちらか一方でも判定不能(indeterminate)なら、この行については何もせず次回起動時の
  // リコンサイルに委ねる(codexレビュー指摘: 一時的なAPI障害を「片肺」と誤判定して
  // 正常なチャンネル・DB行を削除してしまうのを防ぐ)。
  if (voiceLookup.state === "indeterminate" || controlLookup.state === "indeterminate") return;

  const voiceExists = voiceLookup.state === "found" && voiceLookup.channel.isVoiceBased();
  const controlExists = controlLookup.state === "found";

  if (!voiceExists || !controlExists) {
    // 片肺状態。残っている方を削除し、DB行を削除する(CASCADEでpermission overridesも消える)。
    suppressTempVoiceChannelLog(row.channelId);
    suppressTempVoiceChannelLog(row.controlChannelId);
    await Promise.all([
      voiceExists && voiceLookup.state === "found"
        ? voiceLookup.channel.delete(TEMP_VOICE_DELETE_REASON).catch((error: unknown) => {
            console.error(`temp-voice: reconcile failed to delete orphaned voice channel ${row.channelId}`, error);
          })
        : Promise.resolve(),
      controlExists && controlLookup.state === "found"
        ? controlLookup.channel.delete(TEMP_VOICE_DELETE_REASON).catch((error: unknown) => {
            console.error(`temp-voice: reconcile failed to delete orphaned control channel ${row.controlChannelId}`, error);
          })
        : Promise.resolve(),
    ]);
    await deleteTempVoiceChannel(deps.db, row.channelId);
    await deps.eventBus.publish({
      type: "temp-voice.event.recorded",
      action: "deleted",
      guildId: row.guildId,
      channelId: row.channelId,
      ownerId: row.ownerId,
      createdAt: now.toISOString(),
    });
    return;
  }

  // 両方存在する。以降の入退室イベントで正しく追跡できるよう、まず追跡対象として登録する。
  deps.sessionStore.startTrackingChannel(row.channelId);
  const members = voiceLookup.state === "found" && voiceLookup.channel.isVoiceBased() ? [...voiceLookup.channel.members.values()] : [];

  if (members.length === 0) {
    // 無人。即時削除はせず通常の削除猶予タイマーを再セットする(手順2、再入室の可能性への配慮)。
    deps.emptyChannelScheduler.schedule(
      row.channelId,
      (generation) => {
        finalizeDeletion(
          { db: deps.db, eventBus: deps.eventBus, sessionStore: deps.sessionStore },
          deps.emptyChannelScheduler,
          guild,
          row.channelId,
          generation,
        ).catch((error: unknown) => {
          console.error(`temp-voice: reconcile failed to finalize deletion for channel ${row.channelId}`, error);
        });
      },
      EMPTY_CHANNEL_GRACE_MS,
    );
    return;
  }

  // 在室あり。正確な入室時刻は失われているため起動時刻を入室時刻として登録し直す
  // (以降の退室時、起動時刻からの経過分だけvoice.session.endedとして計測できる)。
  for (const member of members) deps.sessionStore.recordJoin(row.channelId, member.id, now);

  // bot停止中にオーナーが退出し、猶予登録処理自体が行われなかったケースを補正する。
  const ownerPresent = members.some((member) => member.id === row.ownerId);
  if (!ownerPresent && row.gracePeriodEndsAt === null) {
    await startGracePeriodIfMissing(deps.db, row.channelId, row.ownerId, new Date(now.getTime() + OWNER_GRACE_PERIOD_MS));
  }
}

/**
 * 作成用VC・カテゴリの実体がDiscord上に存在するか確認し、どちらか一方でも無ければ
 * temp_voice_configsをリセットする(#412、手順4。設定チャンネル消失検知の起動時の保険)。
 */
async function reconcileConfig(deps: ReconcileDeps, guild: Guild, guildId: string): Promise<void> {
  const config = await getTempVoiceConfig(deps.db, guildId);
  if (!config?.createChannelId || !config.categoryId) return;

  const [createChannelLookup, categoryLookup] = await Promise.all([
    lookupChannel(guild, config.createChannelId),
    lookupChannel(guild, config.categoryId),
  ]);
  // 判定不能(indeterminate)なら一時的なAPI障害の可能性があるためリセットしない
  // (codexレビュー指摘、reconcileChannelと同じ理由)。
  if (createChannelLookup.state === "indeterminate" || categoryLookup.state === "indeterminate") return;
  if (createChannelLookup.state === "notFound" || categoryLookup.state === "notFound") {
    await clearTempVoiceCreateChannel(deps.db, guildId);
  }
}

/**
 * 一時VC作成用カテゴリ配下にDB未登録のチャンネルが無いか確認し、あれば警告ログのみ出す
 * (#412、手順3)。誤ってユーザーの意図しない通常チャンネルを削除するリスクを避けるため
 * 自動削除はしない。
 */
async function warnOrphanedChannels(deps: ReconcileDeps, guild: Guild, guildId: string, knownChannelIds: ReadonlySet<string>): Promise<void> {
  const config = await getTempVoiceConfig(deps.db, guildId);
  if (!config?.categoryId) return;
  const categoryId = config.categoryId;
  const orphans = guild.channels.cache.filter(
    (channel) => channel.parentId === categoryId && channel.id !== config.createChannelId && !knownChannelIds.has(channel.id),
  );
  for (const orphan of orphans.values()) {
    console.warn(`temp-voice: reconcile found orphaned channel ${orphan.id} (guild ${guildId}) under temp-voice category with no DB record`);
  }
}

/** 1ギルド分のリコンサイルを実行する(#412)。 */
export async function reconcileGuild(deps: ReconcileDeps, guildId: string, now: Date = new Date()): Promise<void> {
  const guild = deps.client.guilds.cache.get(guildId) ?? (await deps.client.guilds.fetch(guildId).catch(() => null));
  if (!guild) return;

  const rows = await listTempVoiceChannelsByGuild(deps.db, guildId);
  for (const row of rows) {
    await reconcileChannel(deps, guild, row, now).catch((error: unknown) => {
      console.error(`temp-voice: reconcile failed for channel ${row.channelId} (guild ${guildId})`, error);
    });
  }

  await reconcileConfig(deps, guild, guildId).catch((error: unknown) => {
    console.error(`temp-voice: reconcile failed to verify create channel/category for guild ${guildId}`, error);
  });

  // 孤児判定の既知ID集合には制御チャンネルも含める(codexレビュー指摘: controlChannelIdを
  // 含めないと、カテゴリ配下にある正常な制御チャンネルが毎回「孤児」と誤警告されてしまう)。
  const knownChannelIds = new Set(rows.flatMap((row) => [row.channelId, row.controlChannelId]));
  await warnOrphanedChannels(deps, guild, guildId, knownChannelIds).catch((error: unknown) => {
    console.error(`temp-voice: reconcile failed to scan for orphaned channels in guild ${guildId}`, error);
  });
}

/**
 * 起動時リコンサイル(#412)。botプロセス起動時の1回のみ実行する(稼働中はvoiceStateUpdate等の
 * イベントで状態が正しく保たれる前提のため、定期チェックはスコープ外)。
 * Discord APIレート制限に配慮し、ギルドを並列実行せず順次処理する(issue本文の方針)。
 */
export async function runStartupReconcile(deps: ReconcileDeps): Promise<void> {
  const guildIds = await listTempVoiceGuildIds(deps.db);
  for (const guildId of guildIds) {
    await reconcileGuild(deps, guildId).catch((error: unknown) => {
      console.error(`temp-voice: startup reconcile failed for guild ${guildId}`, error);
    });
  }
}
