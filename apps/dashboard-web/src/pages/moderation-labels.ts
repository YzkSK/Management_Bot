import type { ModerationPreset, ModerationViolationType } from "@management-bot/shared";

export const VIOLATION_TYPE_LABELS: Record<ModerationViolationType, string> = {
  flood: "連投",
  duplicate_content: "内容重複",
};

export const PRESET_LABELS: Record<ModerationPreset, string> = {
  weak: "弱",
  medium: "中",
  strong: "強",
};
