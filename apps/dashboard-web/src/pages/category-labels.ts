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

/** カテゴリタグ・フィルター・アプリ絵文字画像がない種別のログ行で使うアイコン。 */
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
