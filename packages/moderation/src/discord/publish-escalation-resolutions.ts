import { SYSTEM_MODERATOR_ID, type DetectAndEscalateDeps, type EscalationOutcome } from "../application/index.js";
import type { ExecuteActionResult } from "./execute-action.js";

export interface EscalationResolutions {
  guildId: string;
  targetUserId: string;
  /** mostSevereで選ばれ、Discord側で実行した1件。 */
  target: EscalationOutcome;
  execResult: ExecuteActionResult;
  /** 同一メッセージでヒットした全outcome(targetを含む)。 */
  outcomes: readonly EscalationOutcome[];
}

/**
 * 実行したtargetの結果をresolveとしてpublishし、targetに集約されず実行されなかった側の
 * createイベント(既にpublish済み)にも、未解決のまま残さないようresult="skipped"の
 * resolveをpublishする(#350、codexレビュー指摘)。
 * handleMessageCreate/handleMessageUpdateで共通の発行処理。
 */
export async function publishEscalationResolutions(
  deps: Pick<DetectAndEscalateDeps, "eventBus">,
  { guildId, targetUserId, target, execResult, outcomes }: EscalationResolutions,
): Promise<void> {
  await deps.eventBus.publish({
    type: "moderation.action.recorded",
    guildId,
    caseId: target.caseId,
    targetUserId,
    moderatorId: SYSTEM_MODERATOR_ID,
    action: "resolve",
    actionType: target.actionType,
    timeoutMinutes: target.timeoutMinutes,
    incident: target.incident,
    result: execResult.result,
    failureCode: execResult.failureCode,
    createdAt: new Date().toISOString(),
  });

  for (const outcome of outcomes) {
    if (outcome.caseId === target.caseId) continue;
    await deps.eventBus.publish({
      type: "moderation.action.recorded",
      guildId,
      caseId: outcome.caseId,
      targetUserId,
      moderatorId: SYSTEM_MODERATOR_ID,
      action: "resolve",
      actionType: outcome.actionType,
      timeoutMinutes: outcome.timeoutMinutes,
      incident: outcome.incident,
      result: "skipped",
      createdAt: new Date().toISOString(),
    });
  }
}
