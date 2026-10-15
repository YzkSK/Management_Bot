import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CAPABILITIES, FEATURE_METADATA } from "@management-bot/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { trpc } from "./trpc.js";
import { Sidebar } from "./Sidebar.js";

function renderSidebar(queryClient: QueryClient, guildId?: string, open?: boolean): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Sidebar guildId={guildId} open={open} />
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

  function seededWith(capabilities: number): QueryClient {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(trpc.guildSettings.listMyGuilds.queryOptions().queryKey, [
      { id: "g1", name: "サーバー", isManaged: true, iconUrl: null, capabilities },
    ]);
    return queryClient;
  }

  test("guildId指定時はログ機能がログ一覧画面へのリンクになる", () => {
    const html = renderSidebar(seededWith(CAPABILITIES.VIEW_LOGS), "g1");
    expect(html).toContain('href="/guilds/g1/logs"');
  });

  test("guildId指定時はアクセス権限画面へのリンクが表示される", () => {
    const html = renderSidebar(seededWith(CAPABILITIES.MANAGE_ACCESS), "g1");
    expect(html).toContain('href="/guilds/g1/access"');
    expect(html).toContain("アクセス権限");
  });

  test("guildId指定時、権限が分かるまで(サーバー一覧の取得中)は項目を出さずスケルトンを出す(リロード時のちらつき防止)", () => {
    const html = renderSidebar(new QueryClient(), "g1");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("アクセス権限");
    expect(html).toContain('aria-label="メニューを読み込み中"');
  });

  test("取得済みで一覧に無いサーバーでは、スケルトンも項目も出さない", () => {
    const html = renderSidebar(seededWith(CAPABILITIES.VIEW_LOGS), "other");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("メニューを読み込み中");
  });

  test("guildId未指定時はアクセス権限画面へのリンクにならない", () => {
    const html = renderSidebar(new QueryClient());
    expect(html).toContain("アクセス権限");
    expect(html).not.toContain('href="/guilds/undefined/access"');
  });

  test("選択中サーバーで閲覧権限のない機能はリンクを表示しない(issue #527)", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(trpc.guildSettings.listMyGuilds.queryOptions().queryKey, [
      { id: "g1", name: "サーバー", isManaged: false, iconUrl: null, capabilities: CAPABILITIES.VIEW_LOGS },
    ]);
    const html = renderSidebar(queryClient, "g1");
    expect(html).toContain('href="/guilds/g1/logs"');
    expect(html).not.toContain('href="/guilds/g1/activity"');
    expect(html).not.toContain('href="/guilds/g1/moderation"');
    expect(html).not.toContain('href="/guilds/g1/access"');
    // 一時VCは全メンバー向け(権限がなければ自分がオーナーのVCのみ表示)。
    expect(html).toContain('href="/guilds/g1/temp-voice"');
    expect(html).not.toContain(">管理<");
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
      { id: "g1", name: "非管理サーバー", isManaged: false, iconUrl: null, capabilities: CAPABILITIES.VIEW_ACTIVITY },
    ]);
    const html = renderSidebar(queryClient);
    expect(html).not.toContain("disabled=");
  });

  test("open未指定(モバイルドロワー閉)ではドロワーの中身をレンダーしない(issue #267, 閉時でもTabで到達できてしまう問題への対応)", () => {
    // Starwindの<dialog>は閉じていてもDOMに残るため、DialogContentが閉時は中身をマウントしない。
    const name = FEATURE_METADATA[0]?.name ?? "";
    const countOf = (html: string) => html.split(name).length - 1;
    const closed = renderSidebar(new QueryClient());
    const opened = renderSidebar(new QueryClient(), undefined, true);
    expect(closed).toContain('aria-label="機能メニュー"');
    expect(countOf(opened)).toBe(countOf(closed) * 2);
  });
});
