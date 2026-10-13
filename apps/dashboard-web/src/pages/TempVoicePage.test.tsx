import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CAPABILITIES } from "@management-bot/shared";
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

function seedCapabilities(queryClient: QueryClient, guildId: string, capabilities: number): void {
  queryClient.setQueryData(trpc.guildSettings.listMyGuilds.queryOptions().queryKey, [
    { id: guildId, name: "サーバー", isManaged: false, iconUrl: null, capabilities },
  ]);
}

function seedCommonQueries(queryClient: QueryClient, guildId: string): void {
  seedCapabilities(queryClient, guildId, CAPABILITIES.VIEW_TEMP_VOICE | CAPABILITIES.MANAGE_TEMP_VOICE);
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

function activeChannel(guildId: string) {
  const base = { avatarUrl: null, selfMute: false, serverMute: false, selfDeaf: false, serverDeaf: false, streaming: false, video: false };
  return {
    channelId: "vc-2",
    guildId,
    ownerId: "owner-1",
    createdAt: "2026-09-24T00:00:00.000Z",
    channelName: "YoMiのVC",
    ownerName: "YoMi",
    userLimit: 5,
    bitrate: 64000,
    isLocked: true,
    isHidden: true,
    members: [
      { ...base, userId: "owner-1", name: "YoMi", selfMute: true },
      { ...base, userId: "u2", name: "Bob" },
    ],
  };
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
    queryClient.setQueryData(trpc.tempVoice.listActiveChannels.queryOptions({ guildId }).queryKey, [activeChannel(guildId)]);
    seedCommonQueries(queryClient, guildId);

    const html = renderPage(guildId, queryClient);

    expect(html).toContain("強制削除");
    expect(html).not.toContain("一時VCがまだ設定されていません");
  });

  test("一覧はカード表示で、メンバー・オーナーバッジ・ロックアイコン・チップを出し、人数バッジは出さない", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const guildId = "g1";
    seedCapabilities(queryClient, guildId, CAPABILITIES.VIEW_TEMP_VOICE);
    queryClient.setQueryData(trpc.tempVoice.listActiveChannels.queryOptions({ guildId }).queryKey, [activeChannel(guildId)]);

    const html = renderPage(guildId, queryClient);

    expect(html).toContain("YoMiのVC");
    expect(html).toContain("YoMi");
    expect(html).toContain("オーナー");
    expect(html).toContain("Bob");
    expect(html).toContain('aria-label="ロック中"');
    expect(html).toContain("上限 5人");
    expect(html).toContain("64 kbps");
    expect(html).toContain("非表示");
    expect(html).toContain('aria-label="ミュート"');
    expect(html).toContain("継続");
    expect(html).not.toContain("2人");
  });

  test("状態未同期のチャンネルでもチップなしで崩れずに表示する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const guildId = "g1";
    seedCapabilities(queryClient, guildId, CAPABILITIES.VIEW_TEMP_VOICE);
    queryClient.setQueryData(trpc.tempVoice.listActiveChannels.queryOptions({ guildId }).queryKey, [
      { ...activeChannel(guildId), userLimit: null, bitrate: null, isLocked: false, isHidden: false, members: [] },
    ]);

    const html = renderPage(guildId, queryClient);

    expect(html).toContain("YoMiのVC");
    expect(html).not.toContain("kbps");
    expect(html).not.toContain("無制限");
    expect(html).not.toContain('aria-label="ロック中"');
  });

  test("VIEW_TEMP_VOICEのみでは一覧だけを表示し、設定・拒否禁止ロール・強制削除・未設定案内は出さない(issue #527)", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const guildId = "g1";
    seedCapabilities(queryClient, guildId, CAPABILITIES.VIEW_TEMP_VOICE);
    queryClient.setQueryData(trpc.tempVoice.listActiveChannels.queryOptions({ guildId }).queryKey, [activeChannel(guildId)]);

    const html = renderPage(guildId, queryClient);

    expect(html).toContain("現在Discord上に存在する一時VCです");
    expect(html).not.toContain("拒否禁止ロール");
    expect(html).not.toContain("強制削除");
    expect(html).not.toContain("一時VCがまだ設定されていません");
  });

  test("閲覧権限が無ければ自分がオーナーのVCとして表示する(issue #649)", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const guildId = "g1";
    seedCapabilities(queryClient, guildId, 0);
    queryClient.setQueryData(trpc.tempVoice.listActiveChannels.queryOptions({ guildId }).queryKey, []);

    const html = renderPage(guildId, queryClient);

    expect(html).toContain("あなたがオーナーの一時VCはありません");
    expect(html).not.toContain("強制削除");
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
