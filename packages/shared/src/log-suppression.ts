/**
 * 一時VC・制御チャンネルのDiscord API操作(作成/削除/rename/lock⇄unlock/hide⇄unhide/人数制限/
 * 音質/個別許可拒否/オーナー移譲時の権限付け替え)が、既存の`channel`ログカテゴリ(全チャンネルの
 * create/update/deleteを自動記録)と`tempVoice`カテゴリで二重に記録・通知されるのを防ぐ(#413)。
 * DBを一切参照せず、reason文字列と短命メモリキャッシュのみで完結させる(temp-voice/loggingの
 * 両方から参照できるよう、機能パッケージに依存しない基盤パッケージ`shared`に置く)。
 */

export const TEMP_VOICE_CREATE_REASON = "management-bot:temp-voice:create";
export const TEMP_VOICE_CONTROL_CREATE_REASON = "management-bot:temp-voice:control-create";
export const TEMP_VOICE_DELETE_REASON = "management-bot:temp-voice:delete";
/** rename・lock⇄unlock・hide⇄unhide・人数制限・音質・個別許可拒否・オーナー移譲時の権限付け替えなど、あらゆる属性変更で共通して使う汎用reason。 */
export const TEMP_VOICE_UPDATE_REASON = "management-bot:temp-voice:update";

const TEMP_VOICE_AUDIT_REASONS = new Set<string>([
  TEMP_VOICE_CREATE_REASON,
  TEMP_VOICE_CONTROL_CREATE_REASON,
  TEMP_VOICE_DELETE_REASON,
  TEMP_VOICE_UPDATE_REASON,
]);

export function isTempVoiceAuditReason(reason: string | null | undefined): boolean {
  return reason !== null && reason !== undefined && TEMP_VOICE_AUDIT_REASONS.has(reason);
}

/**
 * 監査ログへの反映タイムラグに備えた即時抑制。プロセス内メモリのTTL付きMapで、
 * reasonオプションの指定とあわせた2段構えの対策になる(reason判定をすり抜けた場合のフォールバック)。
 */
const suppressedChannels = new Map<string, number>();

const DEFAULT_TTL_MS = 30_000;

export function suppressTempVoiceChannelLog(channelId: string, ttlMs: number = DEFAULT_TTL_MS): void {
  suppressedChannels.set(channelId, Date.now() + ttlMs);
}

/** チェック時に消費して削除する(1回のchannelCreate/Update/Deleteハンドラ呼び出しにつき1回だけ抑制する)。 */
export function shouldSuppressTempVoiceChannelLog(channelId: string): boolean {
  const expiresAt = suppressedChannels.get(channelId);
  if (expiresAt === undefined) return false;
  suppressedChannels.delete(channelId);
  return expiresAt > Date.now();
}
