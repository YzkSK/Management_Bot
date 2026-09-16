import { ContainerBuilder, MessageFlags, SeparatorSpacingSize, TextDisplayBuilder } from "discord.js";
import type { Message } from "discord.js";
import type { EscalationOutcome } from "../application/index.js";

/** logging側(log-entry-presentation.ts)のnegativeアクセントと同一値。モデレーション系カードの警告色を統一する。 */
const ACCENT_COLOR_NEGATIVE = 0xf23f42;

/** タイムアウトの固定時間。強度プリセットによらず一律とする(初期実装、過剰な設定項目を避ける)。 */
const TIMEOUT_DURATION_MS = 10 * 60 * 1000;

/** strikeCountは違反種別を跨いだ合計ストライク数(統一ストライクカウンター、#311)。 */
function reasonFor(outcome: EscalationOutcome): string {
  return `moderation: ${outcome.violationType} total strike ${outcome.strikeCount} (case ${outcome.caseId})`;
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

/** logging側のContainerカード(log-entry-container.ts)と体裁を揃えたDM警告カード。 */
function buildWarningContainer(outcome: EscalationOutcome): ContainerBuilder {
  const bodyLines = [
    `**検出内容**: ${VIOLATION_LABELS[outcome.violationType]}`,
    `**対応**: ${ACTION_LABELS[outcome.actionType]}`,
    `**現在のストライク数**: ${outcome.strikeCount}`,
  ];
  return new ContainerBuilder()
    .setAccentColor(ACCENT_COLOR_NEGATIVE)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent("### 🛑 モデレーション通知"))
    .addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(bodyLines.join("\n")));
}

/**
 * 対象ユーザーへDMで警告を送る。DMブロック等で失敗しても呼び出し元(gatewayイベントハンドラ)を
 * 止めないよう、ここでの例外は投げずログのみ行う。
 */
async function sendWarningDm(message: Message, outcome: EscalationOutcome): Promise<void> {
  try {
    await message.author.send({
      components: [buildWarningContainer(outcome)],
      flags: MessageFlags.IsComponentsV2,
    });
  } catch (error) {
    console.error(`moderation: failed to send warning DM for case ${outcome.caseId}`, error);
  }
}

/**
 * bufferedMessageIds(検知の元になった直近windowSeconds秒間・同一チャンネルのメッセージ)を
 * まとめて削除する。Discordのbulk delete APIは2〜100件でしか実行できないため、
 * 1件しかない場合(例: 検知がチャンネルを跨いで成立し、対象チャンネルへの投稿が
 * トリガーメッセージのみだった場合)は検知をトリガーしたメッセージ自身をmessage.delete()で
 * 個別に削除する。チャンネルがbulkDeleteに対応していない(DM等)場合も同様に個別削除する。
 * bulkDeleteは14日を超えるメッセージを含むと失敗するが、bufferedMessageIdsは
 * windowSeconds(最大でも数十秒)以内のメッセージのみのため実質問題にならない。
 * 失敗時は例外を投げる(呼び出し側の責務でハンドリングする)。
 */
async function deleteBufferedMessages(message: Message, bufferedMessageIds: readonly string[]): Promise<void> {
  const channel = message.channel;
  if ("bulkDelete" in channel && bufferedMessageIds.length >= 2) {
    await channel.bulkDelete(bufferedMessageIds);
    return;
  }
  await message.delete();
}

/**
 * warn/timeout/kick/ban実行時の付随処理として削除を行う版。削除はあくまで連投バーストの
 * 後始末であり本体アクションではないため、Manage Messages権限が無い等で削除だけが失敗しても、
 * 後続の処罰(member.timeout()/kick()/ban())や警告DM送信の実行を止めないよう例外を握りつぶす
 * (Codexレビュー指摘: 削除失敗が処罰実行をブロックする退行を防ぐ)。
 */
async function deleteBufferedMessagesSafely(message: Message, outcome: EscalationOutcome): Promise<void> {
  try {
    await deleteBufferedMessages(message, outcome.bufferedMessageIds);
  } catch (error) {
    console.error(`moderation: failed to delete buffered messages for case ${outcome.caseId}`, error);
  }
}

/**
 * エスカレーションアクションをDiscord API経由で実行する。
 * bufferedMessageIds(検知の元になったバースト全体)は、strikeCountが進んでtimeout/kick/banに
 * 到達した場合でも常に削除する。連投が続く限りstrikeCountはmessageDeleteの段階を過ぎて
 * timeout以降に進むため、削除をmessageDeleteアクション時だけに限定すると、それ以降に
 * 投稿され続けたバーストメッセージが一切削除されなくなる(元の連投が放置される)。
 * 呼び出し元(gatewayイベントハンドラ)を止めないよう、失敗時は例外を投げずログのみ行う。
 * 警告DMは処罰の成功後に送る(先に送ると、処罰APIが権限不足等で失敗した/memberが
 * 取得できず処罰自体が行われなかった場合に「適用されました」という誤通知になるため)。
 */
export async function executeEscalationAction(message: Message, outcome: EscalationOutcome): Promise<void> {
  try {
    switch (outcome.actionType) {
      case "warn":
        await deleteBufferedMessagesSafely(message, outcome);
        await sendWarningDm(message, outcome);
        return;
      case "unban":
        return;
      case "messageDelete":
        await deleteBufferedMessages(message, outcome.bufferedMessageIds);
        break;
      case "timeout":
        if (!message.member) return;
        await deleteBufferedMessagesSafely(message, outcome);
        await message.member.timeout(TIMEOUT_DURATION_MS, reasonFor(outcome));
        break;
      case "kick":
        if (!message.member) return;
        await deleteBufferedMessagesSafely(message, outcome);
        await message.member.kick(reasonFor(outcome));
        break;
      case "ban":
        if (!message.member) return;
        await deleteBufferedMessagesSafely(message, outcome);
        await message.member.ban({ reason: reasonFor(outcome) });
        break;
    }
  } catch (error) {
    console.error(`moderation: failed to execute action "${outcome.actionType}" for case ${outcome.caseId}`, error);
    return;
  }

  await sendWarningDm(message, outcome);
}
