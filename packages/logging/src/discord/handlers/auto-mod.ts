import type { FeatureModuleContext } from "@management-bot/core";
import type { AutoModerationActionExecution, AutoModerationRule } from "discord.js";
import type { LogEntry } from "../../domain/index.js";
import type { WriteLogEntryDeps } from "../../application/index.js";
import { createSendToChannel } from "../send-to-channel.js";
import { writeLogEntrySafely } from "../write-log-entry-safely.js";

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
    channelId: execution.channelId ?? undefined,
    action: "actionExecuted",
  };
}

export function registerAutoModHandlers(ctx: FeatureModuleContext): void {
  const deps: WriteLogEntryDeps = { db: ctx.db, sendToChannel: createSendToChannel(ctx) };

  ctx.client.on("autoModerationRuleCreate", (rule) => writeLogEntrySafely(deps, toAutoModRuleCreateLogEntry(rule)));
  ctx.client.on("autoModerationRuleUpdate", (_oldRule, newRule) =>
    writeLogEntrySafely(deps, toAutoModRuleUpdateLogEntry(newRule)),
  );
  ctx.client.on("autoModerationRuleDelete", (rule) => writeLogEntrySafely(deps, toAutoModRuleDeleteLogEntry(rule)));
  ctx.client.on("autoModerationActionExecution", (execution) =>
    writeLogEntrySafely(deps, toAutoModActionExecutedLogEntry(execution)),
  );
}
