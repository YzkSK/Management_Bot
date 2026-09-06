import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DiscordTokenInvalidError, fetchUserGuilds } from "./discord-client.ts";

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
