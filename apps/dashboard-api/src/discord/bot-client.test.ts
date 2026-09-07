import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  DiscordAccessForbiddenError,
  fetchAllGuildChannelNames,
  fetchBotGuildPermissions,
  fetchGuildChannels,
  fetchGuildMemberNames,
  fetchGuildMembersPage,
  fetchGuildRoles,
} from "./bot-client.ts";

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
        body: [{ id: "g1", name: "everyone", permissions: String(BigInt(VIEW_CHANNEL) | BigInt(SEND_MESSAGES)) }],
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
        body: [{ id: "g1", name: "everyone", permissions: String(BigInt(VIEW_CHANNEL) | BigInt(SEND_MESSAGES)) }],
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

describe("fetchAllGuildChannelNames", () => {
  test("送信可否・チャンネル種別を問わず全チャンネルのid/nameを返す(ボイスチャンネル含む)", async () => {
    mockFetch({
      "/guilds/g1/channels": {
        status: 200,
        body: [
          { id: "c1", name: "general", type: 0, permission_overwrites: [] },
          { id: "c2", name: "voice", type: 2, permission_overwrites: [] },
        ],
      },
      "/guilds/g1/threads/active": { status: 200, body: { threads: [] } },
    });

    const result = await fetchAllGuildChannelNames("test-bot-token", "g1");

    expect(result).toEqual([
      { id: "c1", name: "general" },
      { id: "c2", name: "voice" },
    ]);
  });

  test("アクティブスレッドも含める(スレッド名表示用)", async () => {
    mockFetch({
      "/guilds/g1/channels": {
        status: 200,
        body: [{ id: "c1", name: "general", type: 0, permission_overwrites: [] }],
      },
      "/guilds/g1/threads/active": {
        status: 200,
        body: { threads: [{ id: "t1", name: "質問スレ", type: 11, permission_overwrites: [] }] },
      },
    });

    const result = await fetchAllGuildChannelNames("test-bot-token", "g1");

    expect(result).toEqual([
      { id: "c1", name: "general" },
      { id: "t1", name: "質問スレ" },
    ]);
  });

  test("guild不明(404)は空配列を返す", async () => {
    mockFetch({
      "/guilds/g1/channels": { status: 404 },
      "/guilds/g1/threads/active": { status: 404 },
    });

    const result = await fetchAllGuildChannelNames("test-bot-token", "g1");

    expect(result).toEqual([]);
  });

  test("Bot未参加(403)は空配列を返す", async () => {
    mockFetch({
      "/guilds/g1/channels": { status: 403 },
      "/guilds/g1/threads/active": { status: 403 },
    });

    const result = await fetchAllGuildChannelNames("test-bot-token", "g1");

    expect(result).toEqual([]);
  });

  test("channelsが5xxでも空配列にdegradeする(issue #157: 一時的なAPI障害でresolveDisplayNames全体を500にしない)", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    mockFetch({
      "/guilds/g1/channels": { status: 500 },
      "/guilds/g1/threads/active": { status: 200, body: { threads: [] } },
    });

    try {
      const result = await fetchAllGuildChannelNames("test-bot-token", "g1");

      expect(result).toEqual([]);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("threads/activeが5xxでもchannelsが成功していればチャンネル名は返す(スレッド取得失敗は巻き込まない)", async () => {
    mockFetch({
      "/guilds/g1/channels": {
        status: 200,
        body: [{ id: "c1", name: "general", type: 0, permission_overwrites: [] }],
      },
      "/guilds/g1/threads/active": { status: 500 },
    });

    const result = await fetchAllGuildChannelNames("test-bot-token", "g1");

    expect(result).toEqual([{ id: "c1", name: "general" }]);
  });
});

describe("fetchBotGuildPermissions", () => {
  const VIEW_AUDIT_LOG = "128"; // 0x80

  test("botロールのpermissionsをOR合成して返す", async () => {
    mockFetch({
      "/users/@me": { status: 200, body: { id: "bot1" } },
      "/guilds/g1/roles": {
        status: 200,
        body: [
          { id: "g1", name: "everyone", permissions: "0" },
          { id: "r1", name: "role1", permissions: VIEW_AUDIT_LOG },
        ],
      },
      "/guilds/g1/members/bot1": { status: 200, body: { roles: ["r1"] } },
    });

    const permissions = await fetchBotGuildPermissions("test-bot-token", "g1");

    expect(permissions & BigInt(VIEW_AUDIT_LOG)).toBe(BigInt(VIEW_AUDIT_LOG));
  });

  test("Bot未参加(403)/guild不明(404)は0nを返す", async () => {
    mockFetch({
      "/users/@me": { status: 200, body: { id: "bot1" } },
      "/guilds/g1/roles": { status: 403 },
      "/guilds/g1/members/bot1": { status: 200, body: { roles: [] } },
    });

    const permissions = await fetchBotGuildPermissions("test-bot-token", "g1");

    expect(permissions).toBe(0n);
  });

  test("Bot memberが404(未参加)の場合も0nを返す", async () => {
    mockFetch({
      "/users/@me": { status: 200, body: { id: "bot1" } },
      "/guilds/g1/roles": { status: 200, body: [{ id: "g1", name: "everyone", permissions: VIEW_AUDIT_LOG }] },
      "/guilds/g1/members/bot1": { status: 404 },
    });

    const permissions = await fetchBotGuildPermissions("test-bot-token", "g1");

    expect(permissions).toBe(0n);
  });
});

describe("/users/@me キャッシュ(issue #99)", () => {
  function mockFetchCounting(responses: Record<string, { status: number; body?: unknown }>): { calls: number } {
    const state = { calls: 0 };
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      state.calls++;
      const url = String(input);
      for (const [path, response] of Object.entries(responses)) {
        if (url.endsWith(path)) {
          return jsonResponse(response.status, response.body);
        }
      }
      throw new Error(`unexpected request: ${url}`);
    }) as typeof fetch;
    return state;
  }

  test("同一Botトークンでの複数回呼び出しで/users/@meは1回しか叩かない", async () => {
    const botToken = "me-cache-token-1";
    const fetchState = mockFetchCounting({
      "/users/@me": { status: 200, body: { id: "bot1" } },
      "/guilds/g1/channels": { status: 200, body: [] },
      "/guilds/g1/roles": { status: 200, body: [] },
      "/guilds/g1/members/bot1": { status: 200, body: { roles: [] } },
    });

    await fetchGuildChannels(botToken, "g1");
    await fetchBotGuildPermissions(botToken, "g1");

    // fetchGuildChannels: /users/@me, /channels, /roles, /members → 4回
    // fetchBotGuildPermissions: /roles, /members のみ(/users/@meはキャッシュヒット) → 2回
    expect(fetchState.calls).toBe(6);
  });

  test("/users/@me取得が失敗した場合はキャッシュせず、次回呼び出しで再試行する", async () => {
    const botToken = "me-cache-token-2";
    let meCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/users/@me")) {
        meCalls++;
        return meCalls === 1 ? jsonResponse(500) : jsonResponse(200, { id: "bot1" });
      }
      if (url.endsWith("/guilds/g1/roles")) {
        return jsonResponse(200, []);
      }
      if (url.endsWith("/guilds/g1/members/bot1")) {
        return jsonResponse(200, { roles: [] });
      }
      throw new Error(`unexpected request: ${url}`);
    }) as typeof fetch;

    await expect(fetchBotGuildPermissions(botToken, "g1")).rejects.toThrow();
    const permissions = await fetchBotGuildPermissions(botToken, "g1");

    expect(meCalls).toBe(2);
    expect(permissions).toBe(0n);
  });
});

describe("429リトライ(discordGet共通)", () => {
  test("429はRetry-Afterに従って待ってから再試行し、最終的に成功を返す", async () => {
    let calls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/guilds/g1/members/u1")) {
        calls++;
        if (calls === 1) {
          return new Response(JSON.stringify({ message: "rate limited" }), {
            status: 429,
            headers: { "Retry-After": "0" },
          });
        }
        return jsonResponse(200, { nick: null, user: { username: "user1", global_name: null } });
      }
      throw new Error(`unexpected request: ${url}`);
    }) as typeof fetch;

    const result = await fetchGuildMemberNames("test-bot-token", "g1", ["u1"]);

    expect(calls).toBe(2);
    expect(result.get("u1")).toBe("user1");
  });

  test("429がリトライ上限を超えて続く場合はエラーになりMapに含めない", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/guilds/g1/members/u1")) {
        calls++;
        return new Response(JSON.stringify({ message: "rate limited" }), {
          status: 429,
          headers: { "Retry-After": "0" },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    }) as typeof fetch;

    try {
      const result = await fetchGuildMemberNames("test-bot-token", "g1", ["u1"]);

      expect(result.has("u1")).toBe(false);
      // 初回1回 + MAX_RATE_LIMIT_RETRIES(5)回のリトライ = 6回
      expect(calls).toBe(6);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("fetchGuildRoles", () => {
  test("guild直下のロール一覧をid/nameで返す(@everyoneも含む)", async () => {
    mockFetch({
      "/guilds/g1/roles": {
        status: 200,
        body: [
          { id: "g1", name: "@everyone", permissions: "0" },
          { id: "r1", name: "Admin", permissions: "8" },
        ],
      },
    });

    const result = await fetchGuildRoles("test-bot-token", "g1");

    expect(result).toEqual([
      { id: "g1", name: "@everyone" },
      { id: "r1", name: "Admin" },
    ]);
  });

  test("guild不明(404)は空配列を返す", async () => {
    mockFetch({ "/guilds/g1/roles": { status: 404 } });

    const result = await fetchGuildRoles("test-bot-token", "g1");

    expect(result).toEqual([]);
  });

  test("Bot未参加(403)も空配列を返す", async () => {
    mockFetch({ "/guilds/g1/roles": { status: 403 } });

    const result = await fetchGuildRoles("test-bot-token", "g1");

    expect(result).toEqual([]);
  });
});

describe("fetchGuildMembersPage", () => {
  test("1ページ(上限未満)ならnextAfter=undefinedで、id/表示名(ニックネーム優先)を返す", async () => {
    let calls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls++;
      if (url.includes("/guilds/g1/members?limit=1000&after=0")) {
        return jsonResponse(200, [
          { user: { id: "u1", username: "user1", global_name: "User One" }, nick: "ニックネーム" },
          { user: { id: "u2", username: "user2", global_name: null }, nick: null },
        ]);
      }
      throw new Error(`unexpected request: ${url}`);
    }) as typeof fetch;

    const result = await fetchGuildMembersPage("test-bot-token", "g1");

    expect(calls).toBe(1);
    expect(result).toEqual({
      members: [
        { id: "u1", name: "ニックネーム" },
        { id: "u2", name: "user2" },
      ],
      nextAfter: undefined,
    });
  });

  test("nick/global_nameが両方無い場合はusernameにフォールバックする", async () => {
    mockFetch({
      "/guilds/g1/members?limit=1000&after=0": {
        status: 200,
        body: [{ user: { id: "u1", username: "user1", global_name: null }, nick: null }],
      },
    });

    const result = await fetchGuildMembersPage("test-bot-token", "g1");

    expect(result.members).toEqual([{ id: "u1", name: "user1" }]);
  });

  test("ちょうど上限件数のページはnextAfterに最後のuser idを返す", async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({
      user: { id: `u${i}`, username: `user${i}`, global_name: null },
      nick: null,
    }));
    mockFetch({ "/guilds/g1/members?limit=1000&after=0": { status: 200, body: page } });

    const result = await fetchGuildMembersPage("test-bot-token", "g1");

    expect(result.members).toHaveLength(1000);
    expect(result.nextAfter).toBe("u999");
  });

  test("afterを指定すると次ページのURLで問い合わせる", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return jsonResponse(200, []);
    }) as typeof fetch;

    await fetchGuildMembersPage("test-bot-token", "g1", "u999");

    expect(requestedUrl).toContain("after=u999");
  });

  test("guild不明(404)は空ページを返す", async () => {
    mockFetch({ "/guilds/g1/members?limit=1000&after=0": { status: 404 } });

    const result = await fetchGuildMembersPage("test-bot-token", "g1");

    expect(result).toEqual({ members: [], nextAfter: undefined });
  });

  test("GUILD_MEMBERS Privileged Intent未設定等の403はDiscordAccessForbiddenErrorを投げる(メンバー0人と誤認させない)", async () => {
    mockFetch({ "/guilds/g1/members?limit=1000&after=0": { status: 403 } });

    await expect(fetchGuildMembersPage("test-bot-token", "g1")).rejects.toBeInstanceOf(
      DiscordAccessForbiddenError,
    );
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

  test("404(脱退済み等)は/users/{id}にフォールバックしglobal_name > usernameで解決する", async () => {
    mockFetch({
      "/guilds/g1/members/u1": { status: 404 },
      "/users/u1": { status: 200, body: { username: "leftuser", global_name: "Left User" } },
    });

    const result = await fetchGuildMemberNames("test-bot-token", "g1", ["u1"]);

    expect(result.get("u1")).toBe("Left User");
  });

  test("404かつ/users/{id}もglobal_nameがなければusernameを使う", async () => {
    mockFetch({
      "/guilds/g1/members/u1": { status: 404 },
      "/users/u1": { status: 200, body: { username: "leftuser", global_name: null } },
    });

    const result = await fetchGuildMemberNames("test-bot-token", "g1", ["u1"]);

    expect(result.get("u1")).toBe("leftuser");
  });

  test("404かつ/users/{id}も404(アカウント削除済み等)ならMapに含めない", async () => {
    mockFetch({
      "/guilds/g1/members/u1": { status: 404 },
      "/users/u1": { status: 404 },
    });

    const result = await fetchGuildMemberNames("test-bot-token", "g1", ["u1"]);

    expect(result.has("u1")).toBe(false);
  });

  test("guild memberが5xxの場合は/users/{id}へフォールバックせずMapに含めない", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    let usersCalled = false;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/guilds/g1/members/u1")) {
        return jsonResponse(500);
      }
      if (url.endsWith("/users/u1")) {
        usersCalled = true;
        return jsonResponse(200, { username: "should-not-be-called", global_name: null });
      }
      throw new Error(`unexpected request: ${url}`);
    }) as typeof fetch;

    try {
      const result = await fetchGuildMemberNames("test-bot-token", "g1", ["u1"]);

      expect(result.has("u1")).toBe(false);
      expect(usersCalled).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
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

  test("同時実行数を制限する(MEMBER_LOOKUP_CONCURRENCYを超えて一括発火しない)", async () => {
    const userIds = Array.from({ length: 25 }, (_, i) => `u${i}`);
    let inFlight = 0;
    let maxInFlight = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const match = /\/guilds\/g1\/members\/(u\d+)$/.exec(url);
      if (!match) throw new Error(`unexpected request: ${url}`);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return jsonResponse(200, { nick: null, user: { username: match[1], global_name: null } });
    }) as typeof fetch;

    const result = await fetchGuildMemberNames("test-bot-token", "g1", userIds);

    expect(result.size).toBe(25);
    expect(maxInFlight).toBe(5);
  });

  test("1件が500(レート制限等)で失敗しても他のIDは解決し、全体は例外にしない", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    mockFetch({
      "/guilds/g1/members/u1": { status: 500 },
      "/guilds/g1/members/u2": {
        status: 200,
        body: { nick: null, user: { username: "user-u2", global_name: null } },
      },
    });

    try {
      const result = await fetchGuildMemberNames("test-bot-token", "g1", ["u1", "u2"]);

      expect(result.has("u1")).toBe(false);
      expect(result.get("u2")).toBe("user-u2");
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
