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

const MAX_MESSAGE_LENGTH = 1_900;
const TRUNCATION_SUFFIX = "…";

function formatValue(value: unknown): string {
  return String(value).replace(/[\r\n]+/g, " ");
}

/**
 * 各カテゴリ共通のフィールド(action/対象ID群)を1行に整形する。
 * カテゴリ固有の見た目が必要になったら、ここをcategoryごとの分岐に拡張する。
 * message.contentのような任意長・改行混じりの値もDiscordの1メッセージに収まるよう、
 * カテゴリ・時刻・区切り文字を含めた最終文字列全体を上限まで切り詰め、
 * 切り詰めが発生したことが分かるようサフィックスを付与する。
 */
export function formatLogEntry(entry: LogEntry): string {
  const { category, guildId, createdAt, ...rest } = entry;
  void guildId;
  const details = Object.entries(rest)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(" ");
  const full = `[${category}] ${createdAt} ${details}`;
  if (full.length <= MAX_MESSAGE_LENGTH) return full;
  return full.slice(0, MAX_MESSAGE_LENGTH - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
}

/**
 * ログエントリをDB保存し、guild×categoryに設定された出力先チャンネルがあれば整形して送信する。
 * 出力先未設定は正常系(DB保存のみで完了)。discord層/moderation連携から共通で呼ぶ入口。
 * ログ本文はユーザー入力(message.content等)を含み得るため、メンション発火を防ぐsuppressMentionsを常に指定する。
 *
 * idを省略した場合はrandomUUID()で生成する。domain-events購読ハンドラ等、
 * at-least-once配送で再実行され得る呼び出し元はentryIdなど決定的な値を渡すこと。
 * DB保存はonConflictDoNothingで冪等(2回目以降は何もしない)にする一方、
 * チャンネル送信はデフォルトで保存の成否に関わらず毎回試みる。送信のみが失敗して
 * 再配送された場合に、DB上は保存済みだからと送信を諦めて永久欠落させないため。
 * sendToChannel側が一時的に失敗し再配送された場合、重複送信は起こり得る
 * (Discord送信とDB更新を1トランザクションにはできないためat-least-once配送とする)。
 *
 * skipNotifyIfExistsをtrueにすると、この呼び出し以前に同じidの行が既に存在した場合は
 * 送信をスキップする。同じ論理イベントを複数の独立した経路(例: poll.tsのmessageUpdateと
 * 起動時再照合)が同じidで並行して書き込み得る場合に、片方が既存行を検知して
 * 重複通知を避けるためのオプトイン。上記の「送信のみ失敗した再配送」を待つ呼び出し元は
 * 使わないこと(その場合は毎回falseのままでよい)。
 */
export async function writeLogEntry(
  deps: WriteLogEntryDeps,
  entry: LogEntry,
  id: string = randomUUID(),
  skipNotifyIfExists = false,
): Promise<void> {
  const { db, sendToChannel } = deps;

  const inserted = await db
    .insert(logEntries)
    .values({
      id,
      guildId: entry.guildId,
      category: entry.category,
      payload: entry,
      createdAt: new Date(entry.createdAt),
    })
    .onConflictDoNothing()
    .returning({ id: logEntries.id });

  if (skipNotifyIfExists && inserted.length === 0) return;

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
