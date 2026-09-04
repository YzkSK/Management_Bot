import type { FeatureModuleContext } from "@management-bot/core";
import type { StageInstance } from "discord.js";
import type { LogEntry } from "../../domain/index.js";
import type { WriteLogEntryDeps } from "../../application/index.js";
import { createSendToChannel } from "../send-to-channel.js";
import { writeLogEntrySafely } from "../write-log-entry-safely.js";

/** discord.jsにステージ開始/終了専用イベントはないため、create=start、delete=endとして扱う。 */
export function toStageStartLogEntry(stageInstance: StageInstance): LogEntry {
  return {
    category: "stage",
    guildId: stageInstance.guildId,
    createdAt: new Date().toISOString(),
    stageInstanceId: stageInstance.id,
    channelId: stageInstance.channelId,
    action: "start",
  };
}

export function toStageUpdateLogEntry(_oldStageInstance: StageInstance | null, newStageInstance: StageInstance): LogEntry {
  return {
    category: "stage",
    guildId: newStageInstance.guildId,
    createdAt: new Date().toISOString(),
    stageInstanceId: newStageInstance.id,
    channelId: newStageInstance.channelId,
    action: "update",
  };
}

export function toStageEndLogEntry(stageInstance: StageInstance): LogEntry {
  return {
    category: "stage",
    guildId: stageInstance.guildId,
    createdAt: new Date().toISOString(),
    stageInstanceId: stageInstance.id,
    channelId: stageInstance.channelId,
    action: "end",
  };
}

export function registerStageHandlers(ctx: FeatureModuleContext): void {
  const deps: WriteLogEntryDeps = { db: ctx.db, sendToChannel: createSendToChannel(ctx) };

  ctx.client.on("stageInstanceCreate", (stageInstance) => writeLogEntrySafely(deps, toStageStartLogEntry(stageInstance)));
  ctx.client.on("stageInstanceUpdate", (oldStageInstance, newStageInstance) =>
    writeLogEntrySafely(deps, toStageUpdateLogEntry(oldStageInstance, newStageInstance)),
  );
  ctx.client.on("stageInstanceDelete", (stageInstance) => writeLogEntrySafely(deps, toStageEndLogEntry(stageInstance)));
}
