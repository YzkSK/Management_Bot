import type { DomainEventBus } from "@management-bot/core";
import type { Db } from "@management-bot/db";
import {
  TEMP_VOICE_CONTROL_CREATE_REASON,
  TEMP_VOICE_CREATE_REASON,
  TEMP_VOICE_DELETE_REASON,
  suppressTempVoiceChannelLog,
} from "@management-bot/shared";
import { buildTempVoiceChannelName, canCreateTempVoiceInCategory } from "../domain/index.js";
import {
  deleteTempVoiceChannel,
  findOwnedTempVoiceChannelId,
  getTempVoiceConfig,
  insertTempVoiceChannel,
} from "../application/index.js";
import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  TextDisplayBuilder,
  type VoiceBasedChannel,
  type VoiceState,
} from "discord.js";

export interface HandleVoiceCreateDeps {
  db: Db;
  eventBus: DomainEventBus;
}

/**
 * newStateが作成用VC(temp_voice_configs.createChannelId)への入室かどうかを判定する。
 * 作成用VC自体は一時VCとして扱わない(この上に人が集まっても新規一時VCは作らない)。
 */
function isJoiningCreateChannel(newState: VoiceState, createChannelId: string): boolean {
  return newState.channelId === createChannelId;
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
    const existingChannel = guild.channels.cache.get(existingChannelId);
    if (existingChannel?.isVoiceBased()) await member.voice.setChannel(existingChannel);
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
    await voiceChannel.delete(TEMP_VOICE_DELETE_REASON).catch(() => {});
    throw error;
  }
  suppressTempVoiceChannelLog(controlChannel.id);

  try {
    await member.voice.setChannel(voiceChannel as VoiceBasedChannel);
  } catch (error) {
    await Promise.all([
      voiceChannel.delete(TEMP_VOICE_DELETE_REASON).catch(() => {}),
      controlChannel.delete(TEMP_VOICE_DELETE_REASON).catch(() => {}),
    ]);
    throw error;
  }

  await controlChannel
    .send({
      flags: MessageFlags.IsComponentsV2,
      components: [new TextDisplayBuilder().setContent("一時VCの制御パネルです。(操作ボタンは今後の実装で追加されます)")],
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
    await Promise.all([
      voiceChannel.delete(TEMP_VOICE_DELETE_REASON).catch(() => {}),
      controlChannel.delete(TEMP_VOICE_DELETE_REASON).catch(() => {}),
      deleteTempVoiceChannel(deps.db, voiceChannel.id).catch(() => {}),
    ]);
    throw error;
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
