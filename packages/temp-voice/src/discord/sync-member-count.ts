import type { Db } from "@management-bot/db";
import type { VoiceState } from "discord.js";
import { setTempVoiceMemberCount } from "../application/index.js";
import type { VoiceSessionStore } from "./voice-session-store.js";

export interface SyncTempVoiceMemberCountDeps {
  db: Db;
  sessionStore: VoiceSessionStore;
  /** テスト用のDI。省略時はsetTempVoiceMemberCountを使う。 */
  setMemberCount?: typeof setTempVoiceMemberCount;
}

/**
 * Dashboard一覧・強制削除確認ダイアログの在室人数表示用に、追跡対象(一時VC)の
 * 入退室のたびにtemp_voice_channels.member_countをDBへ同期する(#415)。
 * ponytail: voiceStateUpdateごとに同期的にDB書き込みするため多少のラグ・失敗は許容する
 * (誤操作防止という目的には十分、リトライ・整合性保証は行わない)。
 */
export function syncTempVoiceMemberCount(
  deps: SyncTempVoiceMemberCountDeps,
  oldState: VoiceState,
  newState: VoiceState,
): void {
  const setMemberCount = deps.setMemberCount ?? setTempVoiceMemberCount;
  const oldChannel = oldState.channel;
  const newChannel = newState.channel;

  if (oldChannel && deps.sessionStore.isTracked(oldChannel.id)) {
    setMemberCount(deps.db, oldChannel.id, oldChannel.members.size).catch((error: unknown) => {
      console.error(`temp-voice: failed to sync member count for channel ${oldChannel.id}`, error);
    });
  }
  if (newChannel && deps.sessionStore.isTracked(newChannel.id)) {
    setMemberCount(deps.db, newChannel.id, newChannel.members.size).catch((error: unknown) => {
      console.error(`temp-voice: failed to sync member count for channel ${newChannel.id}`, error);
    });
  }
}
