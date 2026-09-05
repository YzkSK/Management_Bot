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

  test("一括設定のコントロールを描画し、カテゴリごとの設定はdetails配下に隠す", () => {
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

    expect(html).toContain("一括設定(すべてのカテゴリへ同じ値を適用)");
    expect(html).toContain('aria-label="全カテゴリの出力先チャンネル"');
    expect(html).toContain("全カテゴリに適用");
    expect(html).toContain("<details>");
    expect(html).toContain("カテゴリごとに設定する(任意)");
    expect(html.indexOf("一括設定")).toBeLessThan(html.indexOf("<details>"));
  });

  test("全カテゴリが同じ値のときは一括設定欄に現在値を反映する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(trpc.logging.listRetentionSettings.queryOptions({ guildId: "g1" }).queryKey, [
      { category: "message", retentionDays: 14 },
      { category: "member", retentionDays: 14 },
    ]);
    queryClient.setQueryData(trpc.logging.listChannelSettings.queryOptions({ guildId: "g1" }).queryKey, [
      { category: "message", channelId: "c1" },
      { category: "member", channelId: "c1" },
    ]);
    queryClient.setQueryData(trpc.logging.listChannelOptions.queryOptions({ guildId: "g1" }).queryKey, [
      { id: "c1", name: "general" },
    ]);

    const html = renderPage("g1", queryClient);

    expect(html).toContain('id="bulk-retention-days"');
    expect(html).toContain('min="0" max="36500"');
    expect(html).toContain('value="14"');
  });

  test("カテゴリごとに値がバラバラなら一括設定欄は空欄で、適用ボタンを無効化する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(trpc.logging.listRetentionSettings.queryOptions({ guildId: "g1" }).queryKey, [
      { category: "message", retentionDays: 14 },
      { category: "member", retentionDays: 30 },
    ]);
    queryClient.setQueryData(trpc.logging.listChannelSettings.queryOptions({ guildId: "g1" }).queryKey, [
      { category: "message", channelId: "c1" },
      { category: "member", channelId: null },
    ]);
    queryClient.setQueryData(trpc.logging.listChannelOptions.queryOptions({ guildId: "g1" }).queryKey, [
      { id: "c1", name: "general" },
    ]);

    const html = renderPage("g1", queryClient);

    expect(html).toContain('id="bulk-retention-days"');
    expect(html).toContain('placeholder="カテゴリごとに異なる"');
    // 一括適用ボタン(保持期間側)が空欄のためdisabledになっている
    const buttonIndex = html.indexOf("全カテゴリに適用");
    const buttonTagStart = html.lastIndexOf("<button", buttonIndex);
    expect(html.slice(buttonTagStart, buttonIndex)).toContain("disabled");
  });

  test("監査ログ相関を一覧に表示するチェックボックスが表示され、初期状態はオフ(非表示がデフォルト)", () => {
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
    queryClient.setQueryData(trpc.logging.getDisplaySettings.queryOptions({ guildId: "g1" }).queryKey, {
      hideAuditLogCorrelation: true,
    });

    const html = renderPage("g1", queryClient);

    expect(html).toContain("ログ一覧に「監査ログ相関」カテゴリを表示する");
    const checkboxIndex = html.indexOf('type="checkbox"');
    const checkboxTagEnd = html.indexOf(">", checkboxIndex);
    expect(html.slice(checkboxIndex, checkboxTagEnd)).not.toContain("checked");
  });

  test("hideAuditLogCorrelationがfalse(表示中)のときチェックボックスはchecked状態になる", () => {
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
    queryClient.setQueryData(trpc.logging.getDisplaySettings.queryOptions({ guildId: "g1" }).queryKey, {
      hideAuditLogCorrelation: false,
    });

    const html = renderPage("g1", queryClient);

    const checkboxIndex = html.indexOf('type="checkbox"');
    const checkboxTagEnd = html.indexOf(">", checkboxIndex);
    expect(html.slice(checkboxIndex, checkboxTagEnd)).toContain("checked");
  });
});
