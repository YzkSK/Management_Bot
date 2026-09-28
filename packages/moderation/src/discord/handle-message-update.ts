import type { Message } from "discord.js";
import { detectAndEscalateOnEdit, mostSevere, type DetectAndEscalateDeps } from "../application/index.js";
import { deleteBufferedMessages, executeEscalationAction } from "./execute-action.js";
import { publishEscalationResolutions } from "./publish-escalation-resolutions.js";

/**
 * messageUpdateイベントを受けて、編集後の内容でngword/invite_link/link_spamのみ再検知する
 * (改善案7.1節)。投稿時は無害だったメッセージに、編集でNGワード・招待リンク・宣伝文等を
 * 後から仕込む回避を防ぐ。flood/duplicate_content/mention_spamは対象外
 * (detectAndEscalateOnEditのコメント参照)。
 * ngword/invite_link/link_spamが同一メッセージで同時にヒットした場合、Discord側への処罰
 * (timeout/kick/ban)実行はhandleMessageCreateと同様に最も重いもの1件へ集約する
 * (二重実行を防ぐ、Codexレビュー指摘)。集約されなかった側もresult="skipped"でresolveする。
 *
 * handleMessageCreateと同様、自Bot自身の投稿のみ除外しBot・Webhookの編集も検知対象に
 * 含める(改善案7.2節)。
 */
export async function handleMessageUpdate(deps: DetectAndEscalateDeps, message: Message): Promise<void> {
  // client.userが未確定の場合はfail-closed(handleMessageCreateと同じ理由、Codexレビュー指摘)。
  const selfBotId = message.client.user?.id;
  if (!selfBotId || message.author.id === selfBotId) return;
  if (!message.guild) return;

  // 編集で違反化したケースの記録日時は元投稿時刻ではなく編集時刻にする
  // (createdAtのままだと、過去の投稿を今編集した場合にログ・ケースの日時が過去になり
  // 時系列やソートが誤る、Codexレビュー指摘)。editedAtが取れない場合は現在時刻を使う。
  const editedAt = message.editedAt ?? new Date();

  const { outcomes, lockedMessageIds } = await detectAndEscalateOnEdit(deps, {
    guildId: message.guild.id,
    userId: message.author.id,
    channelId: message.channelId,
    roleIds: message.member ? [...message.member.roles.cache.keys()] : [],
    messageId: message.id,
    content: message.content,
    createdAt: editedAt,
    joinedAt: message.member?.joinedAt ?? undefined,
  });

  if (outcomes.length === 0) {
    if (lockedMessageIds.length > 0) {
      try {
        await deleteBufferedMessages(message, lockedMessageIds);
      } catch (error) {
        console.error("moderation: failed to delete locked messages (edit)", error);
      }
    }
    return;
  }

  const target = mostSevere(outcomes);
  const execResult = await executeEscalationAction(message, target);
  await publishEscalationResolutions(deps, {
    guildId: message.guild.id,
    targetUserId: message.author.id,
    target,
    execResult,
    outcomes,
  });
}
