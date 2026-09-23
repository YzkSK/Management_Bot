/** Discordのチャンネル名文字数上限。 */
const CHANNEL_NAME_MAX_LENGTH = 100;

/**
 * nameTemplate(tempVoiceConfigs.nameTemplate)の{username}プレースホルダーを入室者の表示名に
 * 置換してVC名を生成する(#406/#407)。展開後100文字を超える場合は切り詰める。
 */
export function buildTempVoiceChannelName(nameTemplate: string, username: string): string {
  const expanded = nameTemplate.replaceAll("{username}", username);
  return expanded.length > CHANNEL_NAME_MAX_LENGTH ? expanded.slice(0, CHANNEL_NAME_MAX_LENGTH) : expanded;
}
