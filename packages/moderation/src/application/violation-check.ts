import type { ModerationPreset } from "@management-bot/shared";
import {
  FLOOD_PRESETS,
  LINK_SPAM_PRESETS,
  MENTION_SPAM_PRESETS,
  countMentions,
  findMatchingNgword,
  hasCumulativeMentionSpam,
  hasFloodHit,
  hasInviteLinkHit,
  hasLinkSpamHit,
  hasSingleMessageMentionSpam,
  isDuplicateContent,
  scoreLinkSpam,
} from "../domain/index.js";
import type { IncomingMessage } from "./detect-and-escalate.js";
import type { BufferedMessage } from "./message-buffer.js";
import type { NgwordRow } from "./ngwords.js";

/**
 * strikeロックのバースト抑制単位。"burst"はflood/duplicate_contentのような連投バースト全体での
 * 判定(バースト中は複数メッセージがヒットし得るが、ロック中でもバースト全体が次のhit時に
 * まとめて削除対象になる)。"single-shot"はngword/mention_spam/invite_linkのような
 * メッセージ単発判定(ロック中は検知トリガーメッセージ自身が削除対象からも漏れるため、
 * 呼び出し側で個別にlockedMessageIdsへ加える必要がある)。
 */
export type StrikeLockMode = "burst" | "single-shot";

/**
 * 1つのviolationTypeの判定結果。hitならstrikeロックに使うwindowSecondsと、
 * 削除対象メッセージIDを返す(flood/duplicate_contentはバースト全体、ngword/mention_spamは
 * 検知トリガーメッセージ自身、設計spec「削除対象」節の通り)。
 */
export interface ViolationCheck {
  hit: boolean;
  strikeLockWindowSeconds: number;
  strikeLockMode: StrikeLockMode;
  bufferedMessageIds: readonly string[];
}

/** NGワードはメッセージ単発判定のため、strikeロックのバースト抑制ウィンドウとして固定値を使う。 */
export const NGWORD_STRIKE_LOCK_WINDOW_SECONDS = 10;

/** 招待リンクもNGワードと同様メッセージ単発判定のため、同じ抑制ウィンドウを使う。 */
export const INVITE_LINK_STRIKE_LOCK_WINDOW_SECONDS = 10;

/** 外部リンク・宣伝のスコア判定(link_spam)もメッセージ単発判定のため、同じ抑制ウィンドウを使う。 */
export const LINK_SPAM_STRIKE_LOCK_WINDOW_SECONDS = 10;

/**
 * バッファ内の直前1件だけでなく、windowSeconds以内の直近バッファ全体(自分自身を除く)のいずれかと
 * 類似していれば重複投稿とみなす。直前1件のみの比較では`A → B → A`のような繰り返し投稿を
 * 検出できないため(改善案5.2節)。バッファ自体はRedisのTTLがpush毎に延長されwindowSecondsより
 * 古いメッセージも残り得るため、bufferedMessageIdsInWindowと同じ時間窓([message.createdAt -
 * windowSeconds, message.createdAt])で明示的に絞り込む(絞り込まないと、間に別メッセージを挟んで
 * TTLが延長され続けた古い投稿とも一致してしまう)。flood検知と同様、チャンネル横断で判定する設計は
 * 維持する(削除対象のみbufferedMessageIdsInWindowでチャンネル別に絞り込まれる)。
 */
function isDuplicateHit(
  buffer: readonly BufferedMessage[],
  message: IncomingMessage,
  threshold: number,
  windowSeconds: number,
): boolean {
  const windowStart = message.createdAt.getTime() - windowSeconds * 1000;
  const windowEnd = message.createdAt.getTime();
  return buffer
    .filter(
      (m) =>
        m.messageId !== message.messageId &&
        m.createdAt.getTime() >= windowStart &&
        m.createdAt.getTime() <= windowEnd,
    )
    .some((m) => isDuplicateContent(message.content, m.content, threshold));
}

/**
 * bufferedMessageIds(削除対象)を、検知トリガーメッセージと同一チャンネルかつ直近windowSeconds
 * 秒以内([windowStart, message.createdAt]の範囲)のものだけに絞り込む。バッファ自体は
 * チャンネル横断・時刻フィルタなしで同一ユーザーの直近メッセージを保持しているため
 * (連投・重複検知はチャンネルを跨いで動作させる設計)、削除対象だけはDiscordのbulkDeleteが
 * チャンネル単位でしか実行できないことを踏まえてここで絞り込む。上限側(message.createdAt以下)
 * も確認するのは、Redis Streams等での配送順の入れ替わりでバッファに検知トリガーより後に
 * 作成されたメッセージが紛れていても削除対象に含めないため(hasFloodHitの判定と同様の範囲)。
 */
export function bufferedMessageIdsInWindow(
  buffer: readonly BufferedMessage[],
  message: IncomingMessage,
  windowSeconds: number,
): readonly string[] {
  const windowStart = message.createdAt.getTime() - windowSeconds * 1000;
  const windowEnd = message.createdAt.getTime();
  return buffer
    .filter(
      (m) => m.channelId === message.channelId && m.createdAt.getTime() >= windowStart && m.createdAt.getTime() <= windowEnd,
    )
    .map((m) => m.messageId);
}

/** flood/duplicate_content判定。副作用なし(bufferは呼び出し側が事前に用意したものを渡す)。 */
export function checkFloodOrDuplicate(
  buffer: readonly BufferedMessage[],
  message: IncomingMessage,
  preset: ModerationPreset,
  violationType: "flood" | "duplicate_content",
): ViolationCheck {
  const floodPreset = FLOOD_PRESETS[preset];
  const hit =
    violationType === "flood"
      ? hasFloodHit(
          buffer.map((m) => m.createdAt),
          message.createdAt,
          floodPreset.frequency,
        )
      : isDuplicateHit(buffer, message, floodPreset.duplicateSimilarityThreshold, floodPreset.frequency.windowSeconds);
  return {
    hit,
    strikeLockWindowSeconds: floodPreset.frequency.windowSeconds,
    strikeLockMode: "burst",
    bufferedMessageIds: bufferedMessageIdsInWindow(buffer, message, floodPreset.frequency.windowSeconds),
  };
}

/** ngword判定。副作用なし。 */
export function checkNgword(message: IncomingMessage, ngwords: readonly NgwordRow[]): ViolationCheck {
  const hit = findMatchingNgword(message.content, ngwords) !== null;
  return {
    hit,
    strikeLockWindowSeconds: NGWORD_STRIKE_LOCK_WINDOW_SECONDS,
    strikeLockMode: "single-shot",
    bufferedMessageIds: [message.messageId],
  };
}

/**
 * mention_spam判定。mentionCounts(pushMentionCount+mentionCountsInWindowで時刻フィルタ済みの値)は
 * 呼び出し側が事前にRedisへ書き込んで用意したものを受け取るだけで、この関数自体はRedisに触れない
 * (副作用なし)。
 */
export function checkMentionSpam(
  message: IncomingMessage,
  preset: ModerationPreset,
  mentionCounts: readonly number[],
): ViolationCheck {
  const mentionPreset = MENTION_SPAM_PRESETS[preset];
  const mentionCount = countMentions(message.content);
  const singleHit = hasSingleMessageMentionSpam(mentionCount, mentionPreset.singleMessageThreshold);
  const cumulativeHit = hasCumulativeMentionSpam(mentionCounts, mentionPreset.cumulative.mentionThreshold);
  return {
    hit: singleHit || cumulativeHit,
    strikeLockWindowSeconds: mentionPreset.cumulative.windowSeconds,
    strikeLockMode: "single-shot",
    bufferedMessageIds: [message.messageId],
  };
}

/**
 * invite_link判定。resolvedGuildIds(招待コード→解決結果)は呼び出し側が事前に
 * resolveInviteGuildIdで解決したものを受け取るだけで、この関数はDiscord APIを呼ばない(副作用なし)。
 */
export function checkInviteLink(message: IncomingMessage, resolvedGuildIds: readonly (string | null)[]): ViolationCheck {
  const hit = resolvedGuildIds.some((resolvedGuildId) => {
    // 解決失敗(null)は安全側に倒し「他ギルドの招待」として扱う(spec: 自ギルド招待の除外)。
    const isOwnGuild = resolvedGuildId !== null && resolvedGuildId === message.guildId;
    return hasInviteLinkHit([isOwnGuild]);
  });
  return {
    hit,
    strikeLockWindowSeconds: INVITE_LINK_STRIKE_LOCK_WINDOW_SECONDS,
    strikeLockMode: "single-shot",
    bufferedMessageIds: [message.messageId],
  };
}

/**
 * link_spam判定(外部リンク・宣伝のスコア方式検知、改善案5.6節)。副作用なし。
 * 外部招待の検知はinvite_link専用とする(両方有効化時の二重strike加算を避けるため、
 * Codexレビュー指摘)。DBアクセス・Discord API呼び出しを伴わない。
 */
export function checkLinkSpam(message: IncomingMessage, preset: ModerationPreset): ViolationCheck {
  const msSinceJoined =
    message.joinedAt !== undefined ? message.createdAt.getTime() - message.joinedAt.getTime() : undefined;
  const score = scoreLinkSpam({ content: message.content, msSinceJoined });
  return {
    hit: hasLinkSpamHit(score, LINK_SPAM_PRESETS[preset].deleteThreshold),
    strikeLockWindowSeconds: LINK_SPAM_STRIKE_LOCK_WINDOW_SECONDS,
    strikeLockMode: "single-shot",
    bufferedMessageIds: [message.messageId],
  };
}
