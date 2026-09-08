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
  queryClient.setQueryData(trpc.access.listRoleOptions.queryOptions({ guildId }).queryKey, [
    { id: guildId, name: "@everyone" },
    { id: "r1", name: "Admin" },
  ]);
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

  test("取得成功時はgrant一覧を種類・対象・権限で描画する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    seedBaseQueries(queryClient, "g1", {
      myCapabilities: CAPABILITIES.MANAGE_ACCESS,
      grants: [
        { id: "grant-1", targetType: "user", targetId: "user-1", capabilities: CAPABILITIES.MANAGE_ACCESS },
        { id: "grant-2", targetType: "role", targetId: "g1", capabilities: CAPABILITIES.VIEW_LOGS },
      ],
    });

    const html = renderPage("g1", queryClient);

    expect(html).toContain("user-1-name");
    expect(html).toContain("@everyone");
    expect(html).toContain(CAPABILITY_LABELS.MANAGE_ACCESS);
    expect(html).toContain(CAPABILITY_LABELS.VIEW_LOGS);
  });

  test("targetNameが解決できないuserはtargetIdをそのまま表示する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    seedBaseQueries(queryClient, "g1", {
      grants: [{ id: "grant-1", targetType: "user", targetId: "unknown-user", capabilities: CAPABILITIES.VIEW_LOGS }],
    });

    const html = renderPage("g1", queryClient);

    expect(html).toContain("unknown-user");
  });

  test("getMyCapabilitiesが保有するcapabilityのスイッチは有効、保有しないものはdisabledになる", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    seedBaseQueries(queryClient, "g1", { myCapabilities: CAPABILITIES.MANAGE_ACCESS });

    const html = renderPage("g1", queryClient);

    const manageAccessLabelIndex = html.indexOf(CAPABILITY_LABELS.MANAGE_ACCESS);
    const manageAccessSwitchStart = html.lastIndexOf('role="switch"', manageAccessLabelIndex);
    const manageAccessSwitchEnd = html.indexOf(">", manageAccessSwitchStart);
    expect(html.slice(manageAccessSwitchStart, manageAccessSwitchEnd)).not.toContain('disabled=""');

    const viewLogsLabelIndex = html.indexOf(CAPABILITY_LABELS.VIEW_LOGS);
    const viewLogsSwitchStart = html.lastIndexOf('role="switch"', viewLogsLabelIndex);
    const viewLogsSwitchEnd = html.indexOf(">", viewLogsSwitchStart);
    expect(html.slice(viewLogsSwitchStart, viewLogsSwitchEnd)).toContain(`disabled=""`);
  });

  test("role経由でcapabilityを持つ場合もgetMyCapabilitiesの値どおりスイッチが有効になる(オーナー・role付与の反映)", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    // 直接grantは無いが、getMyCapabilitiesはrole経由で計算済みの値を返す想定。
    seedBaseQueries(queryClient, "g1", { myCapabilities: CAPABILITIES.MANAGE_ACCESS | CAPABILITIES.VIEW_LOGS });

    const html = renderPage("g1", queryClient);

    const viewLogsLabelIndex = html.indexOf(CAPABILITY_LABELS.VIEW_LOGS);
    const viewLogsSwitchStart = html.lastIndexOf('role="switch"', viewLogsLabelIndex);
    const viewLogsSwitchEnd = html.indexOf(">", viewLogsSwitchStart);
    expect(html.slice(viewLogsSwitchStart, viewLogsSwitchEnd)).not.toContain(`disabled=""`);
  });

  test("自分自身が保有capabilities=0の場合は全スイッチをdisabledにする", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    seedBaseQueries(queryClient, "g1", { myCapabilities: 0 });

    const html = renderPage("g1", queryClient);

    expect(html).toContain("権限の付与・更新");
    const switchIndex = html.indexOf('role="switch"');
    const switchTagEnd = html.indexOf(">", switchIndex);
    expect(html.slice(switchIndex, switchTagEnd)).toContain(`disabled=""`);
  });
});
