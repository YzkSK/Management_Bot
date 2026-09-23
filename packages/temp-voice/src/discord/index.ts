import type { FeatureModuleContext } from "@management-bot/core";
import { handleVoiceCreate } from "./voice-create.js";
import { handleTempVoiceButton } from "./handle-button.js";
import { handleTempVoiceModalSubmit } from "./handle-modal-submit.js";

export function registerDiscordHandlers(ctx: FeatureModuleContext): void {
  const voiceCreateDeps = { db: ctx.db, eventBus: ctx.eventBus };

  ctx.client.on("voiceStateUpdate", (_oldState, newState) => {
    handleVoiceCreate(voiceCreateDeps, newState).catch((error: unknown) => {
      console.error("temp-voice: failed to handle voiceStateUpdate (Join to Create)", error);
    });
  });

  // renameのレート制限(2回/10分/チャンネル)はプロセス内メモリで判定する(#408)。
  // bot再起動で失われても実害は「制限がリセットされる」程度で許容する。
  const renameTimestamps = new Map<string, number[]>();
  const onRenameSucceeded = (channelId: string, at: number) => {
    const timestamps = renameTimestamps.get(channelId) ?? [];
    renameTimestamps.set(channelId, [...timestamps, at]);
  };

  ctx.client.on("interactionCreate", (interaction) => {
    // 他機能パッケージのボタン/モーダルと混在するため、customIdのprefixで早期に絞り込む。
    if (!interaction.isButton() && !interaction.isModalSubmit()) return;
    if (!interaction.customId.startsWith("temp-voice:")) return;

    if (interaction.isButton()) {
      handleTempVoiceButton({ db: ctx.db, eventBus: ctx.eventBus, renameTimestamps }, interaction).catch(
        (error: unknown) => {
          console.error("temp-voice: failed to handle button interaction", error);
        },
      );
      return;
    }
    handleTempVoiceModalSubmit({ db: ctx.db, eventBus: ctx.eventBus, onRenameSucceeded }, interaction).catch(
      (error: unknown) => {
        console.error("temp-voice: failed to handle modal submit interaction", error);
      },
    );
  });
}
