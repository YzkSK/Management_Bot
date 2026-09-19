import type { Redis } from "ioredis";
import type { Db } from "@management-bot/db";
import type { ModerationActionRecordedEvent, ModerationActionType, ModerationPreset, ModerationViolationType } from "@management-bot/shared";
import { MENTION_SPAM_PRESETS, FLOOD_PRESETS, countMentions, extractInviteCodes, isWhitelistMatch } from "../domain/index.js";
import { escalateAndRecordStrike } from "./escalate-and-record.js";
import {
  type BufferedMessage,
  claimAndPushMessage,
  markStrikeHitAndCheckNewBurst,
  mentionCountsInWindow,
  pushMentionCount,
} from "./message-buffer.js";
import type { ModerationConfigCache, ModerationConfigSnapshot } from "./moderation-config-cache.js";
import type { NgwordRow } from "./ngwords.js";
import type { EnabledThreshold } from "./thresholds.js";
import {
  checkFloodOrDuplicate,
  checkInviteLink,
  checkMentionSpam,
  checkNgword,
  NGWORD_STRIKE_LOCK_WINDOW_SECONDS,
  type ViolationCheck,
} from "./violation-check.js";

export { SYSTEM_MODERATOR_ID } from "./escalate-and-record.js";
export { bufferedMessageIdsInWindow } from "./violation-check.js";

/**
 * MessageCreate起点で判定する違反種別。raidはGuildMemberAdd起点、new_account_guardは
 * 入室時単体判定のため、どちらもこのMessageCreateフローでは扱わない(設計spec参照)。
 */
const MESSAGE_CREATE_VIOLATION_TYPES = [
  "flood",
  "duplicate_content",
  "ngword",
  "mention_spam",
  "invite_link",
] as const satisfies readonly ModerationViolationType[];
type MessageCreateViolationType = (typeof MESSAGE_CREATE_VIOLATION_TYPES)[number];

function isMessageCreateViolationType(
  violationType: ModerationViolationType,
): violationType is MessageCreateViolationType {
  return (MESSAGE_CREATE_VIOLATION_TYPES as readonly string[]).includes(violationType);
}

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
  /**
   * whitelist/thresholds/ngwordsをguild単位でまとめてTTLキャッシュする(#352)。
   * メッセージ受信ごとの個別DB問い合わせを避けるため、プロセス起動時に1回生成し共有する
   * (discord/index.tsのcreateModerationConfigCache呼び出し箇所を参照)。
   */
  configCache: ModerationConfigCache;
}

export interface EscalationOutcome {
  violationType: MessageCreateViolationType;
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
 * 副作用の前処理(Redis書き込み・招待リンク解決)を行った上で、violation-check.tsの
 * 副作用なし検知判定関数へ委譲する橋渡し。検知ロジック自体(hit判定の中身)は
 * violation-check.tsの各checkXxx関数が担う。
 */
async function prepareAndCheckViolation(
  deps: DetectAndEscalateDeps,
  message: IncomingMessage,
  buffer: readonly BufferedMessage[],
  violationType: MessageCreateViolationType,
  preset: ModerationPreset,
  ngwords: readonly NgwordRow[],
): Promise<ViolationCheck> {
  if (violationType === "flood" || violationType === "duplicate_content") {
    return checkFloodOrDuplicate(buffer, message, preset, violationType);
  }

  if (violationType === "ngword") {
    return checkNgword(message, ngwords);
  }

  if (violationType === "mention_spam") {
    const mentionPreset = MENTION_SPAM_PRESETS[preset];
    const mentionCount = countMentions(message.content);
    const rawMentionBuffer = await pushMentionCount(
      deps.redis,
      message.guildId,
      message.userId,
      mentionCount,
      message.createdAt,
      mentionPreset.cumulative.windowSeconds,
    );
    // TTLだけではwindowSeconds経過後もキー全体が消えるまでの間は古いエントリが混入するため、
    // hasFloodHitと同様にcreatedAtで時刻フィルタしてから合算する(Codexレビュー指摘)。
    const mentionCounts = mentionCountsInWindow(rawMentionBuffer, message.createdAt, mentionPreset.cumulative.windowSeconds);
    return checkMentionSpam(message, preset, mentionCounts);
  }

  if (violationType === "invite_link") {
    const codes = extractInviteCodes(message.content);
    // 悪意あるメッセージに大量の招待リンクを詰め込まれるとfetchInvite呼び出しが
    // 際限なく増えDiscord REST APIのレート制限を消費しうるため、逐次解決し
    // 他ギルドの招待(=ヒット確定)を1件見つけた時点で打ち切る(Codexレビュー指摘)。
    const resolvedGuildIds: (string | null)[] = [];
    for (const code of codes) {
      const resolvedGuildId = await deps.resolveInviteGuildId(code);
      resolvedGuildIds.push(resolvedGuildId);
      // 解決失敗(null)もcheckInviteLinkでは「他ギルドの招待」としてヒット確定になるため、
      // 自ギルド招待以外(nullを含む)を1件見つけた時点で打ち切る(旧checkViolationと同じ挙動)。
      if (resolvedGuildId !== message.guildId) break;
    }
    return checkInviteLink(message, resolvedGuildIds);
  }

  throw new Error(`unhandled violationType: ${violationType satisfies never}`);
}

export interface DetectAndEscalateResult {
  outcomes: EscalationOutcome[];
  /**
   * strikeロック中(同一ユーザーが直近strikeLockWindowSeconds秒以内に既にstrikeを加算済み)のため
   * outcomesには含まれないが、違反として検知され削除が必要なメッセージID一覧(#338)。
   * ngword/mention_spam/invite_linkはbufferedMessageIdsが検知トリガーメッセージ自身のみのため、
   * ロックによりoutcomesから漏れるとそのメッセージが二度と削除対象に含まれなくなる
   * (flood/duplicate_contentはバースト全体を返すため次のhit時にまとめて削除されるが、
   * 単発判定の3種別はロック中の個別メッセージがここでしか伝わらない)。
   */
  lockedMessageIds: readonly string[];
}

/**
 * thresholdごとにcheck→strikeロック確認→エスカレーション記録までを行う共通ループ。
 * messageCreate(detectAndEscalate)・messageUpdate(detectAndEscalateOnEdit)の両方から使う。
 */
async function runViolationChecks(
  deps: DetectAndEscalateDeps,
  message: IncomingMessage,
  buffer: readonly BufferedMessage[],
  thresholds: readonly (EnabledThreshold & { violationType: MessageCreateViolationType })[],
  ngwords: readonly NgwordRow[],
): Promise<DetectAndEscalateResult> {
  const outcomes: EscalationOutcome[] = [];
  const lockedMessageIds = new Set<string>();
  for (const threshold of thresholds) {
    const check = await prepareAndCheckViolation(deps, message, buffer, threshold.violationType, threshold.preset, ngwords);
    if (!check.hit) continue;

    const canStrike = await markStrikeHitAndCheckNewBurst(
      deps.redis,
      message.guildId,
      message.userId,
      threshold.violationType,
      check.strikeLockWindowSeconds,
    );
    if (!canStrike) {
      // "burst"(flood/duplicate_content)はcheck.bufferedMessageIdsがバースト全体(同一チャンネル・
      // window内の全メッセージ)を指すため、ロック中でも次にhitした際にまとめて削除される。
      // ここで加えると、strike済みバーストの古いメッセージまで無関係に再削除対象へ混入するため、
      // "single-shot"(bufferedMessageIdsは検知トリガー自身のみ)に限定する。
      if (check.strikeLockMode === "single-shot") {
        lockedMessageIds.add(message.messageId);
      }
      continue;
    }

    // エスカレーション判定は違反種別を跨いだ合計strikeCountに対して行う(統一ストライクカウンター、#311)。
    // 検知条件(hasFloodHit/isDuplicateHit/findMatchingNgword/hasSingleMessageMentionSpam等)は
    // violationTypeごとのプリセットのまま、アクション決定(何回目でwarn/timeout/kick/ban)だけを
    // guild単位で統一する(escalateAndRecordStrikeへ抽出、#194でnew_account_guardとも共用)。
    const escalation = await escalateAndRecordStrike(
      deps,
      message.guildId,
      message.userId,
      threshold.violationType,
      message.createdAt,
    );
    if (escalation === null) continue;

    outcomes.push({
      violationType: threshold.violationType,
      strikeCount: escalation.strikeCount,
      actionType: escalation.actionType,
      timeoutMinutes: escalation.timeoutMinutes,
      caseId: escalation.caseId,
      bufferedMessageIds: check.bufferedMessageIds,
    });
  }

  return { outcomes, lockedMessageIds: [...lockedMessageIds] };
}

export async function detectAndEscalate(
  deps: DetectAndEscalateDeps,
  message: IncomingMessage,
): Promise<DetectAndEscalateResult> {
  const snapshot: ModerationConfigSnapshot = await deps.configCache.get(deps.db, message.guildId);

  if (isWhitelistMatch(snapshot.whitelist, message.guildId, message.userId, message.roleIds)) {
    return { outcomes: [], lockedMessageIds: [] };
  }

  const thresholds = snapshot.enabledThresholds.filter(
    (t): t is EnabledThreshold & { violationType: MessageCreateViolationType } =>
      isMessageCreateViolationType(t.violationType),
  );
  if (thresholds.length === 0) return { outcomes: [], lockedMessageIds: [] };

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
  if (buffer === null) return { outcomes: [], lockedMessageIds: [] };

  return runViolationChecks(deps, message, buffer, thresholds, snapshot.ngwords);
}

/**
 * messageUpdateを起点に、編集後の内容でngword/invite_linkのみ再検知するユースケース(改善案7.1節)。
 * 投稿後に編集でNGワード・招待リンクを後から仕込む回避を防ぐ。
 * flood/duplicate_content(バッファ内の他メッセージとの比較が前提)とmention_spam(Redisバッファへの
 * 累積プッシュを伴い、編集のたびに再実行すると二重カウントになる)は対象外とする。
 * claimAndPushMessageによる同一messageIdの再処理防止は使わない(バッファに触れないため不要であり、
 * 使うと同じmessageIdの初回create処理でスキップ済みとなり編集時の判定が常にブロックされてしまう)。
 * そのため同一メッセージへの複数回の編集はその都度評価されるが、strikeロック(markStrikeHitAndCheckNewBurst)
 * により短時間の連続ヒットは抑制される。
 */
export async function detectAndEscalateOnEdit(
  deps: DetectAndEscalateDeps,
  message: IncomingMessage,
): Promise<DetectAndEscalateResult> {
  const snapshot: ModerationConfigSnapshot = await deps.configCache.get(deps.db, message.guildId);

  if (isWhitelistMatch(snapshot.whitelist, message.guildId, message.userId, message.roleIds)) {
    return { outcomes: [], lockedMessageIds: [] };
  }

  const thresholds = snapshot.enabledThresholds.filter(
    (t): t is EnabledThreshold & { violationType: "ngword" | "invite_link" } =>
      t.violationType === "ngword" || t.violationType === "invite_link",
  );
  if (thresholds.length === 0) return { outcomes: [], lockedMessageIds: [] };

  return runViolationChecks(deps, message, [], thresholds, snapshot.ngwords);
}
