import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import type { Db } from "@management-bot/db";
import type {
  ModerationActionRecordedEvent,
  ModerationActionType,
  ModerationPreset,
  ModerationViolationType,
} from "@management-bot/shared";
import {
  FLOOD_PRESETS,
  MENTION_SPAM_PRESETS,
  ESCALATION_STEPS,
  countMentions,
  decideEscalationAction,
  extractInviteCodes,
  findMatchingNgword,
  hasCumulativeMentionSpam,
  hasFloodHit,
  hasInviteLinkHit,
  hasSingleMessageMentionSpam,
  isDuplicateContent,
} from "../domain/index.js";
import { getEscalationPreset } from "./escalation-settings.js";
import { getTotalStrikeCount, incrementStrike } from "./escalation-state.js";
import {
  type BufferedMessage,
  claimAndPushMessage,
  markStrikeHitAndCheckNewBurst,
  mentionCountsInWindow,
  pushMentionCount,
} from "./message-buffer.js";
import { listNgwords } from "./ngwords.js";
import { getEnabledThresholds } from "./thresholds.js";
import { isWhitelisted } from "./whitelist.js";

/** NGワードはメッセージ単発判定のため、strikeロックのバースト抑制ウィンドウとして固定値を使う。 */
const NGWORD_STRIKE_LOCK_WINDOW_SECONDS = 10;

/** 招待リンクもNGワードと同様メッセージ単発判定のため、同じ抑制ウィンドウを使う。 */
const INVITE_LINK_STRIKE_LOCK_WINDOW_SECONDS = 10;

/** 自動検知によるアクションであることを表すmoderatorId。人間の実行者は存在しない。 */
export const SYSTEM_MODERATOR_ID = "system";

export interface IncomingMessage {
  guildId: string;
  userId: string;
  channelId: string;
  /** ホワイトリストのロール判定に使う、投稿者が持つロールID一覧。 */
  roleIds: readonly string[];
  messageId: string;
  content: string;
  createdAt: Date;
}

export interface DetectAndEscalateDeps {
  db: Db;
  redis: Redis;
  eventBus: { publish: (event: ModerationActionRecordedEvent) => Promise<void> };
  /**
   * 招待コードを解決し、遷移先のguildIdを返す(discord.jsのclient.fetchInvite相当)。
   * 無効なコード・Discord API障害等、解決に失敗した場合はnullを返す想定。
   */
  resolveInviteGuildId: (code: string) => Promise<string | null>;
}

export interface EscalationOutcome {
  violationType: ModerationViolationType;
  /** このエスカレーション判定時点の、violationTypeを跨いだ合計ストライク数(統一ストライクカウンター、#311)。 */
  strikeCount: number;
  actionType: ModerationActionType;
  /** actionType==="timeout"の場合のみ設定するタイムアウト時間(分)。5→10→30分と多段階化する(#322)。 */
  timeoutMinutes?: number;
  caseId: string;
  /**
   * この違反の判定に使ったRedisバッファのうち、検知トリガーメッセージと同一チャンネルかつ
   * 直近windowSeconds秒以内のメッセージID一覧(新しい順)。呼び出し側(executeEscalationAction)は
   * warn以降どのactionTypeでもこれらをまとめて削除対象にできる(連投バースト全体を削除する場合)。
   * バッファ自体は同一ユーザーのチャンネル横断・時刻フィルタなしの全件を保持しているため、
   * ここで同一チャンネル・時間窓に絞り込んでいる(別チャンネルのメッセージはchannel.bulkDelete
   * が対象にできず、時間窓外の古いメッセージは検知と無関係なため)。
   */
  bufferedMessageIds: readonly string[];
}

/** 処理済みメッセージのSETNXマーカーをどれだけ保持するか。実際のwindowSecondsより十分長く取る。 */
const PROCESSED_MARKER_TTL_SECONDS = 3600;

function isDuplicateHit(buffer: readonly BufferedMessage[], message: IncomingMessage, threshold: number): boolean {
  const previous = buffer.find((m) => m.messageId !== message.messageId);
  if (!previous) return false;
  return isDuplicateContent(message.content, previous.content, threshold);
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

/**
 * メッセージ受信を起点に、ホワイトリスト判定→Redisバッファ更新→頻度/重複判定→
 * strikeCount更新→エスカレーションアクション決定→moderation.action.recorded発行までの一連のユースケース。
 * メッセージ削除・タイムアウト・キック/BANといった実際のDiscord API呼び出しは
 * 返り値のEscalationOutcomeを見た呼び出し側(discord層)の責務とする。
 * flood/duplicate_contentが同一メッセージで同時にヒットした場合、outcomesには両方の
 * violationTypeが含まれ得る。1メッセージに対する実際のDiscord API実行は1回に集約するなど
 * 呼び出し側で冪等に扱うこと。
 * 同じmessageIdでの再配送・ハンドラ再試行は(claimAndPushMessageにより)判定・strike加算をスキップし、
 * 空配列を返す。
 */
/**
 * 1つのviolationTypeの判定結果。hitならstrikeロックに使うwindowSecondsと、
 * 削除対象メッセージIDを返す(flood/duplicate_contentはバースト全体、ngword/mention_spamは
 * 検知トリガーメッセージ自身、設計spec「削除対象」節の通り)。
 */
interface ViolationCheck {
  hit: boolean;
  strikeLockWindowSeconds: number;
  bufferedMessageIds: readonly string[];
}

async function checkViolation(
  deps: DetectAndEscalateDeps,
  message: IncomingMessage,
  buffer: readonly BufferedMessage[],
  violationType: ModerationViolationType,
  preset: ModerationPreset,
): Promise<ViolationCheck> {
  if (violationType === "flood" || violationType === "duplicate_content") {
    const floodPreset = FLOOD_PRESETS[preset];
    const hit =
      violationType === "flood"
        ? hasFloodHit(
            buffer.map((m) => m.createdAt),
            message.createdAt,
            floodPreset.frequency,
          )
        : isDuplicateHit(buffer, message, floodPreset.duplicateSimilarityThreshold);
    return {
      hit,
      strikeLockWindowSeconds: floodPreset.frequency.windowSeconds,
      bufferedMessageIds: bufferedMessageIdsInWindow(buffer, message, floodPreset.frequency.windowSeconds),
    };
  }

  if (violationType === "ngword") {
    const ngwords = await listNgwords(deps.db, message.guildId);
    const hit = findMatchingNgword(message.content, ngwords) !== null;
    return { hit, strikeLockWindowSeconds: NGWORD_STRIKE_LOCK_WINDOW_SECONDS, bufferedMessageIds: [message.messageId] };
  }

  if (violationType === "mention_spam") {
    const mentionPreset = MENTION_SPAM_PRESETS[preset];
    const mentionCount = countMentions(message.content);
    const singleHit = hasSingleMessageMentionSpam(mentionCount, mentionPreset.singleMessageThreshold);
    const mentionBuffer = await pushMentionCount(
      deps.redis,
      message.guildId,
      message.userId,
      mentionCount,
      message.createdAt,
      mentionPreset.cumulative.windowSeconds,
    );
    // TTLだけではwindowSeconds経過後もキー全体が消えるまでの間は古いエントリが混入するため、
    // hasFloodHitと同様にcreatedAtで時刻フィルタしてから合算する(Codexレビュー指摘)。
    const mentionCounts = mentionCountsInWindow(mentionBuffer, message.createdAt, mentionPreset.cumulative.windowSeconds);
    const cumulativeHit = hasCumulativeMentionSpam(mentionCounts, mentionPreset.cumulative.mentionThreshold);
    return {
      hit: singleHit || cumulativeHit,
      strikeLockWindowSeconds: mentionPreset.cumulative.windowSeconds,
      bufferedMessageIds: [message.messageId],
    };
  }

  if (violationType === "invite_link") {
    const codes = extractInviteCodes(message.content);
    // 悪意あるメッセージに大量の招待リンクを詰め込まれるとfetchInvite呼び出しが
    // 際限なく増えDiscord REST APIのレート制限を消費しうるため、逐次解決し
    // 他ギルドの招待(=ヒット確定)を1件見つけた時点で打ち切る(Codexレビュー指摘)。
    for (const code of codes) {
      const resolvedGuildId = await deps.resolveInviteGuildId(code);
      // 解決失敗(null)は安全側に倒し「他ギルドの招待」として扱う(spec: 自ギルド招待の除外)。
      const isOwnGuild = resolvedGuildId !== null && resolvedGuildId === message.guildId;
      if (hasInviteLinkHit([isOwnGuild])) {
        return { hit: true, strikeLockWindowSeconds: INVITE_LINK_STRIKE_LOCK_WINDOW_SECONDS, bufferedMessageIds: [message.messageId] };
      }
    }
    return { hit: false, strikeLockWindowSeconds: INVITE_LINK_STRIKE_LOCK_WINDOW_SECONDS, bufferedMessageIds: [message.messageId] };
  }

  throw new Error(`unhandled violationType: ${violationType satisfies never}`);
}

export async function detectAndEscalate(
  deps: DetectAndEscalateDeps,
  message: IncomingMessage,
): Promise<EscalationOutcome[]> {
  if (await isWhitelisted(deps.db, message.guildId, message.userId, message.roleIds)) {
    return [];
  }

  const thresholds = await getEnabledThresholds(deps.db, message.guildId);
  if (thresholds.length === 0) return [];

  const floodWindowSeconds = thresholds
    .filter((t) => t.violationType === "flood" || t.violationType === "duplicate_content")
    .map((t) => FLOOD_PRESETS[t.preset].frequency.windowSeconds);
  // flood/duplicate_content以外しか有効でないguildでも、直近メッセージの重複判定用に
  // 最低限のバッファウィンドウ(NGWORD_STRIKE_LOCK_WINDOW_SECONDS)は確保する。
  const windowSeconds = Math.max(NGWORD_STRIKE_LOCK_WINDOW_SECONDS, ...floodWindowSeconds);
  const buffer = await claimAndPushMessage(
    deps.redis,
    message.guildId,
    message.userId,
    {
      messageId: message.messageId,
      channelId: message.channelId,
      content: message.content,
      createdAt: message.createdAt,
    },
    PROCESSED_MARKER_TTL_SECONDS,
    windowSeconds,
  );
  if (buffer === null) return [];

  const outcomes: EscalationOutcome[] = [];
  for (const threshold of thresholds) {
    const check = await checkViolation(deps, message, buffer, threshold.violationType, threshold.preset);
    if (!check.hit) continue;

    const canStrike = await markStrikeHitAndCheckNewBurst(
      deps.redis,
      message.guildId,
      message.userId,
      threshold.violationType,
      check.strikeLockWindowSeconds,
    );
    if (!canStrike) continue;

    // incrementStrike失敗時、意図的にロックを解放しない。接続断絶やタイムアウト等の
    // エラーはSQL自体がcommit済みかどうか判別できないため、ここで解放して再試行を
    // 許すと(実はcommit済みだった場合に)二重にstrikeが進みうる。ロックはwindowSeconds
    // 経過後に自動的に次のstrikeを許可するため、最悪でも検知がその分遅れるだけで済む。
    await incrementStrike(deps.db, message.guildId, message.userId, threshold.violationType);
    // エスカレーション判定は違反種別を跨いだ合計strikeCountに対して行う(統一ストライクカウンター、#311)。
    // 検知条件(hasFloodHit/isDuplicateHit/findMatchingNgword/hasSingleMessageMentionSpam等)は
    // violationTypeごとのプリセットのまま、アクション決定(何回目でwarn/timeout/kick/ban)だけを
    // guild単位で統一する。
    const totalStrikeCount = await getTotalStrikeCount(deps.db, message.guildId, message.userId);
    const escalationPreset = await getEscalationPreset(deps.db, message.guildId);
    const step = decideEscalationAction(totalStrikeCount, ESCALATION_STEPS[escalationPreset]);
    if (step === null) continue;

    const caseId = randomUUID();
    await deps.eventBus.publish({
      type: "moderation.action.recorded",
      guildId: message.guildId,
      caseId,
      targetUserId: message.userId,
      moderatorId: SYSTEM_MODERATOR_ID,
      action: "create",
      actionType: step.actionType,
      timeoutMinutes: step.timeoutMinutes,
      createdAt: message.createdAt.toISOString(),
    });

    outcomes.push({
      violationType: threshold.violationType,
      strikeCount: totalStrikeCount,
      actionType: step.actionType,
      timeoutMinutes: step.timeoutMinutes,
      caseId,
      bufferedMessageIds: check.bufferedMessageIds,
    });
  }

  return outcomes;
}
