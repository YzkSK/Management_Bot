import {
  CHANGE_FIELD_LABELS,
  diffPermissions,
  formatChangeValue,
  formatLogMessage,
  summarizeLogEntry,
} from "@management-bot/shared";
import { ContainerBuilder, SeparatorSpacingSize, TextDisplayBuilder } from "discord.js";
import type { LogEntry } from "../domain/index.js";
import { ACCENT_COLORS, getPresentation } from "./log-entry-presentation.js";

/** チャンネルID解決なしで送るため、formatLogMessageのnames引数は常に空(スナップショットフィールドのみで解決される)。 */
const NO_NAMES = { users: {}, channels: {} };

/**
 * DiscordのTextDisplayコンポーネントは1つ4,000文字が上限(Discord API仕様)。超過分をそのまま
 * addTextDisplayComponentsに渡すと送信自体が例外になり、writeLogEntrySafelyが握りつぶすため
 * ログがDBに保存されたままチャンネルに一切届かなくなる。超過時は切り詰めて必ず上限内に収める。
 */
const MAX_TEXT_DISPLAY_LENGTH = 4_000;
const TEXT_DISPLAY_TRUNCATION_SUFFIX = "\n…(省略)";

function fitTextDisplay(content: string): string {
  if (content.length <= MAX_TEXT_DISPLAY_LENGTH) return content;
  return content.slice(0, MAX_TEXT_DISPLAY_LENGTH - TEXT_DISPLAY_TRUNCATION_SUFFIX.length) + TEXT_DISPLAY_TRUNCATION_SUFFIX;
}

function formatChangesLine(field: string, change: { before: unknown; after: unknown }): string {
  const label = CHANGE_FIELD_LABELS[field] ?? field;
  if (field === "permissions" && typeof change.before === "string" && typeof change.after === "string") {
    const diff = diffPermissions(change.before, change.after);
    if (diff) {
      const lines = [
        ...diff.removed.map((name) => `−${name}`),
        ...diff.added.map((name) => `+${name}`),
      ];
      return lines.length > 0 ? `**${label}**\n${lines.join("\n")}` : `**${label}**: 変更なし`;
    }
  }
  const before = formatChangeValue(field, change.before as string | number | boolean | null, {});
  const after = formatChangeValue(field, change.after as string | number | boolean | null, {});
  return `**${label}**: −${before} → +${after}`;
}

/** 警告バッジ(再入室・モデレーション履歴)。member/join以外のentryではフラグが常にundefinedなので何も返らない。 */
function buildWarningLines(entry: LogEntry): string[] {
  if (entry.category !== "member" || entry.action !== "join") return [];
  const lines: string[] = [];
  if (entry.hasModerationHistory) lines.push("⚠️ 過去にモデレーション対応(キック/BAN)の履歴があります");
  if (entry.isRejoin) lines.push("🔁 再入室です");
  return lines;
}

/**
 * LogEntryをComponents V2のContainer 1件に整形する。channel.send側でMessageFlags.IsComponentsV2を
 * 付与すること(このBuilder単体ではフラグは持たない)。
 */
export function buildLogEntryContainer(entry: LogEntry): ContainerBuilder {
  const summary = summarizeLogEntry(entry);
  const { accent, title } = getPresentation(entry);
  const description = formatLogMessage(entry, summary, NO_NAMES);

  const container = new ContainerBuilder().setAccentColor(ACCENT_COLORS[accent]);

  const headerLines = [`### ${title}`, description];
  const warnings = buildWarningLines(entry);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(fitTextDisplay(headerLines.join("\n"))));

  if (warnings.length > 0) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(fitTextDisplay(warnings.join("\n"))));
  }

  const bodyLines: string[] = [];
  if (summary.previousContent !== null) {
    bodyLines.push(`**編集前**\n> ${summary.previousContent.replaceAll("\n", "\n> ") || "(本文なし)"}`);
  }
  if (summary.content !== null) {
    bodyLines.push(`**${summary.previousContent !== null ? "編集後" : "本文"}**\n> ${summary.content.replaceAll("\n", "\n> ") || "(本文なし)"}`);
  }
  if (summary.changes !== null) {
    for (const [field, change] of Object.entries(summary.changes)) {
      bodyLines.push(formatChangesLine(field, change));
    }
  }
  if (summary.attachments !== null && summary.attachments.length > 0) {
    bodyLines.push(`**添付ファイル**\n${summary.attachments.map((a) => `[${a.filename}](${a.url})`).join("\n")}`);
  }

  if (bodyLines.length > 0) {
    container.addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(fitTextDisplay(bodyLines.join("\n\n"))));
  }

  return container;
}
