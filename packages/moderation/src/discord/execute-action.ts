import type { Message } from "discord.js";
import type { EscalationOutcome } from "../application/index.js";

/** タイムアウトの固定時間。強度プリセットによらず一律とする(初期実装、過剰な設定項目を避ける)。 */
const TIMEOUT_DURATION_MS = 10 * 60 * 1000;

function reasonFor(outcome: EscalationOutcome): string {
  return `moderation: ${outcome.violationType} strike ${outcome.strikeCount} (case ${outcome.caseId})`;
}

const VIOLATION_LABELS = {
  flood: "短時間の連続投稿",
  duplicate_content: "同一・類似内容の繰り返し投稿",
} satisfies Record<EscalationOutcome["violationType"], string>;

const ACTION_LABELS = {
  warn: "警告",
  messageDelete: "メッセージ削除",
  timeout: "10分間のタイムアウト",
  kick: "サーバーからの退出",
  ban: "サーバーからのBAN",
  unban: "BAN解除",
} satisfies Record<EscalationOutcome["actionType"], string>;

function warnMessageFor(outcome: EscalationOutcome): string {
  return [
    "モデレーション通知",
    `検出内容: ${VIOLATION_LABELS[outcome.violationType]}`,
    `対応: ${ACTION_LABELS[outcome.actionType]}`,
    `現在のストライク数: ${outcome.strikeCount}`,
  ].join("\n");
}

/**
 * 対象ユーザーへDMで警告を送る。DMブロック等で失敗しても呼び出し元(gatewayイベントハンドラ)を
 * 止めないよう、ここでの例外は投げずログのみ行う。
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
 * 警告DMは処罰の成功後に送る(先に送ると、処罰APIが権限不足等で失敗した/memberが
 * 取得できず処罰自体が行われなかった場合に「適用されました」という誤通知になるため)。
 */
export async function executeEscalationAction(message: Message, outcome: EscalationOutcome): Promise<void> {
  try {
    switch (outcome.actionType) {
      case "warn":
        await sendWarningDm(message, outcome);
        return;
      case "unban":
        return;
      case "messageDelete":
        await message.delete();
        break;
      case "timeout":
        if (!message.member) return;
        await message.member.timeout(TIMEOUT_DURATION_MS, reasonFor(outcome));
        break;
      case "kick":
        if (!message.member) return;
        await message.member.kick(reasonFor(outcome));
        break;
      case "ban":
        if (!message.member) return;
        await message.member.ban({ reason: reasonFor(outcome) });
        break;
    }
  } catch (error) {
    console.error(`moderation: failed to execute action "${outcome.actionType}" for case ${outcome.caseId}`, error);
    return;
  }

  await sendWarningDm(message, outcome);
}
