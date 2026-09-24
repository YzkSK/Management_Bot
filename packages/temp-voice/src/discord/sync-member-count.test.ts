import { describe, expect, mock, test } from "bun:test";
import { syncTempVoiceMemberCount } from "./sync-member-count.js";
import { VoiceSessionStore } from "./voice-session-store.js";

function createVoiceState(channelId: string | null, membersSize: number) {
  return {
    channelId,
    channel: channelId ? { id: channelId, members: { size: membersSize } } : null,
  } as never;
}

describe("syncTempVoiceMemberCount", () => {
  test("追跡対象チャンネルへの入室でmember_countを更新する", () => {
    const sessionStore = new VoiceSessionStore();
    sessionStore.startTrackingChannel("vc-1");
    const setCount = mock(async () => {});
    const oldState = createVoiceState(null, 0);
    const newState = createVoiceState("vc-1", 1);

    syncTempVoiceMemberCount({ db: {} as never, sessionStore, setMemberCount: setCount }, oldState, newState);

    expect(setCount).toHaveBeenCalledWith(expect.anything(), "vc-1", 1);
  });

  test("追跡対象外のチャンネルは無視する", () => {
    const sessionStore = new VoiceSessionStore();
    const setCount = mock(async () => {});
    const oldState = createVoiceState(null, 0);
    const newState = createVoiceState("vc-untracked", 1);

    syncTempVoiceMemberCount({ db: {} as never, sessionStore, setMemberCount: setCount }, oldState, newState);

    expect(setCount).not.toHaveBeenCalled();
  });

  test("追跡対象チャンネルからの退出でも退出後の人数で更新する", () => {
    const sessionStore = new VoiceSessionStore();
    sessionStore.startTrackingChannel("vc-1");
    const setCount = mock(async () => {});
    const oldState = createVoiceState("vc-1", 0);
    const newState = createVoiceState(null, 0);

    syncTempVoiceMemberCount({ db: {} as never, sessionStore, setMemberCount: setCount }, oldState, newState);

    expect(setCount).toHaveBeenCalledWith(expect.anything(), "vc-1", 0);
  });
});
