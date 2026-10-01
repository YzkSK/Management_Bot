import {
  CHANGE_FIELD_LABELS,
  appEmojiText,
  contentWithoutGifLinks,
  diffPermissions,
  formatChangeValue,
  formatLogMessage,
  summarizeLogEntry,
} from "@management-bot/shared";
import { ContainerBuilder, MediaGalleryItemBuilder, SeparatorSpacingSize, TextDisplayBuilder } from "discord.js";
import type { LogEntry } from "../domain/index.js";
import { ACCENT_COLORS, getPresentation } from "./log-entry-presentation.js";

/**
 * Discord送信ではuserName/channelNameの解決テーブルを引く代わりに、常にメンション記法
 * (<@id>/<#id>)を使う。Discordクライアント側が表示名・チャンネル名を自動で解決してくれるため、
 * dashboard-web(表示名の平文)と違いnames.users/channelsを埋める必要がない。
 */
const MENTION_NAMES = { users: {}, channels: {}, mention: true };

/**
 * ログカードの見出し・フィールドで使うアプリ絵文字(assets/emojis/)と、未登録・取得失敗時のフォールバック。
 * 画像が存在することはテストで検証する。
 */
export const LOG_CARD_APP_EMOJIS = {
  bulkDelete: { name: "message_bulk_delete", fallback: "🧹" },
  moderationHistory: { name: "member_moderation_history", fallback: "⚠️" },
  rejoin: { name: "member_rejoin", fallback: "🔁" },
  newAccount: { name: "member_new_account_warning", fallback: "🔰" },
  bot: { name: "bot", fallback: "🤖" },
  beforeAfter: { name: "before_after", fallback: "→" },
  attachment: { name: "attachment", fallback: "📎" },
  executor: { name: "executor", fallback: "👤" },
} as const satisfies Record<string, { name: string; fallback: string }>;

function cardEmoji(key: keyof typeof LOG_CARD_APP_EMOJIS): string {
  const { name, fallback } = LOG_CARD_APP_EMOJIS[key];
  return appEmojiText(name, fallback);
}

/**
 * DiscordのTextDisplayコンポーネントは1つ4,000文字が上限(Discord API仕様)。超過分をそのまま
 * addTextDisplayComponentsに渡すと送信自体が例外になり、writeLogEntrySafelyが握りつぶすため
 * ログがDBに保存されたままチャンネルに一切届かなくなる。超過時は切り詰めて必ず上限内に収める。
 */
const MAX_TEXT_DISPLAY_LENGTH = 4_000;
const MAX_MEDIA_GALLERY_ITEMS = 10;
const TEXT_DISPLAY_TRUNCATION_SUFFIX = "\n…(省略)";

function fitTextDisplay(content: string): string {
  if (content.length <= MAX_TEXT_DISPLAY_LENGTH) return content;
  return content.slice(0, MAX_TEXT_DISPLAY_LENGTH - TEXT_DISPLAY_TRUNCATION_SUFFIX.length) + TEXT_DISPLAY_TRUNCATION_SUFFIX;
}

/** 「ラベル: 値」の1行フィールド。1行に収まる単純な値(ID・日付・diff済みの短い値)向け。 */
function formatField(label: string, value: string): string {
  return `**${label}**: ${value}`;
}

/** ラベル(小文字のsubtext)+値の2行1組。引用ブロックや複数行リストなど、1行に収まらない値向け。 */
function formatMultilineField(label: string, value: string): string {
  return `-# ${label}\n${value}`;
}

/**
 * entry.createdAtをDiscordのタイムスタンプ記法(<t:unix:f>)に変換する。クライアント側が
 * 閲覧者のタイムゾーン・言語設定に合わせて「2026年8月31日 9:00」のような形式に自動整形する。
 */
function formatTimestamp(createdAt: string): string {
  return `<t:${Math.floor(new Date(createdAt).getTime() / 1000)}:f>`;
}

export interface BulkDeleteSummaryCardInput {
  count: number;
  channelId: string;
  createdAt: string;
}

/** 一括削除の通知を、個別ログと同じComponents V2カードとして表示する。 */
export function buildBulkDeleteSummaryContainers({
  count,
  channelId,
  createdAt,
}: BulkDeleteSummaryCardInput): ContainerBuilder[] {
  const container = new ContainerBuilder().setAccentColor(ACCENT_COLORS.negative);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      fitTextDisplay(
        `### ${cardEmoji("bulkDelete")} メッセージが一括削除されました\n${count}件のメッセージが<#${channelId}>で一括削除されました`,
      ),
    ),
  );
  container.addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${formatTimestamp(createdAt)}`));
  return [container];
}

function formatChangesLine(field: string, change: { before: unknown; after: unknown }): string {
  const label = CHANGE_FIELD_LABELS[field] ?? field;
  if (field === "permissions" && typeof change.before === "string" && typeof change.after === "string") {
    const diff = diffPermissions(change.before, change.after);
    if (diff) {
      const lines = [
        ...diff.removed.map((name) => `-${name}`),
        ...diff.added.map((name) => `+${name}`),
      ];
      return lines.length > 0
        ? formatMultilineField(label, `\`\`\`diff\n${lines.join("\n")}\n\`\`\``)
        : formatField(label, "変更なし");
    }
  }
  const before = formatChangeValue(field, change.before as string | number | boolean | null, {});
  const after = formatChangeValue(field, change.after as string | number | boolean | null, {});
  return formatField(label, `−${before} ${cardEmoji("beforeAfter")} +${after}`);
}

/** アカウント作成からこの日数以内の参加を「新しいアカウント」として警告する。 */
const NEW_ACCOUNT_WARNING_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 参加時点(entry.createdAt)でアカウント作成からNEW_ACCOUNT_WARNING_DAYS日以内か。作成日時が無ければfalse。 */
function isNewAccount(createdAt: string, accountCreatedAt: string | undefined): boolean {
  if (accountCreatedAt === undefined) return false;
  return new Date(createdAt).getTime() - new Date(accountCreatedAt).getTime() <= NEW_ACCOUNT_WARNING_DAYS * DAY_MS;
}

/** 警告バッジ(モデレーション履歴・新しいアカウント・再入室)の本文行。member/join以外のentryではフラグが常にundefinedなので何も返らない。 */
function buildWarningLines(entry: LogEntry): string[] {
  if (entry.category !== "member" || entry.action !== "join") return [];
  const lines: string[] = [];
  if (entry.hasModerationHistory) lines.push(`${cardEmoji("moderationHistory")} **過去にモデレーション対応(キック/BAN)の履歴があります**`);
  if (isNewAccount(entry.createdAt, entry.accountCreatedAt)) {
    lines.push(`${cardEmoji("newAccount")} **アカウント作成から${NEW_ACCOUNT_WARNING_DAYS}日以内です**`);
  }
  if (entry.isRejoin) lines.push(`${cardEmoji("rejoin")} **再入室です**`);
  return lines;
}

/**
 * account作成日・ユーザーID等、member/joinカード限定のフィールド。
 * Components V2にinline(横並び)フィールドは存在せず(Discord公式でも未実装と明言されている)、
 * SectionのTextDisplay+accessoryも「テキスト vs サムネイル/ボタン」の横並びであって
 * テキスト同士の横並びには使えないため、通常のラベル+値の縦積みで表示する。
 */
function buildMemberJoinFields(entry: LogEntry): string[] {
  if (entry.category !== "member" || entry.action !== "join") return [];
  const fields: string[] = [];
  if (entry.actorIsBot) fields.push(`${cardEmoji("bot")} **Botアカウントです**`);
  if (entry.accountCreatedAt) {
    const createdAt = new Date(entry.accountCreatedAt);
    const daysAgo = Math.floor((Date.now() - createdAt.getTime()) / DAY_MS);
    fields.push(formatField("アカウント作成日", `<t:${Math.floor(createdAt.getTime() / 1000)}:D>(${daysAgo}日前)`));
  }
  fields.push(formatField("ユーザーID", entry.userId));
  return fields;
}

/**
 * LogEntryをComponents V2のContainer群に整形する。channel.send側でMessageFlags.IsComponentsV2を
 * 付与すること(このBuilder単体ではフラグは持たない)。
 *
 * member/joinで警告(モデレーション履歴・新しいアカウント・再入室)がある場合、赤アクセントの別Containerとして
 * メインカードの下に追加する(codexレビュー指摘: 引用ブロックのみでは警告の緊急性が伝わりにくい)。
 * Discordは1メッセージに複数のtop-level components(Container)を並べられる。
 */
export function buildLogEntryContainers(entry: LogEntry): ContainerBuilder[] {
  const summary = summarizeLogEntry(entry);
  // GIFリンク(Tenor/Klipy等)はMediaGalleryでプレビューするため、本文の元URL・添付ファイルのリンク一覧からは省く(#528)。
  const displayContent = contentWithoutGifLinks(summary.content, summary.attachments) ?? null;
  const linkAttachments = (summary.attachments ?? []).filter((a) => !a.gifv);
  const { accent, title, icon } = getPresentation(entry);
  const description = formatLogMessage(entry, summary, MENTION_NAMES);

  const mainContainer = new ContainerBuilder().setAccentColor(ACCENT_COLORS[accent]);

  const headerLines = [`### ${icon} ${title}`, description];
  const memberJoinFields = buildMemberJoinFields(entry);
  // アバターSectionの右にできる余白を抑えるため、フィールドもヘッダーと同じTextDisplayに含めて高さを稼ぐ。
  const headerText = new TextDisplayBuilder().setContent(
    fitTextDisplay([...headerLines, ...memberJoinFields].join("\n\n")),
  );

  const avatarUrl = entry.category === "member" && entry.action === "join" ? entry.avatarUrl : undefined;
  if (avatarUrl) {
    mainContainer.addSectionComponents((section) =>
      section
        .addTextDisplayComponents(headerText)
        .setThumbnailAccessory((thumbnail) => thumbnail.setURL(avatarUrl)),
    );
  } else {
    mainContainer.addTextDisplayComponents(headerText);
  }

  const bodyLines: string[] = [];
  if (summary.previousContent !== null) {
    bodyLines.push(formatMultilineField("編集前", `> ${summary.previousContent.replaceAll("\n", "\n> ") || "(本文なし)"}`));
  }
  if (displayContent !== null) {
    bodyLines.push(
      formatMultilineField(
        summary.previousContent !== null ? "編集後" : "本文",
        `> ${displayContent.replaceAll("\n", "\n> ") || "(本文なし)"}`,
      ),
    );
  }
  if (avatarUrl === undefined) bodyLines.push(...memberJoinFields);
  // voice/updateのchangesはdescription(formatLogMessage)の文章側で既に状態変化を表現済みのため、生の値行は表示しない。
  if (summary.changes !== null && entry.category !== "voice") {
    for (const [field, change] of Object.entries(summary.changes)) {
      bodyLines.push(formatChangesLine(field, change));
    }
  }
  if (linkAttachments.length > 0) {
    bodyLines.push(
      formatMultilineField(`${cardEmoji("attachment")} 添付ファイル`, linkAttachments.map((a) => `[${a.filename}](${a.url})`).join("\n")),
    );
  }
  // 監査ログ相関で実行者が判明している場合のみ。メンション記法なのでDiscord側で表示名に解決される。
  if (entry.executorId !== undefined) bodyLines.push(formatField(`${cardEmoji("executor")} 実行者`, `<@${entry.executorId}>`));
  // 画像・GIF(Tenorのgifvはmp4)はリンクだけでなくMediaGalleryでプレビュー表示する(#528)。
  // MediaGalleryは1つ10件が上限(Discord API仕様)のため、超過分はリンク一覧のみに留める。
  const mediaItems = (summary.attachments ?? [])
    .filter((a) => a.contentType?.startsWith("image/") || a.contentType?.startsWith("video/"))
    .slice(0, MAX_MEDIA_GALLERY_ITEMS)
    .map((a) => new MediaGalleryItemBuilder().setURL(a.previewUrl ?? a.url).setSpoiler(a.filename.startsWith("SPOILER_")));

  // イベント発生日時はプレビューも含めたカードの一番下に表示する(見た目のフィードバック反映)。
  // プレビューがなければ本文と同じTextDisplayに含め、余計な余白を作らない。
  const timestampLine = `-# ${formatTimestamp(entry.createdAt)}`;
  if (mediaItems.length === 0) bodyLines.push(timestampLine);

  mainContainer.addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Small));
  if (bodyLines.length > 0) {
    mainContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(fitTextDisplay(bodyLines.join("\n\n"))));
  }
  if (mediaItems.length > 0) {
    mainContainer.addMediaGalleryComponents((gallery) => gallery.addItems(mediaItems));
    mainContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(timestampLine));
  }

  const containers = [mainContainer];

  const warningLines = buildWarningLines(entry);
  if (warningLines.length > 0) {
    const warningContainer = new ContainerBuilder()
      .setAccentColor(ACCENT_COLORS.negative)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(fitTextDisplay(warningLines.join("\n"))));
    containers.push(warningContainer);
  }

  return containers;
}
