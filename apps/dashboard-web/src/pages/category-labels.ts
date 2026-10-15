import {
  IconAlignLeft,
  IconBroadcast,
  IconCalendar,
  IconCalendarTime,
  IconChartBar,
  IconFileText,
  IconHash,
  IconHeadphones,
  IconHome,
  IconLink,
  IconMessage,
  IconMicrophone,
  IconMoodPlus,
  IconMoodSmile,
  IconRobot,
  IconShieldExclamation,
  IconSticker,
  IconTag,
  IconUser,
  IconUserPlus,
  type TablerIcon,
} from "@tabler/icons-react";
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
  scheduledPost: "#0284c7",
};

/** カテゴリフィルターと、アプリ絵文字画像がない種別のログ行で使うアイコン。 */
export const CATEGORY_ICON: Record<LogCategory, TablerIcon> = {
  message: IconMessage,
  reaction: IconMoodSmile,
  member: IconUser,
  role: IconTag,
  channel: IconHash,
  guild: IconHome,
  thread: IconAlignLeft,
  invite: IconUserPlus,
  emoji: IconMoodPlus,
  sticker: IconSticker,
  autoMod: IconRobot,
  integration: IconLink,
  poll: IconChartBar,
  scheduledEvent: IconCalendar,
  stage: IconBroadcast,
  auditLogCorrelation: IconFileText,
  moderationCase: IconShieldExclamation,
  voice: IconMicrophone,
  tempVoice: IconHeadphones,
  scheduledPost: IconCalendarTime,
};
