import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { trpc } from "../trpc.js";
import { UserSettingsPage } from "./UserSettingsPage.js";

function renderPage(avatarUrl: string | null): string {
  const queryClient = new QueryClient();
  queryClient.setQueryData(trpc.me.queryOptions().queryKey, {
    discordUserId: "111111111111111111",
    discordUsername: "yuzuki_nom1",
    avatarUrl,
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <UserSettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  const store = new Map<string, string>([["theme", "dark"]]);
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) },
    configurable: true,
  });
});

afterEach(() => {
  // @ts-expect-error テスト用に注入したグローバルを元に戻す
  delete globalThis.localStorage;
});

describe("UserSettingsPage", () => {
  test("ログイン中のユーザー名とログアウトボタンを出す", () => {
    const html = renderPage(null);
    expect(html).toContain("yuzuki_nom1");
    expect(html).toContain("ログアウト");
  });

  test("保存済みのテーマが選択状態になる", () => {
    const html = renderPage(null);
    expect(html).toMatch(/aria-checked="true"[^>]*>ダーク</);
    expect(html).toMatch(/aria-checked="false"[^>]*>ライト</);
  });

  test("avatarUrlがあればアバター画像を出す", () => {
    const html = renderPage("https://cdn.discordapp.com/avatars/u1/abc.png");
    expect(html).toContain('src="https://cdn.discordapp.com/avatars/u1/abc.png"');
  });
});
