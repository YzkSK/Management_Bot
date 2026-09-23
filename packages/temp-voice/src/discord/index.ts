import type { FeatureModuleContext } from "@management-bot/core";
import { canRenameWithinRateLimit } from "../domain/index.js";
import { handleVoiceCreate } from "./voice-create.js";
import { handleTempVoiceButton } from "./handle-button.js";
import { handleTempVoiceModalSubmit } from "./handle-modal-submit.js";
import { handleTempVoiceSelectMenu } from "./handle-select-menu.js";
import { handleTempVoiceRemoveMember } from "./handle-remove-member.js";

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
  /** モーダルを開く前の目安チェックのみ(予約しない)。実際の消費判定はtryReserveRenameSlotで行う。 */
  const canRename = (channelId: string): boolean =>
    canRenameWithinRateLimit(renameTimestamps.get(channelId) ?? [], Date.now());
  /**
   * モーダル送信時(handle-modal-submit.ts)、実際にrenameを実行する直前に呼ぶ。チェックと予約
   * (タイムスタンプ追加)をアトミックに行うことで、モーダルを開いてから送信するまでの間に
   * 他の実行が割り込んでも、window内の実際の実行回数を超えて許可しない(codexレビュー指摘:
   * モーダル表示時のみチェックするとTOCTOUで3回目のrenameが素通りしていた)。
   */
  const tryReserveRenameSlot = (channelId: string): boolean => {
    const now = Date.now();
    const timestamps = renameTimestamps.get(channelId) ?? [];
    if (!canRenameWithinRateLimit(timestamps, now)) return false;
    renameTimestamps.set(channelId, [...timestamps, now]);
    return true;
  };

  ctx.client.on("interactionCreate", (interaction) => {
    // 他機能パッケージのボタン/モーダル/セレクトメニューと混在するため、customIdのprefixで早期に絞り込む。
    if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isUserSelectMenu() && !interaction.isRoleSelectMenu()) {
      return;
    }
    if (!interaction.customId.startsWith("temp-voice:")) return;

    if (interaction.isButton()) {
      // removeMember(メンバー管理一覧の解除ボタン、#409)はTEMP_VOICE_BUTTON_ACTIONSに含まれない
      // 別のcustomId形式(temp-voice:removeMember:<channelId>:<targetType>:<targetId>)のため、
      // 専用ハンドラに先に振り分ける(handleTempVoiceButtonはparseTempVoiceCustomIdで弾かれ無視する)。
      if (interaction.customId.startsWith("temp-voice:removeMember:")) {
        handleTempVoiceRemoveMember({ db: ctx.db, eventBus: ctx.eventBus }, interaction).catch((error: unknown) => {
          console.error("temp-voice: failed to handle remove-member interaction", error);
        });
        return;
      }
      handleTempVoiceButton({ db: ctx.db, eventBus: ctx.eventBus, canRename }, interaction).catch(
        (error: unknown) => {
          console.error("temp-voice: failed to handle button interaction", error);
        },
      );
      return;
    }
    if (interaction.isUserSelectMenu() || interaction.isRoleSelectMenu()) {
      handleTempVoiceSelectMenu({ db: ctx.db, eventBus: ctx.eventBus }, interaction).catch((error: unknown) => {
        console.error("temp-voice: failed to handle select menu interaction", error);
      });
      return;
    }
    handleTempVoiceModalSubmit({ db: ctx.db, eventBus: ctx.eventBus, tryReserveRenameSlot }, interaction).catch(
      (error: unknown) => {
        console.error("temp-voice: failed to handle modal submit interaction", error);
      },
    );
  });
}
