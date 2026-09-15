import type { Message } from "discord.js";
import type { EscalationOutcome } from "../application/index.js";

/** タイムアウトの固定時間。強度プリセットによらず一律とする(初期実装、過剰な設定項目を避ける)。 */
const TIMEOUT_DURATION_MS = 10 * 60 * 1000;

function reasonFor(outcome: EscalationOutcome): string {
  return `moderation: ${outcome.violationType} strike ${outcome.strikeCount} (case ${outcome.caseId})`;
}

function warnMessageFor(outcome: EscalationOutcome): string {
  return `モデレーション通知: ${outcome.violationType}への違反によりアクション「${outcome.actionType}」が適用されました(strike ${outcome.strikeCount})。`;
}

/**
 * 対象ユーザーへDMで警告を送る。DMブロック等で失敗しても処罰アクション自体は継続するため、
 * ここでの例外は投げずログのみ行う。
 */
async function sendWarningDm(message: Message, outcome: EscalationOutcome): Promise<void> {
  try {
    await message.author.send(warnMessageFor(outcome));
  } catch (error) {
    console.error(`moderation: failed to send warning DM for case ${outcome.caseId}`, error);
  }
}

/**
 * エスカレーションアクションをDiscord API経由で実行する。
 * 削除対象は検知をトリガーしたメッセージ自身のみ(ウィンドウ内の遡及一括削除は行わない)。
 * 呼び出し元(gatewayイベントハンドラ)を止めないよう、失敗時は例外を投げずログのみ行う。
 * unban以外の全アクションで、実行前に対象ユーザーへ警告DMを送る。
 */
export async function executeEscalationAction(message: Message, outcome: EscalationOutcome): Promise<void> {
  if (outcome.actionType !== "unban") {
    await sendWarningDm(message, outcome);
  }
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
