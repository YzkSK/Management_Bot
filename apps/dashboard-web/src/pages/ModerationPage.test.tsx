import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { trpc } from "../trpc.js";
import { canUpdateStrikePages, isStrikePagesPending, ModerationPage } from "./ModerationPage.js";

function renderPage(guildId: string, queryClient: QueryClient): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/guilds/${guildId}/moderation`]}>
        <Routes>
          <Route path="/guilds/:guildId/moderation" element={<ModerationPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function seedBaseQueries(queryClient: QueryClient, guildId: string): void {
  queryClient.setQueryData(trpc.moderation.getRequiredPermissionStatus.queryOptions({ guildId }).queryKey, {
    accessStatus: "ok",
    reauthorizeUrl: null,
  });
}

describe("ModerationPage", () => {
  test("raid/new_account_guardの設定行を表示する(#196: DASHBOARD_VIOLATION_TYPES制限撤廃の確認)", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const guildId = "g1";
    seedBaseQueries(queryClient, guildId);
    queryClient.setQueryData(trpc.moderation.listThresholds.queryOptions({ guildId }).queryKey, []);

    const html = renderPage(guildId, queryClient);

    expect(html).toContain("レイド(大量入室)");
    expect(html).toContain("新規アカウントガード");
  });

  test("raid/new_account_guardが既に有効化されている場合、その設定値を反映して表示する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const guildId = "g1";
    seedBaseQueries(queryClient, guildId);
    queryClient.setQueryData(trpc.moderation.listThresholds.queryOptions({ guildId }).queryKey, [
      { violationType: "raid", preset: "strong", enabled: true },
      { violationType: "new_account_guard", preset: "weak", enabled: false },
    ]);

    const html = renderPage(guildId, queryClient);

    expect(html).toContain("レイド(大量入室)");
    expect(html).toContain("新規アカウントガード");
  });
});

describe("canUpdateStrikePages(#368のCodexレビュー指摘の回帰テスト)", () => {
  test("取得完了(isFetching=false)かつデータありならpagesを更新できる", () => {
    expect(canUpdateStrikePages({ rows: [], userNames: {} }, false)).toBe(true);
  });

  test("取得中(isFetching=true)はデータがあってもpagesを更新できない(resetPages直後の古いキャッシュ再表示を防ぐ)", () => {
    expect(canUpdateStrikePages({ rows: [], userNames: {} }, true)).toBe(false);
  });

  test("データ未取得(undefined)ならpagesを更新できない", () => {
    expect(canUpdateStrikePages(undefined, false)).toBe(false);
  });
});

describe("isStrikePagesPending(#368のCodexレビュー指摘の回帰テスト)", () => {
  test("行が0件でisPending中はpending扱い", () => {
    expect(isStrikePagesPending(0, true, false)).toBe(true);
  });

  test("行が0件でisFetching中(isPendingはfalse)もpending扱い(resetPages直後、invalidateQueriesで古いキャッシュが残る間はisPendingがfalseのままのため)", () => {
    expect(isStrikePagesPending(0, false, true)).toBe(true);
  });

  test("行が0件でもisPending/isFetchingどちらもfalseなら「履歴なし」として扱う(pending扱いにしない)", () => {
    expect(isStrikePagesPending(0, false, false)).toBe(false);
  });

  test("行が1件以上あればisPending/isFetchingに関わらずpending扱いしない", () => {
    expect(isStrikePagesPending(1, true, true)).toBe(false);
  });
});
