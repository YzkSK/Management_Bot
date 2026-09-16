import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import type { Db } from "@management-bot/db";
import type {
  ModerationActionRecordedEvent,
  ModerationActionType,
  ModerationViolationType,
} from "@management-bot/shared";
import { FLOOD_PRESETS, ESCALATION_STEPS, decideEscalationAction, hasFloodHit, isDuplicateContent } from "../domain/index.js";
import { getEscalationPreset } from "./escalation-settings.js";
import { getTotalStrikeCount, incrementStrike } from "./escalation-state.js";
import { type BufferedMessage, claimAndPushMessage, markStrikeHitAndCheckNewBurst } from "./message-buffer.js";
import { getEnabledThresholds } from "./thresholds.js";
import { isWhitelisted } from "./whitelist.js";

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
}

export interface EscalationOutcome {
  violationType: ModerationViolationType;
  /** このエスカレーション判定時点の、violationTypeを跨いだ合計ストライク数(統一ストライクカウンター、#311)。 */
  strikeCount: number;
  actionType: ModerationActionType;
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
export async function detectAndEscalate(
  deps: DetectAndEscalateDeps,
  message: IncomingMessage,
): Promise<EscalationOutcome[]> {
  if (await isWhitelisted(deps.db, message.guildId, message.userId, message.roleIds)) {
    return [];
  }

  const thresholds = await getEnabledThresholds(deps.db, message.guildId);
  if (thresholds.length === 0) return [];

  const windowSeconds = Math.max(...thresholds.map((t) => FLOOD_PRESETS[t.preset].frequency.windowSeconds));
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
    const preset = FLOOD_PRESETS[threshold.preset];
    const hit =
      threshold.violationType === "flood"
        ? hasFloodHit(
            buffer.map((m) => m.createdAt),
            message.createdAt,
            preset.frequency,
          )
        : isDuplicateHit(buffer, message, preset.duplicateSimilarityThreshold);
    if (!hit) continue;

    const canStrike = await markStrikeHitAndCheckNewBurst(
      deps.redis,
      message.guildId,
      message.userId,
      threshold.violationType,
      preset.frequency.windowSeconds,
    );
    if (!canStrike) continue;

    // incrementStrike失敗時、意図的にロックを解放しない。接続断絶やタイムアウト等の
    // エラーはSQL自体がcommit済みかどうか判別できないため、ここで解放して再試行を
    // 許すと(実はcommit済みだった場合に)二重にstrikeが進みうる。ロックはwindowSeconds
    // 経過後に自動的に次のstrikeを許可するため、最悪でも検知がその分遅れるだけで済む。
    await incrementStrike(deps.db, message.guildId, message.userId, threshold.violationType);
    // エスカレーション判定は違反種別を跨いだ合計strikeCountに対して行う(統一ストライクカウンター、#311)。
    // 検知条件(hasFloodHit/isDuplicateHitの閾値)はviolationTypeごとのプリセットのまま、
    // アクション決定(何回目でwarn/timeout/kick/ban)だけをguild単位で統一する。
    const totalStrikeCount = await getTotalStrikeCount(deps.db, message.guildId, message.userId);
    const escalationPreset = await getEscalationPreset(deps.db, message.guildId);
    const actionType = decideEscalationAction(totalStrikeCount, ESCALATION_STEPS[escalationPreset]);
    if (actionType === null) continue;

    const caseId = randomUUID();
    await deps.eventBus.publish({
      type: "moderation.action.recorded",
      guildId: message.guildId,
      caseId,
      targetUserId: message.userId,
      moderatorId: SYSTEM_MODERATOR_ID,
      action: "create",
      actionType,
      createdAt: message.createdAt.toISOString(),
    });

    outcomes.push({
      violationType: threshold.violationType,
      strikeCount: totalStrikeCount,
      actionType,
      caseId,
      bufferedMessageIds: bufferedMessageIdsInWindow(buffer, message, preset.frequency.windowSeconds),
    });
  }

  return outcomes;
}
