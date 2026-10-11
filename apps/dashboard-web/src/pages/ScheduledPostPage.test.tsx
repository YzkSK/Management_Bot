import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CAPABILITIES } from "@management-bot/shared";
import { trpc } from "../trpc.js";
import { ScheduledPostPage } from "./ScheduledPostPage.js";
import { ScheduledPostSettingsPage } from "./ScheduledPostSettingsPage.js";

const guildId = "g1";

function row(overrides: Record<string, unknown>) {
  return {
    id: "p1",
    channelId: "c1",
    channelName: "お知らせ",
    authorId: "u1",
    authorName: "ゆずき",
    content: "明日の集合は20時です",
    scheduledAt: new Date(Date.now() + 18.5 * 3_600_000).toISOString(),
    status: "pending",
    failureReason: null,
    cancelledBy: null,
    finishedAt: null,
    ...overrides,
  };
}

function renderPage(capabilities: number, rows = [row({})]): string {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  queryClient.setQueryData(trpc.guildSettings.listMyGuilds.queryOptions().queryKey, [
    { id: guildId, name: "サーバー", isManaged: false, iconUrl: null, capabilities },
  ]);
  queryClient.setQueryData(trpc.scheduledPost.getRequiredPermissionStatus.queryOptions({ guildId }).queryKey, {
    hasRequiredPermissions: true,
    reauthorizeUrl: null,
    accessStatus: "ok",
  });
  queryClient.setQueryData(trpc.scheduledPost.list.queryOptions({ guildId }).queryKey, rows);
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

function renderSettings(options: { allowEveryone?: boolean; allowHere?: boolean; roleIds?: string[]; empty?: boolean } = {}): string {
  const { allowEveryone = false, allowHere = false, roleIds = [], empty = false } = options;
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  if (!empty) {
    queryClient.setQueryData(trpc.scheduledPost.getSettings.queryOptions({ guildId }).queryKey, {
      allowedRoleIds: roleIds,
      allowEveryone,
      allowHere,
    });
    queryClient.setQueryData(trpc.scheduledPost.listRoleOptions.queryOptions({ guildId }).queryKey, [
      { id: "r1", name: "モデレーター" },
      { id: "r2", name: "イベント係" },
    ]);
  }
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/guilds/${guildId}/scheduled-post/settings`]}>
        <Routes>
          <Route path="/guilds/:guildId/scheduled-post/settings" element={<ScheduledPostSettingsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ScheduledPostSettingsPage", () => {
  test("取得前はローディング、保存済みの設定が下書きの初期値になり、変更がなければ保存バーを出さない", () => {
    expect(renderSettings({ empty: true })).toContain("読み込み中");

    const html = renderSettings({ roleIds: ["r1"], allowEveryone: true, allowHere: false });
    expect(html).toContain("予約投稿の設定");
    expect(html).toContain("← 予約投稿へ戻る");
    expect(html).toContain(`href="/guilds/${guildId}/scheduled-post"`);
    expect(html).toContain("@モデレーター");
    expect(html).not.toContain("保存されていない変更があります");
    const switchTag = (label: string) => html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? "";
    expect(switchTag("予約時に @everyone を指定できるようにする")).toContain('aria-checked="true"');
    expect(switchTag("予約時に @here を指定できるようにする")).toContain('aria-checked="false"');
  });

  test("ロールが未選択ならメンバー全員が使える旨を表示し、追加はセレクターで行う(ID入力欄なし)", () => {
    const html = renderSettings();
    expect(html).toContain("メンバー全員が使えます");
    expect(html).toContain('aria-label="ロールを追加"');
    expect(html).not.toContain('type="text"');
  });
});

describe("ScheduledPostPage", () => {
  test("管理権限があると投稿待ちの予約に取り消すボタンと設定ボタンが表示され、タブに件数が出る", () => {
    const html = renderPage(CAPABILITIES.VIEW_SCHEDULED_POSTS | CAPABILITIES.MANAGE_SCHEDULED_POSTS, [
      row({}),
      row({ id: "p2", status: "posted", scheduledAt: new Date(Date.now() - 48 * 3_600_000).toISOString() }),
    ]);

    expect(html).toContain("明日の集合は20時です");
    expect(html).toContain("#お知らせ");
    expect(html).toContain("あと18時間");
    expect(html).toContain("取り消す");
    expect(html).toContain("予約投稿の設定");
    expect(html).toContain(`href="/guilds/${guildId}/scheduled-post/settings"`);
    // 設定タブは廃止。
    expect(html).not.toContain("使えるロール");
    expect(html).toMatch(/投稿待ち<span[^>]*>1<\/span>/);
    expect(html).toMatch(/投稿済み<span[^>]*>1<\/span>/);
  });

  test("閲覧権限のみだと取り消しボタンも設定ボタンも表示されない", () => {
    const html = renderPage(CAPABILITIES.VIEW_SCHEDULED_POSTS);

    expect(html).toContain("明日の集合は20時です");
    expect(html).not.toContain("予約投稿の設定");
    expect(html).not.toContain("text-destructive border-destructive/40");
  });
});
