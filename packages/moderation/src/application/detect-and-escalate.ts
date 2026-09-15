import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import type { Db } from "@management-bot/db";
import type {
  ModerationActionRecordedEvent,
  ModerationActionType,
  ModerationViolationType,
} from "@management-bot/shared";
import { FLOOD_PRESETS, decideEscalationAction, hasFloodHit, isDuplicateContent } from "../domain/index.js";
import { incrementStrike } from "./escalation-state.js";
import { type BufferedMessage, claimMessage, pushAndReadBuffer } from "./message-buffer.js";
import { getEnabledThresholds } from "./thresholds.js";
import { isWhitelisted } from "./whitelist.js";

/** 自動検知によるアクションであることを表すmoderatorId。人間の実行者は存在しない。 */
export const SYSTEM_MODERATOR_ID = "system";

export interface IncomingMessage {
  guildId: string;
  userId: string;
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
  strikeCount: number;
  actionType: ModerationActionType;
  caseId: string;
}

/** 処理済みメッセージのSETNXマーカーをどれだけ保持するか。実際のwindowSecondsより十分長く取る。 */
const PROCESSED_MARKER_TTL_SECONDS = 3600;

function isDuplicateHit(buffer: readonly BufferedMessage[], message: IncomingMessage, threshold: number): boolean {
  const previous = buffer.find((m) => m.messageId !== message.messageId);
  if (!previous) return false;
  return isDuplicateContent(message.content, previous.content, threshold);
}

/**
 * メッセージ受信を起点に、ホワイトリスト判定→Redisバッファ更新→頻度/重複判定→
 * strikeCount更新→エスカレーションアクション決定→moderation.action.recorded発行までの一連のユースケース。
 * メッセージ削除・タイムアウト・キック/BANといった実際のDiscord API呼び出しは
 * 返り値のEscalationOutcomeを見た呼び出し側(discord層)の責務とする。
 * flood/duplicate_contentが同一メッセージで同時にヒットした場合、outcomesには両方の
 * violationTypeが含まれ得る。1メッセージに対する実際のDiscord API実行は1回に集約するなど
 * 呼び出し側で冪等に扱うこと。
 * 同じmessageIdでの再配送・ハンドラ再試行は(claimMessageにより)判定・strike加算をスキップし、
 * 空配列を返す。
 */
export async function detectAndEscalate(
  deps: DetectAndEscalateDeps,
  message: IncomingMessage,
): Promise<EscalationOutcome[]> {
  if (await isWhitelisted(deps.db, message.guildId, message.userId, message.roleIds)) {
    return [];
  }

  const claimed = await claimMessage(deps.redis, message.guildId, message.messageId, PROCESSED_MARKER_TTL_SECONDS);
  if (!claimed) return [];

  const thresholds = await getEnabledThresholds(deps.db, message.guildId);
  if (thresholds.length === 0) return [];

  const windowSeconds = Math.max(...thresholds.map((t) => FLOOD_PRESETS[t.preset].frequency.windowSeconds));
  const buffer = await pushAndReadBuffer(
    deps.redis,
    message.guildId,
    message.userId,
    { messageId: message.messageId, content: message.content, createdAt: message.createdAt },
    windowSeconds,
  );

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

    const strikeCount = await incrementStrike(deps.db, message.guildId, message.userId, threshold.violationType);
    const actionType = decideEscalationAction(strikeCount, preset.escalationSteps);
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

    outcomes.push({ violationType: threshold.violationType, strikeCount, actionType, caseId });
  }

  return outcomes;
}
