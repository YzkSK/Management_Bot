import { randomUUID } from "node:crypto";
import type { Db } from "@management-bot/db";
import { logChannelSettings, logEntries } from "@management-bot/db";
import { eq, and } from "drizzle-orm";
import type { LogEntry } from "../domain/index.js";

export interface ChannelMessage {
  content: string;
  suppressMentions: true;
}

export type ChannelSender = (channelId: string, message: ChannelMessage) => Promise<void>;

export interface WriteLogEntryDeps {
  db: Db;
  sendToChannel: ChannelSender;
}

const MAX_FIELD_LENGTH = 1_900;

function formatValue(value: unknown): string {
  return String(value).replace(/[\r\n]+/g, " ").slice(0, MAX_FIELD_LENGTH);
}

/**
 * 各カテゴリ共通のフィールド(action/対象ID群)を1行に整形する。
 * カテゴリ固有の見た目が必要になったら、ここをcategoryごとの分岐に拡張する。
 * message.contentのような任意長・改行混じりの値もDiscordの1メッセージに収まるよう正規化する。
 */
export function formatLogEntry(entry: LogEntry): string {
  const { category, guildId, createdAt, ...rest } = entry;
  void guildId;
  const details = Object.entries(rest)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(" ");
  return `[${category}] ${createdAt} ${details}`;
}

/**
 * ログエントリをDB保存し、guild×categoryに設定された出力先チャンネルがあれば整形して送信する。
 * 出力先未設定は正常系(DB保存のみで完了)。discord層/moderation連携から共通で呼ぶ入口。
 * ログ本文はユーザー入力(message.content等)を含み得るため、メンション発火を防ぐsuppressMentionsを常に指定する。
 */
export async function writeLogEntry(deps: WriteLogEntryDeps, entry: LogEntry): Promise<void> {
  const { db, sendToChannel } = deps;

  await db.insert(logEntries).values({
    id: randomUUID(),
    guildId: entry.guildId,
    category: entry.category,
    payload: entry,
    createdAt: new Date(entry.createdAt),
  });

  const [channelSetting] = await db
    .select({ channelId: logChannelSettings.channelId })
    .from(logChannelSettings)
    .where(and(eq(logChannelSettings.guildId, entry.guildId), eq(logChannelSettings.category, entry.category)));

  if (!channelSetting) return;

  await sendToChannel(channelSetting.channelId, {
    content: formatLogEntry(entry),
    suppressMentions: true,
  });
}
