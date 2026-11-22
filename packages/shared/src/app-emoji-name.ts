import type { LogEntry } from "./log-entry.js";

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/**
 * ログ種別 → assets/emojis/ のアプリ絵文字名。基本は`{category}_{action}`のsnake_caseで、
 * 命名が異なるもの・フィールドで出し分けるもののみ個別に定義する(網羅性はテストで検証)。
 */
export function appEmojiNameFor(entry: LogEntry): string {
  switch (entry.category) {
    case "auditLogCorrelation":
      return "status_info";
    case "autoMod":
      return `automod_${snake(entry.action)}`;
    case "moderationCase":
      return entry.action === "resolve" ? `moderation_result_${entry.result}` : `moderation_case_${entry.actionType}`;
    case "voice": {
      if (entry.action !== "update") break;
      // selfDeafの切り替えはselfMuteも連動して変化するため、selfMuteは数えない(format-log-messageと同じ扱い)。
      const flags = Object.keys(entry.changes).filter((flag) => !(flag === "selfMute" && "selfDeaf" in entry.changes));
      return flags.length === 1 ? `voice_${snake(flags[0]!)}` : "voice_update";
    }
    case "tempVoice":
      switch (entry.action) {
        case "permissionChanged":
          return `tv_permission_${entry.permission}`;
        case "userLimitChanged":
          return "tv_user_limit";
        case "bitrateChanged":
          return "tv_bitrate";
        case "ownerTransferred":
          return entry.trigger === "manual" ? "tv_owner_manual" : "tv_owner_auto_grace";
        case "memberPermissionChanged":
          return `tv_member_${entry.targetType}_${entry.state}`;
        default:
          return `tv_${entry.action}`;
      }
  }
  return `${snake(entry.category)}_${snake(entry.action)}`;
}
