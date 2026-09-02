import type { FeatureModuleContext } from "@management-bot/core";
import type { Invite } from "discord.js";
import type { LogEntry } from "../../domain/index.js";
import type { WriteLogEntryDeps } from "../../application/index.js";
import { createSendToChannel } from "../send-to-channel.js";
import { writeLogEntrySafely } from "../write-log-entry-safely.js";

/** guild/channelId不明(グループDM由来等)の招待はschemaを満たせないためスキップする。 */
function baseFields(invite: Invite): { guildId: string; channelId: string; code: string } | undefined {
  if (!invite.guild || !invite.channelId) return undefined;
  return { guildId: invite.guild.id, channelId: invite.channelId, code: invite.code };
}

export function toInviteCreateLogEntry(invite: Invite): LogEntry | undefined {
  const base = baseFields(invite);
  if (!base) return undefined;
  return { category: "invite", ...base, createdAt: new Date().toISOString(), action: "create" };
}

export function toInviteDeleteLogEntry(invite: Invite): LogEntry | undefined {
  const base = baseFields(invite);
  if (!base) return undefined;
  return { category: "invite", ...base, createdAt: new Date().toISOString(), action: "delete" };
}

export function registerInviteHandlers(ctx: FeatureModuleContext): void {
  const deps: WriteLogEntryDeps = { db: ctx.db, sendToChannel: createSendToChannel(ctx) };

  ctx.client.on("inviteCreate", (invite) => {
    const entry = toInviteCreateLogEntry(invite);
    if (entry) writeLogEntrySafely(deps, entry);
  });
  ctx.client.on("inviteDelete", (invite) => {
    const entry = toInviteDeleteLogEntry(invite);
    if (entry) writeLogEntrySafely(deps, entry);
  });
}
