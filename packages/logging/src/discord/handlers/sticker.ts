import type { FeatureModuleContext } from "@management-bot/core";
import type { Sticker } from "discord.js";
import type { LogEntry } from "../../domain/index.js";
import type { WriteLogEntryDeps } from "../../application/index.js";
import { createSendToChannel } from "../send-to-channel.js";
import { writeLogEntrySafely } from "../write-log-entry-safely.js";

export function toStickerCreateLogEntry(sticker: Sticker): LogEntry | undefined {
  if (!sticker.guildId) return undefined;
  return { category: "sticker", guildId: sticker.guildId, createdAt: new Date().toISOString(), stickerId: sticker.id, action: "create" };
}

export function toStickerUpdateLogEntry(_oldSticker: Sticker, newSticker: Sticker): LogEntry | undefined {
  if (!newSticker.guildId) return undefined;
  return {
    category: "sticker",
    guildId: newSticker.guildId,
    createdAt: new Date().toISOString(),
    stickerId: newSticker.id,
    action: "update",
  };
}

export function toStickerDeleteLogEntry(sticker: Sticker): LogEntry | undefined {
  if (!sticker.guildId) return undefined;
  return { category: "sticker", guildId: sticker.guildId, createdAt: new Date().toISOString(), stickerId: sticker.id, action: "delete" };
}

export function registerStickerHandlers(ctx: FeatureModuleContext): void {
  const deps: WriteLogEntryDeps = { db: ctx.db, sendToChannel: createSendToChannel(ctx) };

  ctx.client.on("stickerCreate", (sticker) => {
    const entry = toStickerCreateLogEntry(sticker);
    if (entry) writeLogEntrySafely(deps, entry);
  });
  ctx.client.on("stickerUpdate", (oldSticker, newSticker) => {
    const entry = toStickerUpdateLogEntry(oldSticker, newSticker);
    if (entry) writeLogEntrySafely(deps, entry);
  });
  ctx.client.on("stickerDelete", (sticker) => {
    const entry = toStickerDeleteLogEntry(sticker);
    if (entry) writeLogEntrySafely(deps, entry);
  });
}
