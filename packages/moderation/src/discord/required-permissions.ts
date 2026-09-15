import { PermissionFlagsBits } from "discord.js";

/**
 * 連投/フラッド検知のエスカレーションアクション(メッセージ削除・タイムアウト・キック・BAN)実行に必要な権限。
 * warnはDiscord API呼び出しを伴わないため権限不要。
 */
export const MODERATION_REQUIRED_PERMISSIONS =
  PermissionFlagsBits.ManageMessages |
  PermissionFlagsBits.ModerateMembers |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.BanMembers;
