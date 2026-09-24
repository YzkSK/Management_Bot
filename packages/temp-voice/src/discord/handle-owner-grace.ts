import type { Db } from "@management-bot/db";
import type { VoiceState } from "discord.js";
import { clearGracePeriod, findTempVoiceChannel, startGracePeriod } from "../application/index.js";

export interface HandleOwnerGraceDeps {
  db: Db;
  gracePeriodMs: number;
}

/**
 * 一時VCのオーナーが自分のVCから退出/再入室した際に、猶予期間(#410)の開始・解除を行う。
 * ギルド離脱・kick・banによる強制切断も同じvoiceStateUpdate経由で検知されるため、
 * 退出経路を区別する必要はない(issue本文の通り)。
 * 猶予期限切れ時の自動再割当自体はこのハンドラの範囲外(run-grace.tsのcronが担当)。
 */
export async function handleOwnerGrace(deps: HandleOwnerGraceDeps, oldState: VoiceState, newState: VoiceState): Promise<void> {
  const oldChannelId = oldState.channelId;
  const newChannelId = newState.channelId;
  const userId = newState.id;

  if (oldChannelId === newChannelId) return;

  // 退出: オーナーが自分の一時VCから離れたら猶予を開始する。
  if (oldChannelId) {
    const oldRow = await findTempVoiceChannel(deps.db, oldChannelId);
    if (oldRow && oldRow.ownerId === userId) {
      await startGracePeriod(deps.db, oldChannelId, userId, new Date(Date.now() + deps.gracePeriodMs));
    }
  }

  // 入室: 入室先が自分がオーナーの一時VCなら猶予を解除する。他人の一時VCへの入室は対象外。
  // 1ユーザーが同時にオーナーになれる一時VCは高々1つ(guildId+ownerIdのunique制約、#406)のため、
  // 「自分がオーナーの一時VC」は常に猶予中だったVC自身と一致する(issueの「同じVCへ再入室」と等価)。
  if (newChannelId) {
    const newRow = await findTempVoiceChannel(deps.db, newChannelId);
    if (newRow && newRow.ownerId === userId) {
      await clearGracePeriod(deps.db, newChannelId, userId);
    }
  }
}
