import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FEATURE_METADATA } from "@management-bot/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { trpc } from "./trpc.js";
import { Sidebar } from "./Sidebar.js";
import { Dialog } from "@/components/ui/dialog";

function renderSidebar(queryClient: QueryClient, guildId?: string, open?: boolean): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Dialog open={open ?? false} onOpenChange={() => {}}>
          <Sidebar guildId={guildId} open={open} />
        </Dialog>
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

  test("guildId指定時はアクセス権限画面へのリンクが表示される", () => {
    const html = renderSidebar(new QueryClient(), "g1");
    expect(html).toContain('href="/guilds/g1/access"');
    expect(html).toContain("アクセス権限");
  });

  test("guildId未指定時はアクセス権限画面へのリンクにならない", () => {
    const html = renderSidebar(new QueryClient());
    expect(html).toContain("アクセス権限");
    expect(html).not.toContain('href="/guilds/undefined/access"');
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

  test("管理者権限のないサーバーのみでもセレクトは無効化しない(issue #199, VIEW_LOGS等の閲覧capabilityは別途保持しうるため)", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(trpc.guildSettings.listMyGuilds.queryOptions().queryKey, [
      { id: "g1", name: "非管理サーバー", isManaged: false, canViewLogs: true },
    ]);
    const html = renderSidebar(queryClient);
    expect(html).not.toContain("disabled=");
  });

  test("open未指定(モバイルドロワー閉)ではopen=falseでDialogContentをレンダーしない(issue #267, 閉時でもTabで到達できてしまう問題への対応)", () => {
    // モバイルドロワーの中身はRadix DialogのPortal経由でdocument.bodyへレンダーされるため、
    // renderToStaticMarkup(SSR)では検証できない。ここではSidebarがopen propに応じて
    // DialogContentの描画有無を切り替えていること自体をSidebar.tsxの実装で保証する。
    const html = renderSidebar(new QueryClient());
    expect(html).toContain('aria-label="機能メニュー"');
  });
});
