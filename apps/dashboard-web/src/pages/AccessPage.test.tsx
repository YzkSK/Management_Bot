import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CAPABILITIES } from "@management-bot/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { trpc } from "../trpc.js";
import { CAPABILITY_LABELS } from "./capability-labels.js";
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

  test("getMyCapabilitiesが保有するcapabilityのスイッチは有効、保有しないものはdisabledになる", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    seedBaseQueries(queryClient, "g1", {
      myCapabilities: CAPABILITIES.MANAGE_ACCESS,
      grants: [{ id: "grant-1", targetType: "role", targetId: "g1", capabilities: CAPABILITIES.MANAGE_ACCESS }],
    });

    const html = renderPage("g1", queryClient);

    const manageAccessLabelIndex = html.indexOf(CAPABILITY_LABELS.MANAGE_ACCESS);
    const manageAccessSwitchStart = html.indexOf('role="switch"', manageAccessLabelIndex);
    const manageAccessSwitchEnd = html.indexOf(">", manageAccessSwitchStart);
    expect(html.slice(manageAccessSwitchStart, manageAccessSwitchEnd)).not.toContain('disabled=""');

    const viewLogsLabelIndex = html.indexOf(CAPABILITY_LABELS.VIEW_LOGS);
    const viewLogsSwitchStart = html.indexOf('role="switch"', viewLogsLabelIndex);
    const viewLogsSwitchEnd = html.indexOf(">", viewLogsSwitchStart);
    expect(html.slice(viewLogsSwitchStart, viewLogsSwitchEnd)).toContain(`disabled=""`);
  });

  test("自分自身が保有capabilities=0の場合は全スイッチをdisabledにする", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    seedBaseQueries(queryClient, "g1", { myCapabilities: 0 });

    const html = renderPage("g1", queryClient);

    const switchIndex = html.indexOf('role="switch"');
    const switchTagEnd = html.indexOf(">", switchIndex);
    expect(html.slice(switchIndex, switchTagEnd)).toContain(`disabled=""`);
  });

  test("権限プリセットのボタンが表示される", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    seedBaseQueries(queryClient, "g1", { myCapabilities: CAPABILITIES.MANAGE_ACCESS });

    const html = renderPage("g1", queryClient);

    expect(html).toContain("モデレーター");
    expect(html).toContain("フル管理者");
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
});
