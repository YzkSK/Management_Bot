import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { LogCategory } from "@management-bot/shared";
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

interface Seed {
  retention?: { category: LogCategory; retentionDays: number }[];
  channel?: { category: LogCategory; channelId: string | null }[];
  accessStatus?: "ok" | "forbidden";
  display?: { hideAuditLogCorrelation: boolean; hideBotEvents: boolean };
}

function seeded({
  retention = [{ category: "message", retentionDays: 30 }],
  channel = [{ category: "message", channelId: "c1" }],
  accessStatus = "ok",
  display = { hideAuditLogCorrelation: true, hideBotEvents: true },
}: Seed = {}): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  queryClient.setQueryData(trpc.logging.listRetentionSettings.queryOptions({ guildId: "g1" }).queryKey, retention);
  queryClient.setQueryData(trpc.logging.listChannelSettings.queryOptions({ guildId: "g1" }).queryKey, channel);
  queryClient.setQueryData(trpc.logging.listChannelOptions.queryOptions({ guildId: "g1" }).queryKey, {
    channels: accessStatus === "ok" ? [{ id: "c1", name: "general" }] : [],
    accessStatus,
  });
  queryClient.setQueryData(trpc.logging.getDisplaySettings.queryOptions({ guildId: "g1" }).queryKey, display);
  return queryClient;
}

function switchTags(html: string): string[] {
  return html
    .split('role="switch"')
    .slice(1)
    .map((part) => part.slice(0, part.indexOf(">")));
}

describe("SettingsPage", () => {
  test("取得完了前はローディング表示になる", () => {
    const html = renderPage("g1", new QueryClient());
    expect(html).toContain("読み込み中");
  });

  test("channelOptionsのaccessStatusがforbiddenならBot権限不足メッセージを表示する", () => {
    const html = renderPage("g1", seeded({ accessStatus: "forbidden" }));
    expect(html).toContain("Botに権限がないため");
  });

  test("カテゴリごとの保持期間・出力先チャンネルの入力欄を描画する", () => {
    const html = renderPage("g1", seeded());
    expect(html).toContain("メッセージ");
    expect(html).toContain('value="30"');
    expect(html).toContain('aria-label="メッセージの保持期間(日)"');
    expect(html).toContain('aria-label="メッセージの出力先チャンネル"');
  });

  test("カテゴリごとの設定は初期状態で格納されている(#505)", () => {
    const html = renderPage("g1", seeded());
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/id="per-category-settings" hidden=""/);
    expect(html.indexOf("一括設定")).toBeLessThan(html.indexOf("カテゴリごとに設定する(任意)"));
  });

  test("一括設定のボタンは下書きへ反映するだけで、保存は保存バーから行う(#505)", () => {
    const html = renderPage("g1", seeded());
    expect(html).toContain('aria-label="全カテゴリの出力先チャンネル"');
    expect(html).toContain("全カテゴリに反映");
    expect(html).toContain("保持期間を0にすると無期限で保持します。");
  });

  test("変更がない間は未保存バーを出さない", () => {
    const html = renderPage("g1", seeded());
    expect(html).not.toContain("保存されていない変更があります");
  });

  test("全カテゴリが同じ値のときは一括設定欄に現在値を反映する", () => {
    const html = renderPage(
      "g1",
      seeded({
        retention: [
          { category: "message", retentionDays: 14 },
          { category: "member", retentionDays: 14 },
        ],
      }),
    );
    expect(html).toContain('id="bulk-retention-days"');
    expect(html).toContain('min="0" max="36500"');
    expect(html).toContain('value="14"');
  });

  test("カテゴリごとに値がバラバラなら一括設定欄は空欄にする", () => {
    const html = renderPage(
      "g1",
      seeded({
        retention: [
          { category: "message", retentionDays: 14 },
          { category: "member", retentionDays: 30 },
        ],
      }),
    );
    expect(html).toContain('placeholder="カテゴリごとに異なる"');
  });

  test("監査ログ相関・Botイベントの表示スイッチは保存済みの値を反映する", () => {
    const off = switchTags(renderPage("g1", seeded()));
    expect(off[0]).toContain('aria-checked="false"');
    expect(off[1]).toContain('aria-checked="false"');

    const on = switchTags(
      renderPage("g1", seeded({ display: { hideAuditLogCorrelation: false, hideBotEvents: false } })),
    );
    expect(on[0]).toContain('aria-checked="true"');
    expect(on[1]).toContain('aria-checked="true"');
  });
});
