import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { trpc } from "../trpc.js";
import { GuildListPage } from "./GuildListPage.js";

function renderPage(queryClient: QueryClient): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <GuildListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("GuildListPage", () => {
  test("取得完了前はローディング表示になる", () => {
    const html = renderPage(new QueryClient());
    expect(html).toContain("読み込み中");
  });

  test("0件取得時は案内メッセージを表示する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(trpc.guildSettings.listMyGuilds.queryOptions().queryKey, []);
    const html = renderPage(queryClient);
    expect(html).toContain("管理できるサーバーが見つかりませんでした");
  });

  test("取得成功時はサーバー一覧をログ一覧画面へのリンクとして描画する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(trpc.guildSettings.listMyGuilds.queryOptions().queryKey, [
      { id: "g1", name: "テストサーバー" },
    ]);
    const html = renderPage(queryClient);
    expect(html).toContain("テストサーバー");
    expect(html).toContain('href="/guilds/g1/logs"');
  });
});
