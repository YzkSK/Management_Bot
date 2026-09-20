import { describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { trpc } from "../trpc.js";
import { canUpdateStrikePages, isStrikePagesPending, ModerationHistoryTab, ModerationPage } from "./ModerationPage.js";

const reactUseState = React.useState;

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

function renderHistory(guildId: string, queryClient: QueryClient): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ModerationHistoryTab guildId={guildId} />
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
  test("検知履歴では対象ユーザーを表示名で要約し、詳細は初期表示で閉じる", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const guildId = "g1";
    seedBaseQueries(queryClient, guildId);
    queryClient.setQueryData(trpc.moderation.listThresholds.queryOptions({ guildId }).queryKey, []);
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({ guildId, category: "moderationCase", limit: 50 }).queryKey,
      {
        entries: [
          {
            id: "log-raid",
            entry: {
              category: "moderationCase",
              guildId,
              createdAt: "2026-09-20T00:00:00.000Z",
              caseId: "case-raid",
              targetUserId: "u1",
              moderatorId: "system",
              action: "resolve",
              actionType: "timeout",
              timeoutMinutes: 10,
              result: "failed",
              failureCode: "MISSING_PERMISSIONS",
              incident: {
                violationType: "raid",
                score: null,
                matchedMessageCount: 6,
                deletedMessageCount: 0,
                strikeCount: null,
                raidSeverity: "high",
                raidTargetCount: 6,
              },
            },
          },
          {
            id: "log-legacy",
            entry: {
              category: "moderationCase",
              guildId,
              createdAt: "2026-08-01T00:00:00.000Z",
              caseId: "case-legacy",
              targetUserId: "u2",
              moderatorId: "system",
              action: "create",
              actionType: "warn",
            },
          },
        ],
        nextCursor: null,
      },
    );
    queryClient.setQueryData(
      trpc.logging.resolveDisplayNames.queryOptions({ guildId, userIds: ["u1", "u2"], channelIds: [] }).queryKey,
      { users: { u1: "レイド対象" }, channels: {} },
    );

    const html = renderHistory(guildId, queryClient);

    expect(html).toContain("レイド対象 / レイド");
    expect(html).toContain("u2 / 旧ログ");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("case-raid");
    expect(html).not.toContain("timeout / failed (MISSING_PERMISSIONS)");
  });

  test("検知履歴を展開するとケースID、処分、検知詳細を表示する", () => {
    const expandedIds = new Set(["log-raid"]);
    let expandedStateInitialized = false;
    mock.module("react", () => ({
      ...React,
      useState: <T,>(initialValue: T) => {
        if (!expandedStateInitialized && initialValue instanceof Set && initialValue.size === 0) {
          expandedStateInitialized = true;
          return [expandedIds, mock<React.Dispatch<React.SetStateAction<Set<string>>>>()] as [
            T,
            React.Dispatch<React.SetStateAction<T>>,
          ];
        }
        return reactUseState(initialValue);
      },
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const guildId = "g1";
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({ guildId, category: "moderationCase", limit: 50 }).queryKey,
      {
        entries: [
          {
            id: "log-raid",
            entry: {
              category: "moderationCase",
              guildId,
              createdAt: "2026-09-20T00:00:00.000Z",
              caseId: "case-raid",
              targetUserId: "u1",
              moderatorId: "system",
              action: "resolve",
              actionType: "timeout",
              timeoutMinutes: 10,
              result: "failed",
              failureCode: "MISSING_PERMISSIONS",
              incident: {
                violationType: "raid",
                score: null,
                matchedMessageCount: 6,
                deletedMessageCount: 0,
                strikeCount: null,
                raidSeverity: "high",
                raidTargetCount: 6,
              },
            },
          },
        ],
        nextCursor: null,
      },
    );
    queryClient.setQueryData(
      trpc.logging.resolveDisplayNames.queryOptions({ guildId, userIds: ["u1"], channelIds: [] }).queryKey,
      { users: {}, channels: {} },
    );

    try {
      const html = renderHistory(guildId, queryClient);

      expect(html).toContain('aria-expanded="true"');
      expect(html).toContain("case-raid");
      expect(html).toContain("timeout / failed (MISSING_PERMISSIONS)");
      expect(html).toContain("高危険度 / 対象 6件 / 削除 0件");
    } finally {
      mock.restore();
    }
  });

  test("検知履歴タブを表示する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const guildId = "g1";
    seedBaseQueries(queryClient, guildId);
    queryClient.setQueryData(trpc.moderation.listThresholds.queryOptions({ guildId }).queryKey, []);

    expect(renderPage(guildId, queryClient)).toContain("検知履歴");
  });

  test("raidの設定行を表示する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const guildId = "g1";
    seedBaseQueries(queryClient, guildId);
    queryClient.setQueryData(trpc.moderation.listThresholds.queryOptions({ guildId }).queryKey, []);

    const html = renderPage(guildId, queryClient);

    expect(html).toContain("レイド(大量入室)");
    expect(html).not.toContain("新規アカウントガード");
  });

  test("強度が不要な違反種別には共通表示や詳細を出さない", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const guildId = "g1";
    seedBaseQueries(queryClient, guildId);
    queryClient.setQueryData(trpc.moderation.listThresholds.queryOptions({ guildId }).queryKey, []);

    const html = renderPage(guildId, queryClient);

    expect(html).not.toContain("強度共通");
    expect(html).not.toContain("強度に関わらず共通");
    expect(html).toContain('aria-label="連投の強度"');
  });
});

describe("Lockdown controls", () => {
  test("renders configured lockdown state", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const guildId = "g1";
    seedBaseQueries(queryClient, guildId);
    queryClient.setQueryData(trpc.moderation.listThresholds.queryOptions({ guildId }).queryKey, []);
    queryClient.setQueryData(trpc.moderation.getLockdownSettings.queryOptions({ guildId }).queryKey, {
      autoLockdownOnRaid: true,
      requestedLocked: true,
      isLocked: true,
    });

    const html = renderPage(guildId, queryClient);

    expect(html).toContain("レイド時に自動でロックダウン");
    expect(html).toContain("現在の状態: ロック中");
    expect(html).toContain("ロックダウンを解除");
  });
});

describe("canUpdateStrikePages(#368のCodexレビュー指摘の回帰テスト)", () => {
  test("取得完了(isFetching=false)かつデータありならpagesを更新できる", () => {
    expect(canUpdateStrikePages({ rows: [], userNames: {} }, false)).toBe(true);
  });

  test("取得中(isFetching=true)はデータがあってもpagesを更新できない(resetPages直後の古いキャッシュ再表示を防ぐ)", () => {
    expect(canUpdateStrikePages({ rows: [], userNames: {} }, true)).toBe(false);
  });

  test("データ未取得(undefined)ならpagesを更新できない", () => {
    expect(canUpdateStrikePages(undefined, false)).toBe(false);
  });
});

describe("isStrikePagesPending(#368のCodexレビュー指摘の回帰テスト)", () => {
  test("行が0件でisPending中はpending扱い", () => {
    expect(isStrikePagesPending(0, true, false)).toBe(true);
  });

  test("行が0件でisFetching中(isPendingはfalse)もpending扱い(resetPages直後、invalidateQueriesで古いキャッシュが残る間はisPendingがfalseのままのため)", () => {
    expect(isStrikePagesPending(0, false, true)).toBe(true);
  });

  test("行が0件でもisPending/isFetchingどちらもfalseなら「履歴なし」として扱う(pending扱いにしない)", () => {
    expect(isStrikePagesPending(0, false, false)).toBe(false);
  });

  test("行が1件以上あればisPending/isFetchingに関わらずpending扱いしない", () => {
    expect(isStrikePagesPending(1, true, true)).toBe(false);
  });
});
