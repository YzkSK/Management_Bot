import { describe, expect, mock, test } from "bun:test";
import { CAPABILITIES } from "@management-bot/shared";
import type { WSContext } from "hono/ws";
import { createGuildDataBroadcaster, type GuildDataClient } from "./guild-data-broadcaster.js";

function fakeClient(capabilities: number, sendImpl: () => void = () => undefined) {
  const send = mock(sendImpl);
  const client: GuildDataClient = { ws: { send } as unknown as WSContext, capabilities };
  return { client, send };
}

describe("guild-data-broadcaster", () => {
  test("topicの閲覧capabilityを持つクライアントにだけ{type:changed,topic}を送る", () => {
    const b = createGuildDataBroadcaster();
    const viewer = fakeClient(CAPABILITIES.VIEW_AUDIT_LOG);
    const noPerm = fakeClient(CAPABILITIES.VIEW_LOGS);
    b.register("g1", viewer.client);
    b.register("g1", noPerm.client);

    b.broadcast("g1", "auditLog");

    expect(viewer.send).toHaveBeenCalledWith(JSON.stringify({ type: "changed", topic: "auditLog" }));
    expect(noPerm.send).not.toHaveBeenCalled();
  });

  test("scheduledPostとaccessは必須capabilityなし(capabilities=0でも届く。権限変更を本人に反映するため)", () => {
    const b = createGuildDataBroadcaster();
    const member = fakeClient(0);
    b.register("g1", member.client);

    b.broadcast("g1", "scheduledPost");
    b.broadcast("g1", "access");
    b.broadcast("g1", "moderation");

    expect(member.send.mock.calls.map(([m]) => JSON.parse(String(m)).topic)).toEqual(["scheduledPost", "access"]);
  });

  test("各topicは対応するcapabilityで絞られる", () => {
    const b = createGuildDataBroadcaster();
    const c = fakeClient(CAPABILITIES.VIEW_TEMP_VOICE);
    b.register("g1", c.client);

    for (const topic of ["tempVoice", "moderation", "loggingSettings", "auditLog"] as const) {
      b.broadcast("g1", topic);
    }

    expect(c.send.mock.calls.map(([m]) => JSON.parse(String(m)).topic)).toEqual(["tempVoice"]);
  });

  test("capabilitiesの更新(定期再検証)が以降の通知に反映される", () => {
    const b = createGuildDataBroadcaster();
    const c = fakeClient(CAPABILITIES.MANAGE_MODERATION);
    b.register("g1", c.client);
    c.client.capabilities = 0;

    b.broadcast("g1", "moderation");

    expect(c.send).not.toHaveBeenCalled();
  });

  test("別guild・解除済みには送らない", () => {
    const b = createGuildDataBroadcaster();
    const other = fakeClient(0);
    const gone = fakeClient(0);
    b.register("g2", other.client);
    b.register("g1", gone.client);
    b.unregister("g1", gone.client);

    b.broadcast("g1", "scheduledPost");

    expect(other.send).not.toHaveBeenCalled();
    expect(gone.send).not.toHaveBeenCalled();
  });

  test("send失敗のクライアントがいても他へ配信を続ける", () => {
    const b = createGuildDataBroadcaster();
    const broken = fakeClient(0, () => {
      throw new Error("closed");
    });
    const ok = fakeClient(0);
    b.register("g1", broken.client);
    b.register("g1", ok.client);
    const spy = mock(() => undefined);
    const original = console.error;
    console.error = spy;
    try {
      b.broadcast("g1", "scheduledPost");
    } finally {
      console.error = original;
    }

    expect(ok.send).toHaveBeenCalledTimes(1);
  });
});
