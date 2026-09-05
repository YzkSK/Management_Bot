import { describe, expect, mock, test } from "bun:test";
import type { WSContext } from "hono/ws";
import { broadcastNewLogEntry, registerLogClient, unregisterLogClient } from "./log-broadcaster.js";

function fakeClient(): WSContext & { send: ReturnType<typeof mock> } {
  return { send: mock(() => undefined) } as unknown as WSContext & { send: ReturnType<typeof mock> };
}

describe("log-broadcaster", () => {
  test("登録済みクライアントへ新規ログ発生を通知する", () => {
    const guildId = `g-${crypto.randomUUID()}`;
    const client = fakeClient();
    registerLogClient(guildId, client);

    broadcastNewLogEntry(guildId, "message");

    expect(client.send).toHaveBeenCalledWith(JSON.stringify({ type: "newLogEntry", category: "message" }));
    unregisterLogClient(guildId, client);
  });

  test("解除済みクライアントへは送らない", () => {
    const guildId = `g-${crypto.randomUUID()}`;
    const client = fakeClient();
    registerLogClient(guildId, client);
    unregisterLogClient(guildId, client);

    broadcastNewLogEntry(guildId, "message");

    expect(client.send).not.toHaveBeenCalled();
  });

  test("別guildIdのクライアントには送らない", () => {
    const guildIdA = `g-${crypto.randomUUID()}`;
    const guildIdB = `g-${crypto.randomUUID()}`;
    const clientA = fakeClient();
    registerLogClient(guildIdA, clientA);

    broadcastNewLogEntry(guildIdB, "message");

    expect(clientA.send).not.toHaveBeenCalled();
    unregisterLogClient(guildIdA, clientA);
  });

  test("誰も登録されていないguildIdへのbroadcastは何も起きない", () => {
    expect(() => broadcastNewLogEntry(`g-${crypto.randomUUID()}`, "message")).not.toThrow();
  });

  test("同じguildIdの複数クライアント全員に通知する", () => {
    const guildId = `g-${crypto.randomUUID()}`;
    const clientA = fakeClient();
    const clientB = fakeClient();
    registerLogClient(guildId, clientA);
    registerLogClient(guildId, clientB);

    broadcastNewLogEntry(guildId, "voice");

    expect(clientA.send).toHaveBeenCalledTimes(1);
    expect(clientB.send).toHaveBeenCalledTimes(1);
    unregisterLogClient(guildId, clientA);
    unregisterLogClient(guildId, clientB);
  });
});
