export interface VoiceStateSnapshot {
  channelId: string | null;
  selfMute: boolean;
  selfDeaf: boolean;
  serverMute: boolean;
  serverDeaf: boolean;
}

/** VC時間として計上する状態か(在室・AFK以外・ミュート/デフでない)。 */
export function isCounting(state: VoiceStateSnapshot, afkChannelId: string | null): boolean {
  if (state.channelId === null || state.channelId === afkChannelId) return false;
  return !(state.selfMute || state.selfDeaf || state.serverMute || state.serverDeaf);
}
