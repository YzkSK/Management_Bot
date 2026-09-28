import { describe, expect, mock, test } from "bun:test";
import { forceDeleteTempVoiceChannel } from "./force-delete-channel.js";

const ROW = { channelId: "vc-1", guildId: "g1", controlChannelId: "ctrl-1", ownerId: "owner-1" };

function fakeDb(row: typeof ROW | null) {
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve(row ? [row] : []) }) }),
    delete: () => ({ where: () => Promise.resolve() }),
  };
}

function fakeGuild(options: {
  voiceChannel?: { id: string; delete: ReturnType<typeof mock> } | null;
  controlChannel?: { id: string; delete: ReturnType<typeof mock> } | null;
}) {
  const { voiceChannel, controlChannel } = options;
  const byId = new Map<string, unknown>();
  if (voiceChannel) byId.set(voiceChannel.id, voiceChannel);
  if (controlChannel) byId.set(controlChannel.id, controlChannel);
  return {
    channels: {
      cache: { get: (id: string) => byId.get(id) },
      fetch: (id: string) => Promise.resolve(byId.get(id) ?? null),
    },
  };
}

describe("forceDeleteTempVoiceChannel", () => {
  test("実在するチャンネルを削除しDBからも消し、deletedイベントをpublishする(#415)", async () => {
    const vcDelete = mock(async () => {});
    const ctrlDelete = mock(async () => {});
    const guild = fakeGuild({
      voiceChannel: { id: "vc-1", delete: vcDelete },
      controlChannel: { id: "ctrl-1", delete: ctrlDelete },
    });
    const publish = mock(async () => {});
    const db = fakeDb(ROW);

    const result = await forceDeleteTempVoiceChannel(
      { db: db as never, eventBus: { publish } as never },
      guild as never,
      "vc-1",
      "moderator-1",
    );

    expect(result).toBe("deleted");
    expect(vcDelete).toHaveBeenCalled();
    expect(ctrlDelete).toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: "temp-voice.event.recorded", action: "deleted", executorId: "moderator-1" }),
    );
  });

  test("DB行が存在しないchannelIdはnot_foundを返し何もしない(#415)", async () => {
    const publish = mock(async () => {});
    const db = fakeDb(null);
    const guild = fakeGuild({});

    const result = await forceDeleteTempVoiceChannel(
      { db: db as never, eventBus: { publish } as never },
      guild as never,
      "missing",
      "moderator-1",
    );

    expect(result).toBe("not_found");
    expect(publish).not.toHaveBeenCalled();
  });
});
