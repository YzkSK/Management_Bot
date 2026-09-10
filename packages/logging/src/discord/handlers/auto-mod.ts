import type { FeatureModuleContext } from "@management-bot/core";
import type { AutoModerationActionExecution, AutoModerationRule } from "discord.js";
import type { LogEntry } from "../../domain/index.js";
import type { GetChannelId, WriteLogEntryDeps } from "../../application/index.js";
import { createSendToChannel } from "../send-to-channel.js";
import { writeLogEntrySafely } from "../write-log-entry-safely.js";

/**
 * userId(creatorId)はルールの作成者であり、ruleUpdate/ruleDelete時点の実行者ではない
 * (実行者はaudit log相関のexecutorId/executorNameが担う)。userNameスナップショットを
 * ruleCreate以外にも付けると「作成者=実行者」であるかのように誤読されるため、
 * 実際に表示に使われるactionExecuted(userId=発言者本人)のみに絞る。
 */
export function toAutoModRuleCreateLogEntry(rule: AutoModerationRule): LogEntry {
  return {
    category: "autoMod",
    guildId: rule.guild.id,
    createdAt: new Date().toISOString(),
    ruleId: rule.id,
    userId: rule.creatorId,
    action: "ruleCreate",
  };
}

/** oldRuleは未使用(schema上differenceを表現するフィールドがないため)。旧ルールが未キャッシュ(null)でも記録する。 */
export function toAutoModRuleUpdateLogEntry(newRule: AutoModerationRule): LogEntry {
  return {
    category: "autoMod",
    guildId: newRule.guild.id,
    createdAt: new Date().toISOString(),
    ruleId: newRule.id,
    userId: newRule.creatorId,
    action: "ruleUpdate",
  };
}

export function toAutoModRuleDeleteLogEntry(rule: AutoModerationRule): LogEntry {
  return {
    category: "autoMod",
    guildId: rule.guild.id,
    createdAt: new Date().toISOString(),
    ruleId: rule.id,
    userId: rule.creatorId,
    action: "ruleDelete",
  };
}

export function toAutoModActionExecutedLogEntry(execution: AutoModerationActionExecution): LogEntry {
  return {
    category: "autoMod",
    guildId: execution.guild.id,
    createdAt: new Date().toISOString(),
    ruleId: execution.ruleId,
    userId: execution.userId,
    // creatorIdと異なりuserIdは発言者本人(実行者)のため、guild.members.cacheからの
    // best-effort解決をスナップショットとして残す(audit-log-correlation.tsのexecutorNameと同じパターン)。
    userName: execution.guild.members.cache.get(execution.userId)?.displayName,
    channelId: execution.channelId ?? undefined,
    action: "actionExecuted",
  };
}

export function registerAutoModHandlers(ctx: FeatureModuleContext, getChannelId: GetChannelId): void {
  const deps: WriteLogEntryDeps = { db: ctx.db, sendToChannel: createSendToChannel(ctx), getChannelId };

  ctx.client.on("autoModerationRuleCreate", (rule) => writeLogEntrySafely(deps, toAutoModRuleCreateLogEntry(rule)));
  ctx.client.on("autoModerationRuleUpdate", (_oldRule, newRule) =>
    writeLogEntrySafely(deps, toAutoModRuleUpdateLogEntry(newRule)),
  );
  ctx.client.on("autoModerationRuleDelete", (rule) => writeLogEntrySafely(deps, toAutoModRuleDeleteLogEntry(rule)));
  ctx.client.on("autoModerationActionExecution", (execution) =>
    writeLogEntrySafely(deps, toAutoModActionExecutedLogEntry(execution)),
  );
}
