import type { DomainEventBus } from "@management-bot/core";
import { withResourceLock as withResourceLockDefault, type Db } from "@management-bot/db";
import type { Client, GuildMember, VoiceBasedChannel } from "discord.js";
import { type TempVoiceChannelRow, transferTempVoiceOwner } from "../application/index.js";
import {
  editControlChannelViewer,
  grantOwnerVoiceAccess,
  revokeOwnerVoiceAccess,
  rollbackGrantedViewerIfNotOwner,
} from "./control-channel-permission.js";
import { announceOwnerTransfer } from "./owner-transfer-notice.js";
import { OWNER_TRANSFER_LOCK_KEY_PREFIX } from "./run-grace.js";

export interface ExecuteOwnerTransferInput {
  db: Db;
  client: Client;
  eventBus: DomainEventBus;
  /** テスト時に差し替え可能にするため注入する(デフォルトは@management-bot/dbの実装、run-grace.ts参照)。 */
  withResourceLock?: typeof withResourceLockDefault;
  row: TempVoiceChannelRow;
  voiceChannel: VoiceBasedChannel;
  newOwnerMember: GuildMember;
  executor: { id: string; name: string };
  previousOwnerName: string;
  /** 失敗をユーザーに伝える(Discord経路はephemeralフォローアップ、Dashboard経路はログのみ)。 */
  onFailure: (content: string) => Promise<void>;
  /** 移譲確定後の制御パネル再描画(Discord経路はinteraction.editReply)。失敗しても処理は続行する。 */
  refreshPanel: () => Promise<void>;
}

/**
 * オーナー移譲(手動)の実処理(#410)。Discordのセレクトメニュー(handle-transfer-owner.ts)と
 * Dashboard経由(apply-dashboard-action.ts、#649)で共有する。interactionには依存せず、
 * ユーザーへの通知と制御パネル再描画だけを呼び出し側のコールバックに委ねる。
 * 制御チャンネルの閲覧権限付け替え→DB更新(compare-and-swapで猶予情報も同時にクリア。自動再割当cronと
 * 同時に走った場合は後から実行される側のCASが0行更新となり二重移譲を防ぐ)→
 * temp-voice.event.recorded(action=ownerTransferred, trigger=manual)のpublish。
 */
export async function executeOwnerTransfer(input: ExecuteOwnerTransferInput): Promise<void> {
  const { db, client, eventBus, row, voiceChannel, newOwnerMember, executor, onFailure } = input;
  const newOwnerId = newOwnerMember.id;

  // チャンネル単位のadvisory lockでrun-grace.ts(自動再割当cron)と排他する(codexレビュー指摘:
  // rollbackGrantedViewerIfNotOwnerのDB再確認だけでは、確認からDiscord書き込みまでの間に
  // 相手側の処理が割り込むTOCTOUが残っていた。ロックで「権限付与→DB確定/ロールバック」の
  // 一連の処理を排他することでTOCTOUを解消する)。lockedDb(withResourceLockが予約した専用
  // コネクション)を使い、通常プール(deps.db)へのクエリ発行を避ける(codexレビュー指摘:
  // 通常プールにクエリを発行すると、多数のチャンネルが同時にロック待ちになった際に
  // プールの空き接続が枯渇しデッドロックする)。
  const withResourceLock = input.withResourceLock ?? withResourceLockDefault;
  await withResourceLock(db, `${OWNER_TRANSFER_LOCK_KEY_PREFIX}${voiceChannel.id}`, async (lockedDb) => {
    try {
      await editControlChannelViewer(client, row.controlChannelId, newOwnerId, true);
      try {
        await grantOwnerVoiceAccess(voiceChannel, newOwnerId);
      } catch (error) {
        // VC本体側の権限付与に失敗した場合、直前に付与した制御チャンネル閲覧権限が孤立して
        // 残らないようロールバックする(codexレビュー指摘: 順序が逆だと制御チャンネル権限だけが
        // 残ったままDB更新に進んでしまう)。
        await editControlChannelViewer(client, row.controlChannelId, newOwnerId, null).catch((rollbackError: unknown) => {
          console.error(`temp-voice: failed to roll back control channel permission for ${voiceChannel.id} after voice grant error`, rollbackError);
        });
        throw error;
      }
    } catch (error) {
      await onFailure("オーナー移譲に失敗しました。時間を置いて再度お試しください。");
      throw error;
    }

    let result: Awaited<ReturnType<typeof transferTempVoiceOwner>>;
    try {
      result = await transferTempVoiceOwner(lockedDb, voiceChannel.id, row.ownerId, newOwnerId);
    } catch (error) {
      // unique制約違反以外のDBエラー(接続断等)。付与済みの権限をDBの現オーナーで確認しつつロールバック
      // する(codexレビュー指摘: 例外がそのまま伝播すると付与済み権限が孤立して残ってしまう)。
      await rollbackGrantedViewerIfNotOwner(lockedDb, client, voiceChannel.id, row.controlChannelId, newOwnerId, voiceChannel).catch(
        (rollbackError: unknown) => {
          console.error(`temp-voice: failed to roll back control channel permission for ${voiceChannel.id} after DB error`, rollbackError);
        },
      );
      await onFailure("オーナー移譲に失敗しました。時間を置いて再度お試しください。");
      throw error;
    }
    if (result !== "committed") {
      // "lostRace": 自動再割当cronが先にオーナーを変更済み(codexレビュー指摘: 手動移譲とcronの競合)。
      // "newOwnerAlreadyOwnsChannel": 事前チェックをすり抜けたrace conditionで移譲先が別VCの
      // オーナーになっていた(codexレビュー指摘)。いずれもDBの現オーナーを再確認してから付与した
      // 閲覧権限を戻す。
      await rollbackGrantedViewerIfNotOwner(lockedDb, client, voiceChannel.id, row.controlChannelId, newOwnerId, voiceChannel).catch(
        (error: unknown) => {
          console.error(`temp-voice: failed to roll back control channel permission for ${voiceChannel.id} after ${result}`, error);
        },
      );
      await onFailure(
        result === "newOwnerAlreadyOwnsChannel"
          ? "オーナー移譲に失敗しました。選択されたメンバーは既に別の一時VCのオーナーです。"
          : "オーナー移譲に失敗しました。既に他の処理でオーナーが変更されている可能性があります。",
      );
      return;
    }

    await editControlChannelViewer(client, row.controlChannelId, row.ownerId, null).catch((error: unknown) => {
      // DB更新は既に確定しているため、旧オーナーの権限剥奪失敗は握りつぶしログのみ(孤立した閲覧権限が残るだけで実害は小さい)。
      console.error(`temp-voice: failed to revoke previous owner control channel permission for ${voiceChannel.id}`, error);
    });
    await revokeOwnerVoiceAccess(lockedDb, voiceChannel, row.ownerId).catch((error: unknown) => {
      console.error(`temp-voice: failed to revoke previous owner voice channel permission for ${voiceChannel.id}`, error);
    });

    // DB移譲は確定済みのため、パネル再描画の失敗で通知・イベント発行を止めない(#531、codexレビュー指摘)。
    await input.refreshPanel().catch((error: unknown) => {
      console.error(`temp-voice: failed to refresh control panel for ${voiceChannel.id} after owner transfer`, error);
    });

    await announceOwnerTransfer(client, row.controlChannelId, row.ownerId, newOwnerId, "manual");

    await eventBus.publish({
      type: "temp-voice.event.recorded",
      action: "ownerTransferred",
      guildId: row.guildId,
      channelId: voiceChannel.id,
      executorId: executor.id,
      executorName: executor.name,
      previousOwnerId: row.ownerId,
      previousOwnerName: input.previousOwnerName,
      newOwnerId,
      newOwnerName: newOwnerMember.displayName,
      trigger: "manual",
      createdAt: new Date().toISOString(),
    });
  });
}
