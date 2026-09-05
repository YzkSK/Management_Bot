import { afterEach, describe, expect, test } from "bun:test";
import { fetchGuildChannels, fetchGuildMemberNames } from "./bot-client.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const VIEW_CHANNEL = "1024"; // 0x400
const SEND_MESSAGES = "2048"; // 0x800

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? undefined : JSON.stringify(body), { status });
}

/** path末尾で振り分ける簡易ルーター。テストごとにレスポンスを差し替える。 */
function mockFetch(responses: Record<string, { status: number; body?: unknown }>): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bot test-bot-token");
    for (const [path, response] of Object.entries(responses)) {
      if (url.endsWith(path)) {
        return jsonResponse(response.status, response.body);
      }
    }
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;
}

describe("fetchGuildChannels", () => {
  test("botのロール権限(overwriteなし)でSEND_MESSAGESを持つテキスト系チャンネルのみ返す", async () => {
    mockFetch({
      "/users/@me": { status: 200, body: { id: "bot1" } },
      "/guilds/g1/channels": {
        status: 200,
        body: [
          { id: "c1", name: "general", type: 0, permission_overwrites: [] },
          { id: "c2", name: "voice", type: 2, permission_overwrites: [] },
          { id: "c3", name: "announcements", type: 5, permission_overwrites: [] },
        ],
      },
      "/guilds/g1/roles": {
        status: 200,
        body: [{ id: "g1", permissions: String(BigInt(VIEW_CHANNEL) | BigInt(SEND_MESSAGES)) }],
      },
      "/guilds/g1/members/bot1": { status: 200, body: { roles: [] } },
    });

    const result = await fetchGuildChannels("test-bot-token", "g1");

    expect(result).toEqual([
      { id: "c1", name: "general" },
      { id: "c3", name: "announcements" },
    ]);
  });

  test("SEND_MESSAGESがdenyされているチャンネルは除外する", async () => {
    mockFetch({
      "/users/@me": { status: 200, body: { id: "bot1" } },
      "/guilds/g1/channels": {
        status: 200,
        body: [
          {
            id: "c1",
            name: "readonly",
            type: 0,
            permission_overwrites: [{ id: "g1", type: 0, allow: "0", deny: SEND_MESSAGES }],
          },
        ],
      },
      "/guilds/g1/roles": {
        status: 200,
        body: [{ id: "g1", permissions: String(BigInt(VIEW_CHANNEL) | BigInt(SEND_MESSAGES)) }],
      },
      "/guilds/g1/members/bot1": { status: 200, body: { roles: [] } },
    });

    const result = await fetchGuildChannels("test-bot-token", "g1");

    expect(result).toEqual([]);
  });

  test("Bot未参加(403)は空配列を返す", async () => {
    mockFetch({
      "/users/@me": { status: 200, body: { id: "bot1" } },
      "/guilds/g1/channels": { status: 403 },
      "/guilds/g1/roles": { status: 200, body: [] },
      "/guilds/g1/members/bot1": { status: 200, body: { roles: [] } },
    });

    const result = await fetchGuildChannels("test-bot-token", "g1");

    expect(result).toEqual([]);
  });

  test("guild不明(404)は空配列を返す", async () => {
    mockFetch({
      "/users/@me": { status: 200, body: { id: "bot1" } },
      "/guilds/g1/channels": { status: 200, body: [] },
      "/guilds/g1/roles": { status: 200, body: [] },
      "/guilds/g1/members/bot1": { status: 404 },
    });

    const result = await fetchGuildChannels("test-bot-token", "g1");

    expect(result).toEqual([]);
  });

  test("5xxはErrorを投げる", async () => {
    mockFetch({
      "/users/@me": { status: 200, body: { id: "bot1" } },
      "/guilds/g1/channels": { status: 500 },
      "/guilds/g1/roles": { status: 200, body: [] },
      "/guilds/g1/members/bot1": { status: 200, body: { roles: [] } },
    });

    await expect(fetchGuildChannels("test-bot-token", "g1")).rejects.toThrow();
  });
});

describe("fetchGuildMemberNames", () => {
  test("nickがあればnickを使う", async () => {
    mockFetch({
      "/guilds/g1/members/u1": {
        status: 200,
        body: { nick: "ニックネーム", user: { username: "user1", global_name: "User One" } },
      },
    });

    const result = await fetchGuildMemberNames("test-bot-token", "g1", ["u1"]);

    expect(result.get("u1")).toBe("ニックネーム");
  });

  test("nickがなければglobal_nameを使う", async () => {
    mockFetch({
      "/guilds/g1/members/u1": {
        status: 200,
        body: { nick: null, user: { username: "user1", global_name: "User One" } },
      },
    });

    const result = await fetchGuildMemberNames("test-bot-token", "g1", ["u1"]);

    expect(result.get("u1")).toBe("User One");
  });

  test("nickもglobal_nameもなければusernameを使う", async () => {
    mockFetch({
      "/guilds/g1/members/u1": {
        status: 200,
        body: { nick: null, user: { username: "user1", global_name: null } },
      },
    });

    const result = await fetchGuildMemberNames("test-bot-token", "g1", ["u1"]);

    expect(result.get("u1")).toBe("user1");
  });

  test("404(脱退済み等)はMapに含めない", async () => {
    mockFetch({
      "/guilds/g1/members/u1": { status: 404 },
    });

    const result = await fetchGuildMemberNames("test-bot-token", "g1", ["u1"]);

    expect(result.has("u1")).toBe(false);
  });

  test("複数IDを並列解決する", async () => {
    mockFetch({
      "/guilds/g1/members/u1": {
        status: 200,
        body: { nick: null, user: { username: "user-u1", global_name: null } },
      },
      "/guilds/g1/members/u2": {
        status: 200,
        body: { nick: null, user: { username: "user-u2", global_name: null } },
      },
    });

    const result = await fetchGuildMemberNames("test-bot-token", "g1", ["u1", "u2"]);

    expect(result.get("u1")).toBe("user-u1");
    expect(result.get("u2")).toBe("user-u2");
  });
});
