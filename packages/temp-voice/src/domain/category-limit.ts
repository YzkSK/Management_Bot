/** Discord仕様上の1カテゴリあたりの実チャンネル数上限。 */
const DISCORD_CATEGORY_CHANNEL_LIMIT = 50;

/** 一時VC1組(VC+制御テキストチャンネル)が消費するチャンネル数。 */
const CHANNELS_PER_TEMP_VOICE = 2;

/** カテゴリ配下チャンネル数上限(25組=50チャンネル)。 */
export const MAX_TEMP_VOICE_PAIRS_PER_CATEGORY = DISCORD_CATEGORY_CHANNEL_LIMIT / CHANNELS_PER_TEMP_VOICE;

/** categoryId配下の現在の実チャンネル数を渡して、新規1組(VC+制御チャンネル)を作成する余地があるか判定する。 */
export function canCreateTempVoiceInCategory(currentChannelCountInCategory: number): boolean {
  return currentChannelCountInCategory + CHANNELS_PER_TEMP_VOICE <= DISCORD_CATEGORY_CHANNEL_LIMIT;
}
