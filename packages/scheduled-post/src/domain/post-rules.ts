import { SCHEDULED_POST_FAILURE_LABELS, type ScheduledPostFailureReason } from "@management-bot/shared";
import { formatScheduledLabel } from "./schedule-time.js";

/** 投稿待ち(pending)の予約のみを数える。 */
export const MAX_PENDING_PER_USER = 10;
export const MAX_PENDING_PER_GUILD = 100;

export type LimitError = "user_limit" | "guild_limit";

export const LIMIT_ERROR_MESSAGES: Record<LimitError, string> = {
  user_limit: `予約できるのは1人あたり最大${MAX_PENDING_PER_USER}件(投稿待ちのみ)です。不要な予約を取り消してください。`,
  guild_limit: `このサーバーで予約できるのは最大${MAX_PENDING_PER_GUILD}件(投稿待ちのみ)です。`,
};

export function checkLimits(counts: { userPending: number; guildPending: number }): LimitError | null {
  if (counts.userPending >= MAX_PENDING_PER_USER) return "user_limit";
  if (counts.guildPending >= MAX_PENDING_PER_GUILD) return "guild_limit";
  return null;
}

export type PostChannelKind = "missing" | "unsupported" | "message-channel" | "thread";

/** 投稿直前にDiscordから収集する事実。判断(decidePostability)と収集(discord層)を分離する。 */
export interface PostFacts {
  authorIsMember: boolean;
  authorRoleIds: readonly string[];
  channelKind: PostChannelKind;
  /** スレッドがアーカイブまたはロックされている。 */
  threadClosed: boolean;
  /** 実行者がそのチャンネルでメッセージ送信できる(スレッドはスレッドでの送信権限)。 */
  authorCanSend: boolean;
  botCanSend: boolean;
}

export type Postability = { ok: true } | { ok: false; reason: ScheduledPostFailureReason };

/**
 * 投稿してよいかを判定する。allowedRoleIdsが空なら「使えるロール」未設定(全員可)。
 * 複数該当する場合は、原因として最も根本的なものから順に報告する。
 */
export function decidePostability(facts: PostFacts, allowedRoleIds: readonly string[]): Postability {
  if (!facts.authorIsMember) return { ok: false, reason: "author_left" };
  if (facts.channelKind === "missing" || facts.channelKind === "unsupported") {
    return { ok: false, reason: "channel_deleted" };
  }
  if (facts.channelKind === "thread" && facts.threadClosed) return { ok: false, reason: "thread_archived" };
  if (!facts.authorCanSend) return { ok: false, reason: "no_permission" };
  if (allowedRoleIds.length > 0 && !allowedRoleIds.some((roleId) => facts.authorRoleIds.includes(roleId))) {
    return { ok: false, reason: "no_role" };
  }
  if (!facts.botCanSend) return { ok: false, reason: "bot_missing_permission" };
  return { ok: true };
}

/** Discord APIエラーコード(RESTJSONErrorCodes)から失敗原因を分類する。 */
export function classifySendErrorCode(code: unknown): ScheduledPostFailureReason {
  switch (code) {
    case 10003: // Unknown Channel
    case 10004: // Unknown Guild
      return "channel_deleted";
    case 50001: // Missing Access
    case 50013: // Missing Permissions
      return "bot_missing_permission";
    case 50083: // Thread is archived
      return "thread_archived";
    default:
      return "send_failed";
  }
}

/** 予約者が選んだメンション指定。 */
export interface MentionSelection {
  everyone: boolean;
  here: boolean;
  roleIds: readonly string[];
  userIds: readonly string[];
}

/** メンションの可否を決める事実。設定(allow*)・実行者のMentionEveryone権限・ロールのmentionable。 */
export interface MentionPolicy {
  allowEveryone: boolean;
  allowHere: boolean;
  canMentionEveryone: boolean;
  isRoleMentionable: (roleId: string) => boolean;
}

export type MentionError = "everyone_not_allowed" | "here_not_allowed" | "no_mention_everyone_permission" | "role_not_mentionable";

export const MENTION_ERROR_MESSAGES: Record<MentionError, string> = {
  everyone_not_allowed: "このサーバーの設定では、予約投稿で @everyone は使えません。",
  here_not_allowed: "このサーバーの設定では、予約投稿で @here は使えません。",
  no_mention_everyone_permission: "このチャンネルで「@everyone、@here、すべてのロールにメンション」権限がないため、@everyone / @here は使えません。",
  role_not_mentionable: "メンションできないロールが選ばれています(「@everyone、@here、すべてのロールにメンション」権限がある場合のみ、メンション不可のロールを指定できます)。",
};

/** 予約の登録・編集時の検証。許されない指定があれば最初のエラーを返す。 */
export function validateMentionSelection(selection: MentionSelection, policy: MentionPolicy): MentionError | null {
  if (selection.everyone && !policy.allowEveryone) return "everyone_not_allowed";
  if (selection.here && !policy.allowHere) return "here_not_allowed";
  if ((selection.everyone || selection.here) && !policy.canMentionEveryone) return "no_mention_everyone_permission";
  if (!policy.canMentionEveryone && !selection.roleIds.every(policy.isRoleMentionable)) return "role_not_mentionable";
  return null;
}

export interface AllowedMentionsSpec {
  parse: "everyone"[];
  roles: string[];
  users: string[];
}

export interface MentionMessage {
  /** メンション行。メンションが無ければundefined。 */
  content: string | undefined;
  allowedMentions: AllowedMentionsSpec;
}

/**
 * 投稿時のメンション行とallowedMentionsを作る。登録後に設定・権限が変わっていても、
 * 今許されないもの(everyone/here・メンション不可のロール)は除外して続行する(投稿は失敗にしない)。
 * @everyoneと@hereは同じフラグなので、片方のみ選択時もcontentに含めたものだけが通知される。
 */
export function buildMentionMessage(selection: MentionSelection, policy: MentionPolicy): MentionMessage {
  const everyone = selection.everyone && policy.allowEveryone && policy.canMentionEveryone;
  const here = selection.here && policy.allowHere && policy.canMentionEveryone;
  const roleIds = selection.roleIds.filter((id) => policy.canMentionEveryone || policy.isRoleMentionable(id));
  const tokens = [
    ...(everyone ? ["@everyone"] : []),
    ...(here ? ["@here"] : []),
    ...roleIds.map((id) => `<@&${id}>`),
    ...selection.userIds.map((id) => `<@${id}>`),
  ];
  return {
    content: tokens.length > 0 ? tokens.join(" ") : undefined,
    allowedMentions: {
      parse: everyone || here ? ["everyone"] : [],
      roles: [...roleIds],
      users: [...selection.userIds],
    },
  };
}

const DM_CONTENT_PREVIEW_MAX = 1000;

function preview(content: string): string {
  const text = content.length > DM_CONTENT_PREVIEW_MAX ? `${content.slice(0, DM_CONTENT_PREVIEW_MAX)}…` : content;
  return text.replaceAll("```", "'''");
}

interface NoticeInput {
  channelId: string;
  scheduledAt: Date;
  content: string;
  now: Date;
}

/** 失敗時に予約者へ送るDM本文。 */
export function buildFailureDm(input: NoticeInput & { reason: ScheduledPostFailureReason }): string {
  return [
    "予約投稿を送信できませんでした。",
    `投稿先: <#${input.channelId}>`,
    `予定時刻: ${formatScheduledLabel(input.scheduledAt, input.now)}`,
    `理由: ${SCHEDULED_POST_FAILURE_LABELS[input.reason]}`,
    "本文:",
    "```",
    preview(input.content),
    "```",
  ].join("\n");
}

/** 管理者がDashboardから取り消した際に予約者へ送るDM本文。 */
export function buildAdminCancelDm(input: NoticeInput): string {
  return [
    "あなたの予約投稿はサーバーの管理者によって取り消されました。",
    `投稿先: <#${input.channelId}>`,
    `予定時刻: ${formatScheduledLabel(input.scheduledAt, input.now)}`,
    "本文:",
    "```",
    preview(input.content),
    "```",
  ].join("\n");
}
