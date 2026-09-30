import type { LogCategory } from "@management-bot/shared";
import { parseRetentionDaysInput } from "./parse-retention-days.js";
import { uniformValue } from "./uniform-value.js";

/** ログ設定画面の編集中の値。保存ボタンを押すまでサーバーへは送らない。 */
export interface LogSettingsDraft {
  /** 入力途中の文字列を保持するため、保持期間は文字列で持つ。 */
  retention: Partial<Record<LogCategory, string>>;
  channel: Partial<Record<LogCategory, string | null>>;
  showAuditLogCorrelation: boolean;
  showBotEvents: boolean;
}

export interface LogSettingsServerState {
  retention: readonly { category: LogCategory; retentionDays: number }[];
  channel: readonly { category: LogCategory; channelId: string | null }[];
  /** 表示設定は別クエリのため未取得の場合がある。未取得なら表示設定は差分に含めない。 */
  display?: { hideAuditLogCorrelation: boolean; hideBotEvents: boolean };
}

export function buildLogSettingsDraft(server: LogSettingsServerState): LogSettingsDraft {
  return {
    retention: Object.fromEntries(server.retention.map((s) => [s.category, String(s.retentionDays)])),
    channel: Object.fromEntries(server.channel.map((s) => [s.category, s.channelId])),
    showAuditLogCorrelation: server.display ? !server.display.hideAuditLogCorrelation : false,
    showBotEvents: server.display ? !server.display.hideBotEvents : false,
  };
}

export interface LogSettingsChanges {
  retention: { category: LogCategory; retentionDays: number }[];
  channel: { category: LogCategory; channelId: string | null }[];
  display: { hideAuditLogCorrelation?: boolean; hideBotEvents?: boolean } | null;
  /** 保持期間の入力が不正なカテゴリ。1つでもあれば保存できない。 */
  invalidRetention: LogCategory[];
}

export function diffLogSettings(server: LogSettingsServerState, draft: LogSettingsDraft): LogSettingsChanges {
  const invalidRetention: LogCategory[] = [];
  const retention = server.retention.flatMap(({ category, retentionDays }) => {
    const parsed = parseRetentionDaysInput(draft.retention[category] ?? String(retentionDays));
    if (parsed === null) {
      invalidRetention.push(category);
      return [];
    }
    return parsed === retentionDays ? [] : [{ category, retentionDays: parsed }];
  });
  const channel = server.channel.flatMap(({ category, channelId }) => {
    const next = draft.channel[category] === undefined ? channelId : (draft.channel[category] ?? null);
    return next === channelId ? [] : [{ category, channelId: next }];
  });
  const display: { hideAuditLogCorrelation?: boolean; hideBotEvents?: boolean } = {};
  if (server.display && draft.showAuditLogCorrelation === server.display.hideAuditLogCorrelation) {
    display.hideAuditLogCorrelation = !draft.showAuditLogCorrelation;
  }
  if (server.display && draft.showBotEvents === server.display.hideBotEvents) {
    display.hideBotEvents = !draft.showBotEvents;
  }
  return { retention, channel, display: Object.keys(display).length > 0 ? display : null, invalidRetention };
}

export function hasLogSettingsChanges(changes: LogSettingsChanges): boolean {
  return (
    changes.retention.length > 0 || changes.channel.length > 0 || changes.display !== null || changes.invalidRetention.length > 0
  );
}

/**
 * 全カテゴリが同じ新しい値に変わるなら一括APIで1回、そうでなければカテゴリごとに送る。
 * 戻り値のallは一括APIへ渡す値(undefinedなら一括にできない)。
 */
export function planBulk<T>(
  totalCategories: number,
  changes: readonly { value: T }[],
  draftValues: readonly T[],
): { all: T | undefined } {
  const uniform = uniformValue(draftValues);
  return { all: changes.length > 0 && draftValues.length === totalCategories && uniform !== undefined ? uniform : undefined };
}
