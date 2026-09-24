import type { DomainEventBus } from "@management-bot/core";
import type { Db } from "@management-bot/db";
import {
  TEMP_VOICE_CONTROL_CREATE_REASON,
  TEMP_VOICE_CREATE_REASON,
  TEMP_VOICE_DELETE_REASON,
  suppressTempVoiceChannelLog,
} from "@management-bot/shared";
import { buildTempVoiceChannelName, canCreateTempVoiceInCategory } from "../domain/index.js";
import { findOwnedTempVoiceChannelId, getTempVoiceConfig, insertTempVoiceChannel } from "../application/index.js";
import { buildControlPanelContainer, readTempVoiceState } from "./control-panel-message.js";
import type { VoiceSessionStore } from "./voice-session-store.js";
import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  TextDisplayBuilder,
  type Guild,
  type GuildMember,
  type VoiceBasedChannel,
  type VoiceState,
} from "discord.js";

export interface HandleVoiceCreateDeps {
  db: Db;
  eventBus: DomainEventBus;
  sessionStore: VoiceSessionStore;
}

/** ロールバック用のチャンネル削除。失敗しても処理は継続するが、孤児チャンネルとして残るためログには残す(codexレビュー指摘)。 */
async function deleteChannelForRollback(channel: { id: string; delete: (reason?: string) => Promise<unknown> }): Promise<void> {
  await channel.delete(TEMP_VOICE_DELETE_REASON).catch((error: unknown) => {
    console.error(`temp-voice: failed to roll back channel ${channel.id}`, error);
  });
}

/** temp_voice_channels(guild_id, owner_id)のunique制約違反(#406)かどうかを判定する。 */
function isOwnerUniqueViolation(error: unknown): boolean {
  const matches = (value: unknown): boolean => {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as { code?: unknown; constraint_name?: unknown };
    return candidate.code === "23505" && candidate.constraint_name === "temp_voice_channels_guild_id_owner_id_key";
  };
  return matches(error) || (error instanceof Error && matches(error.cause));
}

/**
 * newStateが作成用VC(temp_voice_configs.createChannelId)への入室かどうかを判定する。
 * 作成用VC自体は一時VCとして扱わない(この上に人が集まっても新規一時VCは作らない)。
 */
function isJoiningCreateChannel(newState: VoiceState, createChannelId: string): boolean {
  return newState.channelId === createChannelId;
}

/**
 * 既にオーナーVCを持つユーザーを、そのVCへ移動する。cacheにチャンネルが無い場合
 * (bot再起動直後等)はfetchでDiscord APIに問い合わせる(codexレビュー指摘)。
 * fetch自体が失敗した場合(削除済み等)は何もしない(#412のリコンサイル処理で解消する想定)。
 */
async function moveMemberToOwnedChannel(guild: Guild, member: GuildMember, channelId: string): Promise<void> {
  const cached = guild.channels.cache.get(channelId);
  const channel = cached ?? (await guild.channels.fetch(channelId).catch(() => null));
  if (channel?.isVoiceBased()) await member.voice.setChannel(channel);
}

/**
 * voiceStateUpdateのうち作成用VCへの入室を検知し、Join to Createの一連の流れを実行する(#407)。
 * 1. 既にオーナーVCを持つユーザーなら新規作成せず既存VCへ移動するだけにする(DB unique制約も保険)。
 * 2. カテゴリ上限(25組=50チャンネル)到達時は本人にのみ案内し作成用VCから動かさない。
 * 3-6. VC・制御チャンネルを作成し、入室者を移動、制御チャンネルへメッセージを送る。
 * 7. DBへINSERTする。unique制約違反(race conditionをすり抜けた場合)はDiscord側を削除してロールバックする。
 * 8. temp-voice.event.recorded(action=created)をXADDする。
 *
 * エラーハンドリング方針: DB変更より先にDiscord API呼び出しを行い、失敗時はDB変更をしないことで
 * 不整合な孤児レコードを防ぐ(issue #407)。
 */
export async function handleVoiceCreate(deps: HandleVoiceCreateDeps, newState: VoiceState): Promise<void> {
  const { guild, member } = newState;
  if (!member) return;

  const config = await getTempVoiceConfig(deps.db, guild.id);
  if (!config || !isJoiningCreateChannel(newState, config.createChannelId)) return;

  const existingChannelId = await findOwnedTempVoiceChannelId(deps.db, guild.id, member.id);
  if (existingChannelId) {
    await moveMemberToOwnedChannel(guild, member, existingChannelId);
    return;
  }

  const category = guild.channels.cache.get(config.categoryId);
  const currentChannelCountInCategory =
    category?.type === ChannelType.GuildCategory
      ? guild.channels.cache.filter((channel) => channel.parentId === config.categoryId).size
      : 0;
  if (!canCreateTempVoiceInCategory(currentChannelCountInCategory)) {
    await member
      .send({
        flags: MessageFlags.IsComponentsV2,
        components: [new TextDisplayBuilder().setContent("一時VCの作成上限に達しているため、新しいVCを作成できませんでした。")],
      })
      .catch(() => {
        // DMが閉じられている場合は握りつぶす(作成用VCから動かさないだけで十分)。
      });
    return;
  }

  const channelName = buildTempVoiceChannelName(config.nameTemplate, member.displayName);

  const voiceChannel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildVoice,
    parent: config.categoryId,
    userLimit: config.defaultUserLimit,
    bitrate: config.defaultBitrate ?? undefined,
    reason: TEMP_VOICE_CREATE_REASON,
  });
  suppressTempVoiceChannelLog(voiceChannel.id);
  // VC作成直後に追跡開始する(#414)。setChannel完了後まで遅らせると、その間に他ユーザーが
  // 偶然このVCへ入室した場合の入室記録を取りこぼす(codexレビュー指摘)。
  deps.sessionStore.startTrackingChannel(voiceChannel.id);

  let controlChannel;
  try {
    controlChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: config.categoryId,
      reason: TEMP_VOICE_CONTROL_CREATE_REASON,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: member.id, allow: [PermissionFlagsBits.ViewChannel] },
        { id: guild.members.me?.id ?? guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel] },
      ],
    });
  } catch (error) {
    deps.sessionStore.discardChannel(voiceChannel.id);
    await deleteChannelForRollback(voiceChannel);
    throw error;
  }
  suppressTempVoiceChannelLog(controlChannel.id);

  try {
    await member.voice.setChannel(voiceChannel as VoiceBasedChannel);
  } catch (error) {
    deps.sessionStore.discardChannel(voiceChannel.id);
    await Promise.all([deleteChannelForRollback(voiceChannel), deleteChannelForRollback(controlChannel)]);
    throw error;
  }

  // オーナーの入室をセッション開始として記録する(#414)。DB INSERT失敗によるロールバック時は
  // discardChannelで追跡ごと解除する(以下のcatch節参照)。
  deps.sessionStore.recordJoin(voiceChannel.id, member.id, new Date());

  await controlChannel
    .send({
      flags: MessageFlags.IsComponentsV2,
      components: [buildControlPanelContainer(voiceChannel.id, readTempVoiceState(voiceChannel as VoiceBasedChannel))],
    })
    .then((message) => message.pin().catch(() => {}))
    .catch(() => {
      // 制御メッセージ送信・ピン留めの失敗は致命的ではない(VC自体は使える)ため握りつぶす。
    });

  try {
    await insertTempVoiceChannel(deps.db, {
      channelId: voiceChannel.id,
      guildId: guild.id,
      controlChannelId: controlChannel.id,
      ownerId: member.id,
    });
  } catch (error) {
    // insertTempVoiceChannel自体が失敗しているため、行はそもそも存在しない(DB側のロールバックは不要)。
    deps.sessionStore.discardChannel(voiceChannel.id);
    await Promise.all([deleteChannelForRollback(voiceChannel), deleteChannelForRollback(controlChannel)]);
    if (!isOwnerUniqueViolation(error)) throw error;
    // race condition(#407)によりguildId+ownerIdのunique制約(#406)に競り負けた場合、
    // このユーザーは既に別のvoiceStateUpdateで自分のVCを作成済みの可能性が高い。
    // 敗者側のVCを削除しただけではユーザーが取り残されるため、勝者VCへ移動を試みる
    // (codexレビュー指摘)。勝者VCがまだ無い/取得できない場合は#412のリコンサイル処理に委ねる。
    const winnerChannelId = await findOwnedTempVoiceChannelId(deps.db, guild.id, member.id);
    if (winnerChannelId) await moveMemberToOwnedChannel(guild, member, winnerChannelId);
    return;
  }

  await deps.eventBus.publish({
    type: "temp-voice.event.recorded",
    action: "created",
    guildId: guild.id,
    channelId: voiceChannel.id,
    controlChannelId: controlChannel.id,
    ownerId: member.id,
    ownerName: member.displayName,
    createdAt: new Date().toISOString(),
  });
}
