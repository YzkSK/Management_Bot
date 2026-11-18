import {
  AlignLeft,
  Bot,
  CalendarDays,
  ChartColumn,
  FileText,
  Hash,
  Headphones,
  House,
  Link,
  type LucideIcon,
  MessageSquare,
  Mic,
  Podcast,
  ShieldAlert,
  Smile,
  SmilePlus,
  Sticker,
  Tag,
  User,
  UserPlus,
} from "lucide-react";
import { CATEGORY_LABELS, LOG_CATEGORIES, type LogCategory } from "@management-bot/shared";

export { CATEGORY_LABELS };

export const CATEGORY_OPTIONS: readonly { value: LogCategory; label: string }[] = LOG_CATEGORIES.map((category) => ({
  value: category,
  label: CATEGORY_LABELS[category],
}));

/**
 * ログ一覧の色バー・フィルターで使うカテゴリ色。画面全体はモノクロ基調だが、カテゴリの判別用途に限って
 * 色相を使い分ける(関連するカテゴリは近い色相、同系統は明度で区別する)。
 */
export const CATEGORY_ACCENT: Record<LogCategory, string> = {
  message: "#2563eb",
  reaction: "#0ea5e9",
  member: "#16a34a",
  role: "#d97706",
  channel: "#0d9488",
  guild: "#475569",
  thread: "#0891b2",
  invite: "#65a30d",
  emoji: "#ca8a04",
  sticker: "#db2777",
  autoMod: "#e11d48",
  integration: "#4f46e5",
  poll: "#ea580c",
  scheduledEvent: "#c026d3",
  stage: "#7c3aed",
  auditLogCorrelation: "#71717a",
  moderationCase: "#dc2626",
  voice: "#9333ea",
  tempVoice: "#a855f7",
};

/** カテゴリフィルターと、アプリ絵文字画像がない種別のログ行で使うアイコン。 */
export const CATEGORY_ICON: Record<LogCategory, LucideIcon> = {
  message: MessageSquare,
  reaction: Smile,
  member: User,
  role: Tag,
  channel: Hash,
  guild: House,
  thread: AlignLeft,
  invite: UserPlus,
  emoji: SmilePlus,
  sticker: Sticker,
  autoMod: Bot,
  integration: Link,
  poll: ChartColumn,
  scheduledEvent: CalendarDays,
  stage: Podcast,
  auditLogCorrelation: FileText,
  moderationCase: ShieldAlert,
  voice: Mic,
  tempVoice: Headphones,
};
