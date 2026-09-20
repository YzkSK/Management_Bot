import { PermissionFlagsBits } from "discord.js";

/**
 * 連投/フラッド検知のエスカレーションアクション(メッセージ削除・タイムアウト・キック・BAN)実行に必要な権限。
 * warnもbufferedMessageIdsの削除を伴うためManageMessagesが必要(DM送信自体はDiscord API権限不要)。
 */
export const MODERATION_REQUIRED_PERMISSIONS =
  PermissionFlagsBits.ManageMessages |
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.ModerateMembers |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.BanMembers;
