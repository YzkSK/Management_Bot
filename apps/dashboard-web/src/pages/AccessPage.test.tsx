import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CAPABILITIES } from "@management-bot/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { trpc } from "../trpc.js";
import { CAPABILITY_LABELS, CAPABILITY_PRESETS } from "./capability-labels.js";
import { AccessPage } from "./AccessPage.js";

function renderPage(guildId: string, queryClient: QueryClient): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/guilds/${guildId}/access`]}>
        <Routes>
          <Route path="/guilds/:guildId/access" element={<AccessPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function seedBaseQueries(
  queryClient: QueryClient,
  guildId: string,
  options: { myCapabilities?: number; grants?: unknown[] } = {},
): void {
  queryClient.setQueryData(trpc.access.listRoleOptions.queryOptions({ guildId }).queryKey, {
    roles: [
      { id: guildId, name: "@everyone" },
      { id: "r1", name: "Admin" },
    ],
    accessStatus: "ok",
  });
  queryClient.setQueryData(trpc.access.listMemberOptions.queryOptions({ guildId, after: undefined }).queryKey, {
    members: [
      { id: "u1", name: "user-one" },
      { id: "user-1", name: "user-1-name" },
    ],
    nextAfter: undefined,
  });
  queryClient.setQueryData(trpc.access.getMyCapabilities.queryOptions({ guildId }).queryKey, {
    capabilities: options.myCapabilities ?? 0,
  });
  queryClient.setQueryData(trpc.access.listCapabilityGrants.queryOptions({ guildId }).queryKey, options.grants ?? []);
  queryClient.setQueryData(
    trpc.access.resolveTargetUserNames.queryOptions({
      guildId,
      userIds: (options.grants ?? [])
        .filter((g): g is { targetType: string; targetId: string } => typeof g === "object" && g !== null)
        .filter((g) => g.targetType === "user")
        .map((g) => g.targetId),
    }).queryKey,
    { "user-1": "user-1-name" },
  );
}

/** 権限名ラベルの直前にあるチェックボックスのタグを返す(チェックボックスはラベル文字列の前に描画する)。 */
function checkboxTagBefore(html: string, label: string): string {
  const labelIndex = html.indexOf(`>${label}</label>`);
  const start = html.lastIndexOf('type="checkbox"', labelIndex);
  const tagStart = html.lastIndexOf("<input", start);
  return html.slice(tagStart, html.indexOf(">", start));
}

describe("AccessPage", () => {
  test("取得完了前はローディング表示になる", () => {
    const queryClient = new QueryClient();
    const html = renderPage("g1", queryClient);
    expect(html).toContain("読み込み中");
  });

  test("取得成功時はサイドバーに全ロールと付与済みユーザーを表示する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    seedBaseQueries(queryClient, "g1", {
      myCapabilities: CAPABILITIES.MANAGE_ACCESS,
      grants: [
        { id: "grant-1", targetType: "user", targetId: "user-1", capabilities: CAPABILITIES.MANAGE_ACCESS },
        { id: "grant-2", targetType: "role", targetId: "r1", capabilities: CAPABILITIES.VIEW_LOGS },
      ],
    });

    const html = renderPage("g1", queryClient);

    // ロールは未付与のものも含め全件(listRoleOptions由来)表示する。
    expect(html).toContain("@everyone");
    expect(html).toContain("Admin");
    // ユーザーは付与済みのもの(grantsWithName由来)のみ表示する。
    expect(html).toContain("user-1-name");
  });

  test("targetNameが解決できないuserはtargetIdをそのまま表示する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    seedBaseQueries(queryClient, "g1", {
      myCapabilities: CAPABILITIES.MANAGE_ACCESS,
      grants: [{ id: "grant-1", targetType: "user", targetId: "unknown-user", capabilities: CAPABILITIES.VIEW_LOGS }],
    });

    const html = renderPage("g1", queryClient);

    expect(html).toContain("unknown-user");
  });

  test("ユーザー名の解決中はIDを見せずスケルトンを表示する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    seedBaseQueries(queryClient, "g1", { myCapabilities: CAPABILITIES.MANAGE_ACCESS });
    // resolveTargetUserNamesを未取得のままにするため、seedBaseQueriesとは別のgrantsで上書きする。
    queryClient.setQueryData(trpc.access.listCapabilityGrants.queryOptions({ guildId: "g1" }).queryKey, [
      { id: "grant-1", targetType: "user", targetId: "pending-user", capabilities: CAPABILITIES.VIEW_LOGS },
    ]);

    const html = renderPage("g1", queryClient);

    expect(html).toContain('aria-label="名前を読み込み中"');
    expect(html).not.toContain("pending-user");
  });

  test("初期選択は先頭のロールで、権限タブにそのロールの権限グループが描画される", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    seedBaseQueries(queryClient, "g1", {
      myCapabilities: CAPABILITIES.MANAGE_ACCESS,
      grants: [{ id: "grant-1", targetType: "role", targetId: "g1", capabilities: CAPABILITIES.VIEW_LOGS }],
    });

    const html = renderPage("g1", queryClient);

    expect(html).toContain("@everyone を編集");
    expect(html).toContain(CAPABILITY_LABELS.VIEW_LOGS);
  });

  test("getMyCapabilitiesが保有するcapabilityのチェックボックスは有効、保有しないものはdisabledになる", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    seedBaseQueries(queryClient, "g1", {
      myCapabilities: CAPABILITIES.MANAGE_ACCESS,
      grants: [{ id: "grant-1", targetType: "role", targetId: "g1", capabilities: CAPABILITIES.MANAGE_ACCESS }],
    });

    const html = renderPage("g1", queryClient);

    expect(checkboxTagBefore(html, CAPABILITY_LABELS.MANAGE_ACCESS)).not.toContain('disabled=""');
    expect(checkboxTagBefore(html, CAPABILITY_LABELS.VIEW_LOGS)).toContain('disabled=""');
  });

  test("自分自身が保有capabilities=0の場合は全チェックボックスをdisabledにする", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    seedBaseQueries(queryClient, "g1", { myCapabilities: 0 });

    const html = renderPage("g1", queryClient);

    for (const label of Object.values(CAPABILITY_LABELS)) {
      expect(checkboxTagBefore(html, label)).toContain('disabled=""');
    }
  });

  test("プリセット選択欄は、付与済みの権限と一致するプリセット名を表示する(#505)", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const moderator = CAPABILITY_PRESETS.find((p) => p.label === "モデレーター")?.capabilities ?? 0;
    seedBaseQueries(queryClient, "g1", {
      myCapabilities: CAPABILITIES.MANAGE_ACCESS,
      grants: [{ id: "grant-1", targetType: "role", targetId: "g1", capabilities: moderator }],
    });

    const html = renderPage("g1", queryClient);

    expect(html).toContain('aria-label="権限プリセット"');
    // 一覧の各対象にも一致したプリセット名を添える(@everyone=モデレーター、未付与のAdmin=権限なし)
    expect(html).toContain("モデレーター");
    expect(html).not.toContain("カスタム");
  });

  test("プリセットと一致しない付与はカスタム、未付与は権限なしと表示する(#505)", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    seedBaseQueries(queryClient, "g1", {
      myCapabilities: CAPABILITIES.MANAGE_ACCESS,
      grants: [{ id: "grant-1", targetType: "role", targetId: "g1", capabilities: CAPABILITIES.VIEW_LOGS_RAW }],
    });

    const html = renderPage("g1", queryClient);

    expect(html).toContain("カスタム");
    // Adminロールは未付与
    expect(html).toContain("権限なし");
  });

  test("サイドバーの検索ボックスが表示される", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    seedBaseQueries(queryClient, "g1", { myCapabilities: CAPABILITIES.MANAGE_ACCESS });

    const html = renderPage("g1", queryClient);

    expect(html).toContain("ロール・ユーザーを検索");
  });

  test("すべての付与状況の一覧は表示しない", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    seedBaseQueries(queryClient, "g1", {
      myCapabilities: CAPABILITIES.MANAGE_ACCESS,
      grants: [
        { id: "grant-1", targetType: "user", targetId: "user-1", capabilities: CAPABILITIES.MANAGE_ACCESS },
        { id: "grant-2", targetType: "role", targetId: "r1", capabilities: CAPABILITIES.VIEW_LOGS },
      ],
    });

    const html = renderPage("g1", queryClient);

    expect(html).not.toContain("すべての付与状況");
  });

  test("必須クエリ(grants/myCapabilities)が未取得の間はlistRoleOptions/resolveTargetUserNamesを発火しない", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    // listCapabilityGrants/getMyCapabilitiesを意図的にseedしない(pending状態を維持する)。

    renderPage("g1", queryClient);

    const roleOptionsState = queryClient.getQueryState(
      trpc.access.listRoleOptions.queryOptions({ guildId: "g1" }).queryKey,
    );
    const targetUserNamesState = queryClient.getQueryState(
      trpc.access.resolveTargetUserNames.queryOptions({ guildId: "g1", userIds: [] }).queryKey,
    );
    expect(roleOptionsState?.fetchStatus).toBe("idle");
    expect(roleOptionsState?.dataUpdatedAt).toBe(0);
    expect(targetUserNamesState?.fetchStatus).toBe("idle");
    expect(targetUserNamesState?.dataUpdatedAt).toBe(0);
  });

  test("必須クエリの片方(myCapabilities)しか取得できていない間はlistRoleOptionsを発火しない", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    // listCapabilityGrantsは未取得のまま、getMyCapabilitiesのみ成功させる。
    queryClient.setQueryData(trpc.access.getMyCapabilities.queryOptions({ guildId: "g1" }).queryKey, {
      capabilities: CAPABILITIES.MANAGE_ACCESS,
    });

    renderPage("g1", queryClient);

    const roleOptionsState = queryClient.getQueryState(
      trpc.access.listRoleOptions.queryOptions({ guildId: "g1" }).queryKey,
    );
    expect(roleOptionsState?.fetchStatus).toBe("idle");
    expect(roleOptionsState?.dataUpdatedAt).toBe(0);
  });

  test("オーナーは「オーナー」と表示し、権限の編集を無効化する(issue #523)", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    seedBaseQueries(queryClient, "g1", {
      myCapabilities: CAPABILITIES.MANAGE_ACCESS | CAPABILITIES.VIEW_LOGS,
      grants: [{ id: "grant-1", targetType: "user", targetId: "user-1", capabilities: CAPABILITIES.VIEW_LOGS }],
    });
    // 初期選択を個別ユーザー(オーナー)にするため、ロール一覧を空にする。
    queryClient.setQueryData(trpc.access.listRoleOptions.queryOptions({ guildId: "g1" }).queryKey, {
      roles: [],
      accessStatus: "ok",
    });
    queryClient.setQueryData(trpc.access.getGuildOwner.queryOptions({ guildId: "g1" }).queryKey, { ownerId: "user-1" });

    const html = renderPage("g1", queryClient);

    expect(html).toContain(">オーナー<");
    expect(html).toContain("編集・剥奪できません");
    expect(checkboxTagBefore(html, CAPABILITY_LABELS.VIEW_LOGS)).toContain("disabled");
  });

  test("オーナー以外のユーザーは従来どおりプリセット名を表示する(issue #523)", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    seedBaseQueries(queryClient, "g1", {
      myCapabilities: CAPABILITIES.MANAGE_ACCESS,
      grants: [{ id: "grant-1", targetType: "user", targetId: "user-1", capabilities: CAPABILITIES.VIEW_LOGS }],
    });
    queryClient.setQueryData(trpc.access.getGuildOwner.queryOptions({ guildId: "g1" }).queryKey, { ownerId: "other" });

    const html = renderPage("g1", queryClient);

    expect(html).not.toContain(">オーナー<");
    expect(html).not.toContain("編集・剥奪できません");
  });

  test("オーナー情報の取得中は個別ユーザーの権限を編集させない(issue #523)", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    seedBaseQueries(queryClient, "g1", {
      myCapabilities: CAPABILITIES.MANAGE_ACCESS | CAPABILITIES.VIEW_LOGS,
      grants: [{ id: "grant-1", targetType: "user", targetId: "user-1", capabilities: CAPABILITIES.VIEW_LOGS }],
    });
    queryClient.setQueryData(trpc.access.listRoleOptions.queryOptions({ guildId: "g1" }).queryKey, {
      roles: [],
      accessStatus: "ok",
    });

    const html = renderPage("g1", queryClient);

    expect(html).toContain("オーナー情報を確認中です。");
    expect(checkboxTagBefore(html, CAPABILITY_LABELS.VIEW_LOGS)).toContain("disabled");
  });
});
