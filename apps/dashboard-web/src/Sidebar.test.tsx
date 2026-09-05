import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FEATURE_METADATA } from "@management-bot/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { trpc } from "./trpc.js";
import { Sidebar } from "./Sidebar.js";

function renderSidebar(queryClient: QueryClient, guildId?: string): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Sidebar guildId={guildId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Sidebar", () => {
  test("FEATURE_METADATAの各エントリ名を描画する", () => {
    const html = renderSidebar(new QueryClient());
    for (const feature of FEATURE_METADATA) {
      expect(html).toContain(feature.name);
    }
  });

  test("guildId未指定時はログ機能もリンクにならない", () => {
    const html = renderSidebar(new QueryClient());
    expect(html).not.toContain("<a ");
  });

  test("guildId指定時はログ機能がログ一覧画面へのリンクになる", () => {
    const html = renderSidebar(new QueryClient(), "g1");
    expect(html).toContain('href="/guilds/g1/logs"');
  });

  test("サーバー切替セレクトにアクセシブルな名前が付いている", () => {
    const html = renderSidebar(new QueryClient());
    expect(html).toContain('aria-label="サーバーを選択"');
  });

  test("所属サーバーが0件の間はセレクトを無効化する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(trpc.guildSettings.listMyGuilds.queryOptions().queryKey, []);
    const html = renderSidebar(queryClient);
    expect(html).toContain("disabled=");
  });
});
