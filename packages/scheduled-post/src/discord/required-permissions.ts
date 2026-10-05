import { PermissionFlagsBits } from "discord.js";

/**
 * 予約投稿の機能有効時にBotが必要とする権限(最小権限方針)。投稿先チャンネルを見て、
 * 通常のチャンネルではメッセージ送信、スレッドではスレッドでのメッセージ送信ができること。
 */
export const SCHEDULED_POST_REQUIRED_PERMISSIONS =
  PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.SendMessagesInThreads;
