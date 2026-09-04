import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { trpc } from "../trpc.js";
import { LogListPage } from "./LogListPage.js";

function renderPage(guildId: string, queryClient: QueryClient): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/guilds/${guildId}/logs`]}>
        <Routes>
          <Route path="/guilds/:guildId/logs" element={<LogListPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LogListPage", () => {
  test("取得完了前はローディング表示になる", () => {
    const queryClient = new QueryClient();
    const html = renderPage("g1", queryClient);
    expect(html).toContain("読み込み中");
  });

  test("カテゴリセレクトにアクセシブルな名前が付いている", () => {
    const queryClient = new QueryClient();
    const html = renderPage("g1", queryClient);
    expect(html).toContain('aria-label="ログのカテゴリ"');
  });

  test("0件取得時は空状態メッセージを表示する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({
        guildId: "g1",
        category: undefined,
        limit: 50,
        cursor: undefined,
      }).queryKey,
      { entries: [], nextCursor: null },
    );
    const html = renderPage("g1", queryClient);
    expect(html).toContain("該当するログはありません");
  });
});
