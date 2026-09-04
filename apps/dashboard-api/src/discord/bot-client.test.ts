import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fetchGuildChannels } from "./bot-client.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(response: { status: number; body?: unknown }): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe("https://discord.com/api/v10/guilds/g1/channels");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bot test-bot-token");
    return new Response(response.body === undefined ? undefined : JSON.stringify(response.body), {
      status: response.status,
    });
  }) as typeof fetch;
}

describe("fetchGuildChannels", () => {
  beforeEach(() => {
    mockFetch({ status: 200, body: [] });
  });

  test("テキスト系チャンネル(type 0/5)のみ返す", async () => {
    mockFetch({
      status: 200,
      body: [
        { id: "c1", name: "general", type: 0 },
        { id: "c2", name: "voice", type: 2 },
        { id: "c3", name: "announcements", type: 5 },
        { id: "c4", name: "category", type: 4 },
      ],
    });

    const result = await fetchGuildChannels("test-bot-token", "g1");

    expect(result).toEqual([
      { id: "c1", name: "general" },
      { id: "c3", name: "announcements" },
    ]);
  });

  test("403(Bot未参加)は空配列を返す", async () => {
    mockFetch({ status: 403 });

    const result = await fetchGuildChannels("test-bot-token", "g1");

    expect(result).toEqual([]);
  });

  test("404(guild不明)は空配列を返す", async () => {
    mockFetch({ status: 404 });

    const result = await fetchGuildChannels("test-bot-token", "g1");

    expect(result).toEqual([]);
  });

  test("5xxはErrorを投げる", async () => {
    mockFetch({ status: 500 });

    await expect(fetchGuildChannels("test-bot-token", "g1")).rejects.toThrow();
  });
});
