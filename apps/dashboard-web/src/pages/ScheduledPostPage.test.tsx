import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CAPABILITIES } from "@management-bot/shared";
import { trpc } from "../trpc.js";
import { AllowedRolesSection, ScheduledPostPage } from "./ScheduledPostPage.js";

const guildId = "g1";

function renderPage(capabilities: number): string {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  queryClient.setQueryData(trpc.guildSettings.listMyGuilds.queryOptions().queryKey, [
    { id: guildId, name: "サーバー", isManaged: false, iconUrl: null, capabilities },
  ]);
  queryClient.setQueryData(trpc.scheduledPost.getRequiredPermissionStatus.queryOptions({ guildId }).queryKey, {
    hasRequiredPermissions: true,
    reauthorizeUrl: null,
    accessStatus: "ok",
  });
  queryClient.setQueryData(trpc.scheduledPost.list.queryOptions({ guildId }).queryKey, [
    {
      id: "p1",
      channelId: "c1",
      channelName: "お知らせ",
      authorId: "u1",
      authorName: "ゆずき",
      content: "明日の集合は20時です",
      scheduledAt: "2026-10-10T11:00:00.000Z",
      status: "pending",
      failureReason: null,
      cancelledBy: null,
      finishedAt: null,
    },
  ]);
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/guilds/${guildId}/scheduled-post`]}>
        <Routes>
          <Route path="/guilds/:guildId/scheduled-post" element={<ScheduledPostPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderSettings(allowEveryone: boolean, allowHere: boolean): string {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  queryClient.setQueryData(trpc.scheduledPost.getSettings.queryOptions({ guildId }).queryKey, {
    allowedRoleIds: [],
    allowEveryone,
    allowHere,
  });
  queryClient.setQueryData(trpc.scheduledPost.listRoleOptions.queryOptions({ guildId }).queryKey, []);
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AllowedRolesSection guildId={guildId} />
    </QueryClientProvider>,
  );
}

describe("AllowedRolesSection メンション設定", () => {
  test("@everyone / @here のスイッチが保存値で表示される", () => {
    const html = renderSettings(true, false);

    expect(html).toContain('aria-label="@everyone を許可"');
    expect(html).toContain('aria-label="@here を許可"');
    const switchTag = (label: string) => html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? "";
    expect(switchTag("@everyone を許可")).toContain('aria-checked="true"');
    expect(switchTag("@here を許可")).toContain('aria-checked="false"');
  });
});

describe("ScheduledPostPage", () => {
  test("管理権限があると投稿待ちの予約に取り消しボタンと設定タブが表示される", () => {
    const html = renderPage(CAPABILITIES.VIEW_SCHEDULED_POSTS | CAPABILITIES.MANAGE_SCHEDULED_POSTS);

    expect(html).toContain("明日の集合は20時です");
    expect(html).toContain("お知らせ");
    expect(html).toContain("取り消し");
    expect(html).toContain("設定");
  });

  test("閲覧権限のみだと取り消しボタンも設定タブも表示されない", () => {
    const html = renderPage(CAPABILITIES.VIEW_SCHEDULED_POSTS);

    expect(html).toContain("明日の集合は20時です");
    expect(html).not.toContain("使えるロール");
    // 「取り消し」タブ名はあるが、行の取り消しボタン(size sm)は出ない。
    expect(html).not.toContain("text-destructive border-destructive/40");
  });
});
