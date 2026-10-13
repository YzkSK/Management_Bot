import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CAPABILITIES, type CapabilityName } from "@management-bot/shared";
import { seedQueryError } from "../test-helpers.js";
import { trpc } from "../trpc.js";
import { RequirePageAccess } from "./require-page-access.js";

function render(capabilities: number | undefined, capability?: CapabilityName): string {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  if (capabilities !== undefined) {
    queryClient.setQueryData(trpc.guildSettings.listMyGuilds.queryOptions().queryKey, [
      { id: "g1", name: "サーバー", isManaged: false, iconUrl: null, capabilities },
    ]);
  }
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/guilds/g1/activity"]}>
        <Routes>
          <Route
            path="/guilds/:guildId/activity"
            element={
              <RequirePageAccess pageName="アクティビティ" capability={capability}>
                <p>ページ本体</p>
              </RequirePageAccess>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("RequirePageAccess", () => {
  test("権限の判定がつくまでは本体を描かず読み込み表示にする(リロード時のちらつき防止)", () => {
    const html = render(undefined, "VIEW_ACTIVITY");
    expect(html).not.toContain("ページ本体");
    expect(html).toContain("読み込み中");
  });

  test("権限がなければ本体を描かず権限なしの表示を出す", () => {
    const html = render(0, "VIEW_ACTIVITY");
    expect(html).not.toContain("ページ本体");
    expect(html).toContain("このページを見る権限がありません");
    expect(html).toContain("アクティビティの閲覧");
  });

  test("権限があれば本体を描く", () => {
    expect(render(CAPABILITIES.VIEW_ACTIVITY, "VIEW_ACTIVITY")).toContain("ページ本体");
  });

  test("サーバー一覧の取得に失敗したら読み込み表示のまま止めず、エラー表示を出す", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retryOnMount: false } } });
    seedQueryError(queryClient, trpc.guildSettings.listMyGuilds.queryOptions().queryKey, new Error("boom"));
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/guilds/g1/activity"]}>
          <Routes>
            <Route
              path="/guilds/:guildId/activity"
              element={
                <RequirePageAccess pageName="アクティビティ" capability="VIEW_ACTIVITY">
                  <p>ページ本体</p>
                </RequirePageAccess>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(html).not.toContain("ページ本体");
    expect(html).toContain("サーバーの情報を読み込めませんでした");
  });

  test("参加していないサーバーは、全メンバー向けページでも本体を描かず開けない旨を出す", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(trpc.guildSettings.listMyGuilds.queryOptions().queryKey, [
      { id: "other", name: "別サーバー", isManaged: false, iconUrl: null, capabilities: 0 },
    ]);
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/guilds/g1/activity"]}>
          <Routes>
            <Route
              path="/guilds/:guildId/activity"
              element={
                <RequirePageAccess pageName="予約投稿">
                  <p>ページ本体</p>
                </RequirePageAccess>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(html).not.toContain("ページ本体");
    expect(html).toContain("このサーバーのページは開けません");
  });

  test("capability指定なし(全メンバー向け)は判定後に本体を描く", () => {
    expect(render(0)).toContain("ページ本体");
  });
});
