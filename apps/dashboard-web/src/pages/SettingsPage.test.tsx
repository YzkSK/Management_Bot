import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { trpc } from "../trpc.js";
import { SettingsPage } from "./SettingsPage.js";

function renderPage(guildId: string, queryClient: QueryClient): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/guilds/${guildId}/logs/settings`]}>
        <Routes>
          <Route path="/guilds/:guildId/logs/settings" element={<SettingsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SettingsPage", () => {
  test("取得完了前はローディング表示になる", () => {
    const queryClient = new QueryClient();
    const html = renderPage("g1", queryClient);
    expect(html).toContain("読み込み中");
  });

  test("取得成功時はカテゴリごとの保持期間・出力先チャンネルを描画する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(trpc.logging.listRetentionSettings.queryOptions({ guildId: "g1" }).queryKey, [
      { category: "message", retentionDays: 30 },
    ]);
    queryClient.setQueryData(trpc.logging.listChannelSettings.queryOptions({ guildId: "g1" }).queryKey, [
      { category: "message", channelId: "c1" },
    ]);
    queryClient.setQueryData(trpc.logging.listChannelOptions.queryOptions({ guildId: "g1" }).queryKey, [
      { id: "c1", name: "general" },
    ]);

    const html = renderPage("g1", queryClient);

    expect(html).toContain("メッセージ");
    expect(html).toContain('value="30"');
    expect(html).toContain('aria-label="メッセージの保持期間(日)"');
    expect(html).toContain('aria-label="メッセージの出力先チャンネル"');
  });
});
