import type { FeatureModuleContext } from "@management-bot/core";
import cron from "node-cron";
import { canRenameWithinRateLimit } from "../domain/index.js";
import { handleVoiceCreate } from "./voice-create.js";
import { handleVoiceSession } from "./handle-voice-session.js";
import { VoiceSessionStore } from "./voice-session-store.js";
import { handleTempVoiceButton } from "./handle-button.js";
import { handleTempVoiceModalSubmit } from "./handle-modal-submit.js";
import { handleTempVoiceSelectMenu } from "./handle-select-menu.js";
import { handleTempVoiceRemoveMember } from "./handle-remove-member.js";
import { handleTempVoiceTransferOwner } from "./handle-transfer-owner.js";
import { handleOwnerGrace } from "./handle-owner-grace.js";
import { createGraceRunner } from "./run-grace.js";
import { EmptyChannelDeletionScheduler, handleEmptyChannel } from "./handle-empty-channel.js";

/** オーナー不在からVC自動再割当までの猶予期間(#410)。 */
const OWNER_GRACE_PERIOD_MS = 10 * 60 * 1000;
const GRACE_CRON_TIMEZONE = "Asia/Tokyo";

export function registerDiscordHandlers(ctx: FeatureModuleContext): void {
  // 一時VC内メンバーの入退室セッションをプロセス内メモリで管理する(#414)。
  // プロセス起動時に1回だけ生成し、voice-create.ts(作成時のオーナー入室)と
  // handle-voice-session.ts(以降の入退室・移動)の両方で共有する。
  const sessionStore = new VoiceSessionStore();
  const voiceCreateDeps = { db: ctx.db, eventBus: ctx.eventBus, sessionStore };
  // 無人一時VCの削除猶予タイマーをプロセス内メモリで管理する(#411)。sessionStoreと同様プロセス起動時に1回だけ生成する。
  const emptyChannelScheduler = new EmptyChannelDeletionScheduler();
  const emptyChannelDeps = { db: ctx.db, eventBus: ctx.eventBus, sessionStore };

  ctx.client.on("voiceStateUpdate", (oldState, newState) => {
    handleVoiceCreate(voiceCreateDeps, newState).catch((error: unknown) => {
      console.error("temp-voice: failed to handle voiceStateUpdate (Join to Create)", error);
    });
    handleVoiceSession({ eventBus: ctx.eventBus, sessionStore }, oldState, newState).catch((error: unknown) => {
      console.error("temp-voice: failed to handle voiceStateUpdate (session tracking)", error);
    });
    handleOwnerGrace({ db: ctx.db, gracePeriodMs: OWNER_GRACE_PERIOD_MS }, oldState, newState).catch((error: unknown) => {
      console.error("temp-voice: failed to handle voiceStateUpdate (owner grace period)", error);
    });
    handleEmptyChannel(emptyChannelDeps, emptyChannelScheduler, oldState, newState);
  });

  // 一時VC削除時(制御パネルからの明示削除・手動削除・#411の無人削除等、経路を問わず)に
  // 残存セッションを強制終了する(#414、codexレビュー指摘)。channelDeleteは制御チャンネル削除でも
  // 発火するが、isTrackedで一時VC(音声チャンネル)のみに絞られるため無害。
  // 併せて#411の削除猶予タイマーも解除する(他経路で既に削除済みのチャンネルに対し無駄な
  // 再確認・二重削除を試みないようにするため)。
  ctx.client.on("channelDelete", (channel) => {
    if (channel.isDMBased() || !sessionStore.isTracked(channel.id)) return;
    emptyChannelScheduler.cancel(channel.id);
    sessionStore.endAllSessionsForChannel(ctx.eventBus, channel.guildId, channel.id, new Date()).catch((error: unknown) => {
      console.error(`temp-voice: failed to end sessions for deleted channel ${channel.id}`, error);
    });
  });

  // オーナー不在の猶予期限切れVCを自動再割当するcron(#410)。「VC内最古参メンバー」の判定に
  // このプロセス内のsessionStore(#414)が必要なため、独立cronアプリではなくbot本体プロセス内で
  // node-cron登録する(run-grace.tsのコメント参照)。
  const graceCron = ctx.env.TEMP_VOICE_GRACE_CRON ?? "* * * * *";
  if (!cron.validate(graceCron)) {
    throw new Error(`Invalid TEMP_VOICE_GRACE_CRON: ${graceCron}`);
  }
  const graceRunner = createGraceRunner({ db: ctx.db, client: ctx.client, eventBus: ctx.eventBus, sessionStore });
  const graceTask = cron.schedule(graceCron, () => void graceRunner.run(), { timezone: GRACE_CRON_TIMEZONE });
  ctx.onShutdown(async () => {
    graceTask.stop();
    await graceRunner.waitForIdle();
    // 無人削除の猶予タイマー(#411)もshutdown時に解除する(codexレビュー指摘: cronのみ停止すると
    // 最大graceMs(既定30秒)分、client.destroy()やDB切断後にタイマーが残りプロセスがぶら下がる)。
    emptyChannelScheduler.cancelAll();
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
    if (
      !interaction.isButton() &&
      !interaction.isModalSubmit() &&
      !interaction.isUserSelectMenu() &&
      !interaction.isRoleSelectMenu() &&
      !interaction.isStringSelectMenu()
    ) {
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
    if (interaction.isStringSelectMenu()) {
      handleTempVoiceTransferOwner({ db: ctx.db, eventBus: ctx.eventBus }, interaction).catch((error: unknown) => {
        console.error("temp-voice: failed to handle transfer-owner select menu interaction", error);
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
