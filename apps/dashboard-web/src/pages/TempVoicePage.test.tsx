import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { trpc } from "../trpc.js";
import { TempVoicePage } from "./TempVoicePage.js";

function renderPage(guildId: string, queryClient: QueryClient): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/guilds/${guildId}/temp-voice`]}>
        <Routes>
          <Route path="/guilds/:guildId/temp-voice" element={<TempVoicePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function seedCommonQueries(queryClient: QueryClient, guildId: string): void {
  queryClient.setQueryData(trpc.tempVoice.getDenyProtectedRoles.queryOptions({ guildId }).queryKey, []);
  queryClient.setQueryData(trpc.tempVoice.listRoleOptions.queryOptions({ guildId }).queryKey, [
    { id: "role-1", name: "モデレーター" },
  ]);
  queryClient.setQueryData(trpc.tempVoice.listVoiceChannelOptions.queryOptions({ guildId }).queryKey, [
    { id: "vc-1", name: "ロビー" },
  ]);
  queryClient.setQueryData(trpc.tempVoice.listCategoryOptions.queryOptions({ guildId }).queryKey, [
    { id: "cat-1", name: "一時VC" },
  ]);
}

describe("TempVoicePage", () => {
  test("未設定時、一覧タブの先頭に設定を促す案内が表示される", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const guildId = "g1";
    queryClient.setQueryData(trpc.tempVoice.getConfig.queryOptions({ guildId }).queryKey, {
      guildId,
      createChannelId: null,
      categoryId: null,
      nameTemplate: "{username}のVC",
      defaultUserLimit: 0,
      defaultBitrate: null,
    });
    queryClient.setQueryData(trpc.tempVoice.listActiveChannels.queryOptions({ guildId }).queryKey, []);
    seedCommonQueries(queryClient, guildId);

    const html = renderPage(guildId, queryClient);

    expect(html).toContain("一時VCがまだ設定されていません");
    expect(html).toContain("一時VC一覧");
  });

  test("設定済み時、一覧タブに強制削除ボタンが表示される", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const guildId = "g1";
    queryClient.setQueryData(trpc.tempVoice.getConfig.queryOptions({ guildId }).queryKey, {
      guildId,
      createChannelId: "vc-1",
      categoryId: "cat-1",
      nameTemplate: "{username}のVC",
      defaultUserLimit: 0,
      defaultBitrate: null,
    });
    queryClient.setQueryData(trpc.tempVoice.listActiveChannels.queryOptions({ guildId }).queryKey, [
      { channelId: "vc-2", guildId, ownerId: "owner-1", createdAt: "2026-09-24T00:00:00.000Z", memberCount: 3 },
    ]);
    seedCommonQueries(queryClient, guildId);

    const html = renderPage(guildId, queryClient);

    expect(html).toContain("強制削除");
    expect(html).not.toContain("一時VCがまだ設定されていません");
  });

  test("guildIdが無い場合はエラーを表示する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/guilds/temp-voice"]}>
          <Routes>
            <Route path="/guilds/temp-voice" element={<TempVoicePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(html).toContain("サーバーが指定されていません");
  });
});
