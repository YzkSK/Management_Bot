import type { Db } from "@management-bot/db";
import { TEMP_VOICE_UPDATE_REASON, shouldSuppressTempVoiceChannelLog, suppressTempVoiceChannelLog } from "@management-bot/shared";
import { findTempVoiceChannel, listPermissionOverrides } from "../application/index.js";
import { ChannelType, PermissionFlagsBits, type Client, type VoiceBasedChannel } from "discord.js";

/**
 * オーナー移譲(手動: handle-transfer-owner.ts、自動: run-grace.ts、#410)で共通の、
 * 制御チャンネルの閲覧権限を付け替えるヘルパー。両者で同じロジックが重複していたため
 * 共通化した(codexレビュー指摘)。
 * 制御チャンネルがキャッシュに無い/テキストチャンネルでない場合は例外を投げる
 * (以前は黙ってreturnしていたため、権限付け替えをスキップしたままDB更新・イベント発行が
 * 進んでしまう不整合があった。codexレビュー指摘)。
 */
export async function editControlChannelViewer(
  client: Client,
  controlChannelId: string,
  targetId: string,
  allow: boolean | null,
): Promise<void> {
  const controlChannel = client.channels.cache.get(controlChannelId);
  if (controlChannel?.type !== ChannelType.GuildText) {
    throw new Error(`temp-voice: control channel ${controlChannelId} not found or not a text channel`);
  }
  suppressTempVoiceChannelLog(controlChannelId);
  try {
    await controlChannel.permissionOverwrites.edit(targetId, { ViewChannel: allow }, { reason: TEMP_VOICE_UPDATE_REASON });
  } catch (error) {
    shouldSuppressTempVoiceChannelLog(controlChannelId);
    throw error;
  }
}

/**
 * VC本体のオーナー個別オーバーライドを設定する(#441)。VC作成時はオーナーへの個別許可を
 * 一切付与しないため、オーナーがロック(Connect拒否)・非表示(ViewChannel拒否)を有効にすると
 * @everyoneのdenyがオーナー自身にも適用され、再入室・閲覧ができなくなってしまう
 * (issueで報告された「権限関連の変更にオーナーも影響を受ける」不具合)。
 * トグル操作・オーナー移譲のたびにオーナーへConnect/ViewChannelの個別allowを設定することで、
 * @everyoneの状態に関わらずオーナー自身は常にアクセスできるようにする。
 */
export async function grantOwnerVoiceAccess(voiceChannel: VoiceBasedChannel, ownerId: string): Promise<void> {
  suppressTempVoiceChannelLog(voiceChannel.id);
  try {
    await voiceChannel.permissionOverwrites.edit(
      ownerId,
      { Connect: true, ViewChannel: true },
      { reason: TEMP_VOICE_UPDATE_REASON },
    );
  } catch (error) {
    shouldSuppressTempVoiceChannelLog(voiceChannel.id);
    throw error;
  }
  // 非表示(@everyoneのViewChannel deny)でBot自身もVCを見られなくなり、「表示する」の
  // 権限編集がMissing Accessで失敗して戻せなくなるため、Botにも個別allowを付与する。
  // 付与済みなら余計なPATCH(と抑制トークンの消費ずれ)を避けるためスキップする。
  const botId = voiceChannel.guild.client.user.id;
  if (voiceChannel.permissionOverwrites.cache?.get(botId)?.allow.has(PermissionFlagsBits.ViewChannel)) return;
  suppressTempVoiceChannelLog(voiceChannel.id);
  try {
    await voiceChannel.permissionOverwrites.edit(
      botId,
      { ViewChannel: true },
      { reason: TEMP_VOICE_UPDATE_REASON },
    );
  } catch (error) {
    shouldSuppressTempVoiceChannelLog(voiceChannel.id);
    throw error;
  }
}

/**
 * オーナー移譲時、旧オーナーのVC本体個別オーバーライドを解除する(#441)。
 * ViewChannelはオーナー特権専用のキーなので常にnullへ戻すが、Connectはメンバー管理
 * (handle-remove-member.ts、個別許可・拒否)が同じキーを使って永続化しているため、
 * 無条件にnullへ戻すと旧オーナーに設定されていた個別許可・拒否設定を消してしまう
 * (codexレビュー指摘)。DBのtempVoicePermissionOverridesを再確認し、その設定を復元する。
 */
export async function revokeOwnerVoiceAccess(db: Db, voiceChannel: VoiceBasedChannel, previousOwnerId: string): Promise<void> {
  const overrides = await listPermissionOverrides(db, voiceChannel.id);
  const memberRule = overrides.find((override) => override.targetType === "user" && override.targetId === previousOwnerId);
  const connect = memberRule ? memberRule.state === "allow" : null;

  suppressTempVoiceChannelLog(voiceChannel.id);
  try {
    await voiceChannel.permissionOverwrites.edit(
      previousOwnerId,
      { Connect: connect, ViewChannel: null },
      { reason: TEMP_VOICE_UPDATE_REASON },
    );
  } catch (error) {
    shouldSuppressTempVoiceChannelLog(voiceChannel.id);
    throw error;
  }
}

/**
 * オーナー移譲のCAS敗北時、付与済みの閲覧権限をロールバックする前に呼ぶ(#410、codexレビュー指摘)。
 * 敗北した処理が権限を付与した候補者(candidateId)が、実は「勝者側の処理が同じ候補者を新オーナーに
 * 選んでいた」場合、無条件にViewChannelを剥奪すると正当な新オーナーの権限を奪ってしまう。
 * DBの現在のownerIdを再読込し、候補者が現オーナーでない場合のみ権限を剥奪する。
 */
export async function rollbackGrantedViewerIfNotOwner(
  db: Db,
  client: Client,
  channelId: string,
  controlChannelId: string,
  candidateId: string,
  voiceChannel?: VoiceBasedChannel,
): Promise<void> {
  const current = await findTempVoiceChannel(db, channelId);
  if (current?.ownerId === candidateId) return;
  await editControlChannelViewer(client, controlChannelId, candidateId, null);
  if (voiceChannel) await revokeOwnerVoiceAccess(db, voiceChannel, candidateId);
}
