import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { trpc } from "../trpc.js";
import { ModerationPage } from "./ModerationPage.js";

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
