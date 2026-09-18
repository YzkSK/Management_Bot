import type { Redis } from "ioredis";
import type { Db } from "@management-bot/db";
import type { ModerationActionRecordedEvent } from "@management-bot/shared";
import { detectRaid, hasNewAccountGuardHit, isWhitelistMatch, NEW_ACCOUNT_GUARD_PRESETS, RAID_PRESETS, type RaidSeverity } from "../domain/index.js";
import { escalateAndRecordStrike, SYSTEM_MODERATOR_ID } from "./escalate-and-record.js";
import type { ModerationConfigCache } from "./moderation-config-cache.js";
import { markRaidHitAndCheckNewIncident, pushRaidEntry } from "./raid-buffer.js";
import { getRaidState, incrementRaidIncident } from "./raid-state.js";

export interface IncomingGuildMember {
  guildId: string;
  userId: string;
  /** ホワイトリストのロール判定に使う、入室者が持つロールID一覧(付与済みロールがあれば)。 */
  roleIds: readonly string[];
  accountCreatedAt: Date;
  joinedAt: Date;
}

export interface GuildMemberAddDeps {
  db: Db;
  redis: Redis;
  eventBus: { publish: (event: ModerationActionRecordedEvent) => Promise<void> };
  /** whitelist/thresholdsをguild単位でまとめてTTLキャッシュする(#352)。detect-and-escalate.tsと同じ仕組み。 */
  configCache: ModerationConfigCache;
}

export interface RaidHitResult {
  /** レイド一括アクション(timeout)の対象ユーザーID一覧(ホワイトリスト除外済み)。 */
  targetUserIds: readonly string[];
  severity: RaidSeverity;
  timeoutMinutes: number;
  caseId: string;
  incidentCount: number;
}

export interface GuildMemberAddResult {
  /** レイド(集団)ヒット時のみ設定。対象ユーザー全員への一括timeout実行は呼び出し側(discord層)の責務。 */
  raidHit: RaidHitResult | null;
  /** new_account_guard(単体)ヒット時のみ設定。既存の共通エスカレーション処理の結果をそのまま返す。 */
  newAccountGuardOutcome: Awaited<ReturnType<typeof escalateAndRecordStrike>>;
}

/**
 * GuildMemberAdd受信時のユースケース。ホワイトリスト対象は判定(レイドの人数カウント・
 * new_account_guard判定)自体から除外する(設計spec「ホワイトリスト」節)。
 * raid(集団)判定とnew_account_guard(単体)判定は互いに独立しており、両方ヒットしうる
 * (例: 新規アカウントの大量入室で両方ヒット)。
 */
export async function handleGuildMemberAdd(
  deps: GuildMemberAddDeps,
  member: IncomingGuildMember,
): Promise<GuildMemberAddResult> {
  const snapshot = await deps.configCache.get(deps.db, member.guildId);

  if (isWhitelistMatch(snapshot.whitelist, member.guildId, member.userId, member.roleIds)) {
    return { raidHit: null, newAccountGuardOutcome: null };
  }

  const raidThreshold = snapshot.enabledThresholds.find((t) => t.violationType === "raid");
  const guardThreshold = snapshot.enabledThresholds.find((t) => t.violationType === "new_account_guard");

  const raidHit = raidThreshold ? await detectRaidHit(deps, member, raidThreshold.preset) : null;

  const newAccountGuardOutcome = guardThreshold
    ? await detectNewAccountGuardHit(deps, member, guardThreshold.preset)
    : null;

  return { raidHit, newAccountGuardOutcome };
}

/**
 * 過去にこのguildで検知したレイド件数(moderation_raid_state.incidentCount、UPSERT前の値)。
 * 1件以上(=今回が2件目以降)なら、新規アカウント比率に関わらずseverityをhighへ引き上げる
 * (繰り返しレイドを受けているギルドはより悪質とみなす、設計spec「incidentCountを
 * 強度プリセットのエスカレーション判断に使用」節、Codexレビュー指摘対応)。
 */
const REPEAT_INCIDENT_SEVERITY_THRESHOLD = 1;

function escalateSeverityByIncidentCount(severity: RaidSeverity, priorIncidentCount: number): RaidSeverity {
  return priorIncidentCount >= REPEAT_INCIDENT_SEVERITY_THRESHOLD ? "high" : severity;
}

async function detectRaidHit(
  deps: GuildMemberAddDeps,
  member: IncomingGuildMember,
  preset: keyof typeof RAID_PRESETS,
): Promise<RaidHitResult | null> {
  const config = RAID_PRESETS[preset];
  const isNewAccount =
    member.joinedAt.getTime() - member.accountCreatedAt.getTime() <= config.newAccountMaxAgeDays * 24 * 60 * 60 * 1000;

  const buffer = await pushRaidEntry(
    deps.redis,
    member.guildId,
    { userId: member.userId, joinedAt: member.joinedAt, isNewAccount },
    config.window.windowSeconds,
  );

  const result = detectRaid(buffer, member.joinedAt, config);
  if (!result.hit) return null;

  // 閾値到達後も入室が続く限り毎回ヒットし続けるため、windowSecondsに1回だけ新規インシデントとして
  // 扱う(このロックを通過した呼び出しのみが実際にインシデントを作る、Codexレビュー指摘対応)。
  const isNewIncident = await markRaidHitAndCheckNewIncident(deps.redis, member.guildId, config.window.windowSeconds);
  if (!isNewIncident) return null;

  const priorState = await getRaidState(deps.db, member.guildId);
  const severity = escalateSeverityByIncidentCount(result.severity, priorState?.incidentCount ?? 0);
  const incidentCount = await incrementRaidIncident(deps.db, member.guildId, member.joinedAt);
  const caseId = crypto.randomUUID();
  const timeoutMinutes = config.timeoutMinutes[severity];

  // レイド一括timeoutは対象ユーザーごとに同一caseIdでイベントをpublishし、logging側で
  // 同一インシデントとして相関できるようにする(設計spec「ログ連携」節)。
  for (const targetUserId of result.targetUserIds) {
    await deps.eventBus.publish({
      type: "moderation.action.recorded",
      guildId: member.guildId,
      caseId,
      targetUserId,
      moderatorId: SYSTEM_MODERATOR_ID,
      action: "create",
      actionType: "timeout",
      timeoutMinutes,
      createdAt: member.joinedAt.toISOString(),
    });
  }

  return { targetUserIds: result.targetUserIds, severity, timeoutMinutes, caseId, incidentCount };
}

async function detectNewAccountGuardHit(
  deps: GuildMemberAddDeps,
  member: IncomingGuildMember,
  preset: keyof typeof NEW_ACCOUNT_GUARD_PRESETS,
): ReturnType<typeof escalateAndRecordStrike> {
  const config = NEW_ACCOUNT_GUARD_PRESETS[preset];
  const hit = hasNewAccountGuardHit(member.accountCreatedAt, member.joinedAt, config.maxAgeDays);
  if (!hit) return null;

  return escalateAndRecordStrike(deps, member.guildId, member.userId, "new_account_guard", member.joinedAt);
}
