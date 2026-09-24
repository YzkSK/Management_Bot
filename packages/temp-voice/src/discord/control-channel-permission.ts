import { TEMP_VOICE_UPDATE_REASON, shouldSuppressTempVoiceChannelLog, suppressTempVoiceChannelLog } from "@management-bot/shared";
import { ChannelType, type Client } from "discord.js";

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
