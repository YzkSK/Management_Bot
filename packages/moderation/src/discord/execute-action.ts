import type { Message } from "discord.js";
import type { EscalationOutcome } from "../application/index.js";

/** タイムアウトの固定時間。強度プリセットによらず一律とする(初期実装、過剰な設定項目を避ける)。 */
const TIMEOUT_DURATION_MS = 10 * 60 * 1000;

function reasonFor(outcome: EscalationOutcome): string {
  return `moderation: ${outcome.violationType} strike ${outcome.strikeCount} (case ${outcome.caseId})`;
}

/**
 * エスカレーションアクションをDiscord API経由で実行する。
 * 削除対象は検知をトリガーしたメッセージ自身のみ(ウィンドウ内の遡及一括削除は行わない)。
 * 呼び出し元(gatewayイベントハンドラ)を止めないよう、失敗時は例外を投げずログのみ行う。
 */
export async function executeEscalationAction(message: Message, outcome: EscalationOutcome): Promise<void> {
  try {
    switch (outcome.actionType) {
      case "warn":
      case "unban":
        return;
      case "messageDelete":
        await message.delete();
        return;
      case "timeout":
        await message.member?.timeout(TIMEOUT_DURATION_MS, reasonFor(outcome));
        return;
      case "kick":
        await message.member?.kick(reasonFor(outcome));
        return;
      case "ban":
        await message.member?.ban({ reason: reasonFor(outcome) });
        return;
    }
  } catch (error) {
    console.error(`moderation: failed to execute action "${outcome.actionType}" for case ${outcome.caseId}`, error);
  }
}
