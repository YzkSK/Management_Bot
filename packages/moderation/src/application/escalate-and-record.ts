import { randomUUID } from "node:crypto";
import type { Db } from "@management-bot/db";
import type {
  ModerationActionRecordedEvent,
  ModerationActionType,
  ModerationEscalationViolationType,
} from "@management-bot/shared";
import { decideEscalationAction, ESCALATION_STEPS } from "../domain/index.js";
import { getEscalationPreset } from "./escalation-settings.js";
import { getTotalStrikeCount, incrementStrike } from "./escalation-state.js";

/** 自動検知によるアクションであることを表すmoderatorId。人間の実行者は存在しない。 */
export const SYSTEM_MODERATOR_ID = "system";

export interface EscalateAndRecordDeps {
  db: Db;
  eventBus: { publish: (event: ModerationActionRecordedEvent) => Promise<void> };
}

export interface EscalationResult {
  violationType: ModerationEscalationViolationType;
  /** このエスカレーション判定時点の、violationTypeを跨いだ合計ストライク数(統一ストライクカウンター、#311)。 */
  strikeCount: number;
  actionType: ModerationActionType;
  /** actionType==="timeout"の場合のみ設定するタイムアウト時間(分)。5→10→30分と多段階化する(#322)。 */
  timeoutMinutes?: number;
  caseId: string;
  incident: MessageModerationIncident;
}

export interface MessageModerationIncident {
  violationType: ModerationEscalationViolationType;
  score: number | null;
  matchedMessageCount: number;
  deletedMessageCount: number;
  strikeCount: number;
}

export interface MessageIncidentInput {
  score: number | null;
  matchedMessageCount: number;
  deletedMessageCount: number;
}

/**
 * (guildId, userId, violationType)のstrikeを加算し、違反種別を跨いだ合計strikeCount
 * (統一ストライクカウンター、#311)に対してguild単位のエスカレーション段階を決定、
 * moderation.action.recordedイベントをpublishする。MessageCreate起点(detectAndEscalate)・
 * MessageCreate起点の処理から呼ばれる共通処理。
 * decideEscalationActionがnull(該当段階なし)を返した場合はnullを返す(アクション不要)。
 */
export async function escalateAndRecordStrike(
  deps: EscalateAndRecordDeps,
  guildId: string,
  userId: string,
  violationType: ModerationEscalationViolationType,
  createdAt: Date,
  incidentInput: MessageIncidentInput,
): Promise<EscalationResult | null> {
  // incrementStrike失敗時、呼び出し元のstrikeロック解放は行わない(既存detectAndEscalateと同じ理由:
  // 接続断絶等はcommit済みかどうか判別できず、誤って解放すると二重にstrikeが進みうるため)。
  await incrementStrike(deps.db, guildId, userId, violationType);
  const totalStrikeCount = await getTotalStrikeCount(deps.db, guildId, userId);
  const escalationPreset = await getEscalationPreset(deps.db, guildId);
  const step = decideEscalationAction(totalStrikeCount, ESCALATION_STEPS[escalationPreset]);
  if (step === null) return null;

  const caseId = randomUUID();
  const incident: MessageModerationIncident = { violationType, ...incidentInput, strikeCount: totalStrikeCount };
  await deps.eventBus.publish({
    type: "moderation.action.recorded",
    guildId,
    caseId,
    targetUserId: userId,
    moderatorId: SYSTEM_MODERATOR_ID,
    action: "create",
    actionType: step.actionType,
    timeoutMinutes: step.timeoutMinutes,
    incident,
    createdAt: createdAt.toISOString(),
  });

  return {
    violationType,
    strikeCount: totalStrikeCount,
    actionType: step.actionType,
    timeoutMinutes: step.timeoutMinutes,
    caseId,
    incident,
  };
}
