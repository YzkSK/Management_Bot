import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildAvatarUrl, DiscordTokenInvalidError, fetchDiscordUser, fetchUserGuilds } from "./discord-client.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(response: { status: number; body?: unknown }): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe("https://discord.com/api/v10/users/@me/guilds");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
    return new Response(response.body === undefined ? undefined : JSON.stringify(response.body), {
      status: response.status,
    });
  }) as typeof fetch;
}

describe("fetchDiscordUser", () => {
  test("Bearerトークンをヘッダーに付与してid・username・avatarを取得する", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://discord.com/api/v10/users/@me");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
      return new Response(JSON.stringify({ id: "u1", username: "yuzuki_nom1", avatar: "abc123" }), { status: 200 });
    }) as typeof fetch;

    const result = await fetchDiscordUser("test-token");

    expect(result).toEqual({ id: "u1", username: "yuzuki_nom1", avatar: "abc123" });
  });

  test("失敗レスポンスはErrorを投げる", async () => {
    globalThis.fetch = (async () => new Response(undefined, { status: 500 })) as typeof fetch;

    await expect(fetchDiscordUser("test-token")).rejects.toThrow();
  });
});

describe("buildAvatarUrl", () => {
  test("avatarハッシュがあればアバターCDN URLを返す", () => {
    expect(buildAvatarUrl({ id: "u1", avatar: "abc123" })).toBe("https://cdn.discordapp.com/avatars/u1/abc123.png");
  });

  test("avatarハッシュがなければデフォルトアバターURLを返す(userIdから決定的に算出)", () => {
    const url = buildAvatarUrl({ id: "123456789012345678", avatar: null });
    expect(url).toMatch(/^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-5]\.png$/);
  });

  test("同じuserIdなら常に同じデフォルトアバターを返す", () => {
    const userId = "987654321098765432";
    expect(buildAvatarUrl({ id: userId, avatar: null })).toBe(buildAvatarUrl({ id: userId, avatar: null }));
  });

  test("avatarハッシュがa_始まり(アニメーション)ならgif拡張子になる(codexレビュー対応)", () => {
    expect(buildAvatarUrl({ id: "u1", avatar: "a_abc123" })).toBe("https://cdn.discordapp.com/avatars/u1/a_abc123.gif");
  });
});

describe("fetchUserGuilds", () => {
  beforeEach(() => {
    mockFetch({ status: 200, body: [] });
  });

  test("Bearerトークンをヘッダーに付与してguild一覧を取得する", async () => {
    mockFetch({
      status: 200,
      body: [{ id: "g1", name: "guild 1", owner: true, permissions: "8" }],
    });

    const result = await fetchUserGuilds("test-token");

    expect(result).toEqual([{ id: "g1", name: "guild 1", owner: true, permissions: "8" }]);
  });

  test("401はDiscordTokenInvalidErrorを投げる", async () => {
    mockFetch({ status: 401 });

    await expect(fetchUserGuilds("test-token")).rejects.toBeInstanceOf(DiscordTokenInvalidError);
  });

  test("403はDiscordTokenInvalidErrorを投げる", async () => {
    mockFetch({ status: 403 });

    await expect(fetchUserGuilds("test-token")).rejects.toBeInstanceOf(DiscordTokenInvalidError);
  });

  test("5xxは通常のErrorを投げる(トークン失効扱いにしない)", async () => {
    mockFetch({ status: 500 });

    const error = await fetchUserGuilds("test-token").catch((e: unknown) => e);

    expect(error).not.toBeInstanceOf(DiscordTokenInvalidError);
    expect(error).toBeInstanceOf(Error);
  });

  test("permissionsが数字以外の文字列ならパースエラーになる", async () => {
    mockFetch({
      status: 200,
      body: [{ id: "g1", name: "guild 1", owner: false, permissions: "not-a-number" }],
    });

    await expect(fetchUserGuilds("test-token")).rejects.toThrow();
  });
});
