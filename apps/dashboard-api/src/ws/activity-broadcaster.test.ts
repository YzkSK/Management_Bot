import { describe, expect, mock, test } from "bun:test";
import type { WSContext } from "hono/ws";
import { activityClients, handleActivityChanged } from "./activity-broadcaster.js";

function fakeClient(): WSContext & { send: ReturnType<typeof mock> } {
  return { send: mock(() => undefined) } as unknown as WSContext & { send: ReturnType<typeof mock> };
}

describe("handleActivityChanged", () => {
  test("該当guildのクライアントへkindを配信する", () => {
    const guildId = `g-${crypto.randomUUID()}`;
    const client = fakeClient();
    activityClients.register(guildId, client);

    handleActivityChanged(`activity:changed:${guildId}`, JSON.stringify({ kind: "voice" }));

    expect(client.send).toHaveBeenCalledWith(JSON.stringify({ type: "activityChanged", kind: "voice" }));
    activityClients.unregister(guildId, client);
  });

  test("不正なpayloadは配信せず例外も投げない", () => {
    const guildId = `g-${crypto.randomUUID()}`;
    const client = fakeClient();
    activityClients.register(guildId, client);

    expect(() => handleActivityChanged(`activity:changed:${guildId}`, "not-json")).not.toThrow();

    expect(client.send).not.toHaveBeenCalled();
    activityClients.unregister(guildId, client);
  });
});
