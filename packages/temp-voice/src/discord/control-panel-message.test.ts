import { describe, expect, test } from "bun:test";
import { PermissionFlagsBits } from "discord.js";
import {
  buildControlPanelContainer,
  buildTempVoiceCustomId,
  parseTempVoiceCustomId,
  readTempVoiceState,
} from "./control-panel-message.js";

describe("buildTempVoiceCustomId / parseTempVoiceCustomId", () => {
  test("customIdを組み立ててパースすると元に戻る", () => {
    const customId = buildTempVoiceCustomId("rename", "channel-1");
    expect(customId).toBe("temp-voice:rename:channel-1");
    expect(parseTempVoiceCustomId(customId)).toEqual({ action: "rename", channelId: "channel-1" });
  });

  test("prefixが違うcustomIdはnullを返す(他機能のボタン)", () => {
    expect(parseTempVoiceCustomId("moderation:approve:123")).toBeNull();
  });

  test("未知のactionはnullを返す", () => {
    expect(parseTempVoiceCustomId("temp-voice:unknown-action:123")).toBeNull();
  });

  test("channelId欠落はnullを返す", () => {
    expect(parseTempVoiceCustomId("temp-voice:rename")).toBeNull();
  });
});

describe("readTempVoiceState", () => {
  function fakeVoiceChannel(overwrite?: { deny: { has: (bit: bigint) => boolean } }) {
    return {
      userLimit: 5,
      bitrate: 96000,
      guild: { roles: { everyone: { id: "everyone-id" } } },
      permissionOverwrites: { cache: { get: () => overwrite } },
    } as never;
  }

  test("overwriteが無ければ未ロック・表示中", () => {
    const state = readTempVoiceState(fakeVoiceChannel(undefined));
    expect(state).toEqual({ userLimit: 5, bitrate: 96000, isLocked: false, isHidden: false });
  });

  test("Connectがdenyならロック中と判定する", () => {
    const state = readTempVoiceState(
      fakeVoiceChannel({ deny: { has: (bit) => bit === PermissionFlagsBits.Connect } }),
    );
    expect(state.isLocked).toBe(true);
    expect(state.isHidden).toBe(false);
  });

  test("ViewChannelがdenyなら非表示中と判定する", () => {
    const state = readTempVoiceState(
      fakeVoiceChannel({ deny: { has: (bit) => bit === PermissionFlagsBits.ViewChannel } }),
    );
    expect(state.isHidden).toBe(true);
    expect(state.isLocked).toBe(false);
  });
});

describe("buildControlPanelContainer", () => {
  test("未ロック・表示中はロック/非表示にするボタンのcustomIdを持つ", () => {
    const container = buildControlPanelContainer("channel-1", {
      userLimit: 0,
      bitrate: 64000,
      isLocked: false,
      isHidden: false,
    });
    const json = container.toJSON();
    const customIds = JSON.stringify(json).match(/temp-voice:[a-zA-Z]+:channel-1/g);
    expect(customIds).toEqual(
      expect.arrayContaining([
        "temp-voice:rename:channel-1",
        "temp-voice:userLimit:channel-1",
        "temp-voice:bitrate:channel-1",
        "temp-voice:toggleLock:channel-1",
        "temp-voice:toggleHide:channel-1",
      ]),
    );
  });

  test("状態を表す文言(人数制限/音質/ロック/表示)がcontainerのテキストに含まれる", () => {
    const container = buildControlPanelContainer("channel-1", {
      userLimit: 10,
      bitrate: 128000,
      isLocked: true,
      isHidden: true,
    });
    const text = JSON.stringify(container.toJSON());
    expect(text).toContain("10人");
    expect(text).toContain("128 kbps");
    expect(text).toContain("ロック中");
  });
});
