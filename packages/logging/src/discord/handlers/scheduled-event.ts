import type { FeatureModuleContext } from "@management-bot/core";
import type { GuildScheduledEvent, PartialGuildScheduledEvent } from "discord.js";
import type { LogEntry } from "../../domain/index.js";
import type { WriteLogEntryDeps } from "../../application/index.js";
import { createSendToChannel } from "../send-to-channel.js";
import { writeLogEntrySafely } from "../write-log-entry-safely.js";

export function toScheduledEventCreateLogEntry(event: GuildScheduledEvent): LogEntry {
  return { category: "scheduledEvent", guildId: event.guildId, createdAt: new Date().toISOString(), eventId: event.id, action: "create" };
}

export function toScheduledEventDeleteLogEntry(event: GuildScheduledEvent | PartialGuildScheduledEvent): LogEntry {
  return { category: "scheduledEvent", guildId: event.guildId, createdAt: new Date().toISOString(), eventId: event.id, action: "delete" };
}

/** statusがActive/Completed/Canceledへ遷移した場合はstart/complete/cancel、それ以外(日時変更等)はupdateとして記録する。 */
export function toScheduledEventUpdateLogEntry(
  oldEvent: GuildScheduledEvent | PartialGuildScheduledEvent | null,
  newEvent: GuildScheduledEvent,
): LogEntry {
  let action: "start" | "complete" | "cancel" | "update" = "update";
  if (newEvent.isActive() && !oldEvent?.isActive()) action = "start";
  else if (newEvent.isCompleted() && !oldEvent?.isCompleted()) action = "complete";
  else if (newEvent.isCanceled() && !oldEvent?.isCanceled()) action = "cancel";

  return { category: "scheduledEvent", guildId: newEvent.guildId, createdAt: new Date().toISOString(), eventId: newEvent.id, action };
}

export function registerScheduledEventHandlers(ctx: FeatureModuleContext): void {
  const deps: WriteLogEntryDeps = { db: ctx.db, sendToChannel: createSendToChannel(ctx) };

  ctx.client.on("guildScheduledEventCreate", (event) => writeLogEntrySafely(deps, toScheduledEventCreateLogEntry(event)));
  ctx.client.on("guildScheduledEventDelete", (event) => writeLogEntrySafely(deps, toScheduledEventDeleteLogEntry(event)));
  ctx.client.on("guildScheduledEventUpdate", (oldEvent, newEvent) =>
    writeLogEntrySafely(deps, toScheduledEventUpdateLogEntry(oldEvent, newEvent)),
  );
}
