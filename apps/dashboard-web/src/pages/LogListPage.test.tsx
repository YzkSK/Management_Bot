import { describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { trpc } from "../trpc.js";
import { LogListPage, shouldShowRawLogPayload } from "./LogListPage.js";

const reactUseState = React.useState;

function renderPage(guildId: string, queryClient: QueryClient): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/guilds/${guildId}/logs`]}>
        <Routes>
          <Route path="/guilds/:guildId/logs" element={<LogListPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LogListPage", () => {
  test("VIEW_LOGS_RAWがなければ保存payloadの生データ欄を表示しない", () => {
    expect(shouldShowRawLogPayload(false, { channelId: "c1" })).toBe(false);
    expect(shouldShowRawLogPayload(true, { channelId: "c1" })).toBe(true);
    expect(shouldShowRawLogPayload(true, {})).toBe(false);
  });

  test("取得完了前はローディング表示になる", () => {
    const queryClient = new QueryClient();
    const html = renderPage("g1", queryClient);
    expect(html).toContain("読み込み中");
  });

  test("初期状態ではリアルタイム更新の接続状況を表示する", () => {
    const queryClient = new QueryClient();
    const html = renderPage("g1", queryClient);
    expect(html).toContain("リアルタイム更新: 接続中...");
  });

  test("カテゴリセレクトにアクセシブルな名前が付いている", () => {
    const queryClient = new QueryClient();
    const html = renderPage("g1", queryClient);
    expect(html).toContain('aria-label="ログのカテゴリ"');
  });

  test("0件取得時は空状態メッセージを表示する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({
        guildId: "g1",
        category: undefined,
        limit: 50,
        cursor: undefined,
      }).queryKey,
      { entries: [], nextCursor: null },
    );
    const html = renderPage("g1", queryClient);
    expect(html).toContain("該当するログはありません");
  });

  test("一覧では自然文の見出しのみを表示し、本文は展開後に表示する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({
        guildId: "g1",
        category: undefined,
        limit: 50,
        cursor: undefined,
      }).queryKey,
      {
        entries: [
          {
            id: "log-1",
            entry: {
              category: "message",
              guildId: "g1",
              createdAt: "2026-09-04T00:00:00.000Z",
              channelId: "c1",
              authorId: "a1",
              action: "create",
              content: "こんにちは",
            },
          },
        ],
        nextCursor: null,
      },
    );
    const html = renderPage("g1", queryClient);

    expect(html).toContain("がメッセージを投稿しました");
    // 初期状態(未展開)ではカードは折りたたまれており、本文はクリックして展開するまでDOMに現れない。
    expect(html).not.toContain("こんにちは");
  });

  test("executorNameスナップショットがあるログのexecutorIdはresolveDisplayNamesの対象から除外する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({
        guildId: "g1",
        category: undefined,
        limit: 50,
        cursor: undefined,
      }).queryKey,
      {
        entries: [
          {
            id: "log-1",
            entry: {
              category: "message",
              guildId: "g1",
              createdAt: "2026-09-04T00:00:00.000Z",
              channelId: "c1",
              authorId: "u1",
              executorId: "mod1",
              executorName: "モデレーター太郎",
              action: "delete",
            },
          },
        ],
        nextCursor: null,
      },
    );
    renderPage("g1", queryClient);

    const namesQueryKey = trpc.logging.resolveDisplayNames.queryOptions({
      guildId: "g1",
      userIds: ["u1"],
      channelIds: ["c1"],
    }).queryKey;
    expect(queryClient.getQueryCache().find({ queryKey: namesQueryKey, exact: true })).toBeDefined();
  });

  test("authorNameスナップショットがあるログのauthorIdはresolveDisplayNamesの対象から除外する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({
        guildId: "g1",
        category: undefined,
        limit: 50,
        cursor: undefined,
      }).queryKey,
      {
        entries: [
          {
            id: "log-1",
            entry: {
              category: "message",
              guildId: "g1",
              createdAt: "2026-09-04T00:00:00.000Z",
              channelId: "c1",
              authorId: "u1",
              authorName: "たろう",
              action: "create",
              content: "こんにちは",
            },
          },
        ],
        nextCursor: null,
      },
    );
    renderPage("g1", queryClient);

    const namesQueryKey = trpc.logging.resolveDisplayNames.queryOptions({
      guildId: "g1",
      userIds: [],
      channelIds: ["c1"],
    }).queryKey;
    expect(queryClient.getQueryCache().find({ queryKey: namesQueryKey, exact: true })).toBeDefined();
  });

  test("executorIdがないmessageエントリはauthorIdを実行者列に表示する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({
        guildId: "g1",
        category: undefined,
        limit: 50,
        cursor: undefined,
      }).queryKey,
      {
        entries: [
          {
            id: "log-1",
            entry: {
              category: "message",
              guildId: "g1",
              createdAt: "2026-09-04T00:00:00.000Z",
              channelId: "c1",
              authorId: "a1",
              action: "create",
              content: "こんにちは",
            },
          },
        ],
        nextCursor: null,
      },
    );
    const html = renderPage("g1", queryClient);

    expect(html).toContain("a1 がメッセージを投稿しました");
  });

  test("実行者列にsubjectIdの表示名(resolveDisplayNamesの結果)が表示される", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({
        guildId: "g1",
        category: undefined,
        limit: 50,
        cursor: undefined,
      }).queryKey,
      {
        entries: [
          {
            id: "log-1",
            entry: {
              category: "message",
              guildId: "g1",
              createdAt: "2026-09-04T00:00:00.000Z",
              channelId: "c1",
              authorId: "u1",
              action: "delete",
            },
          },
        ],
        nextCursor: null,
      },
    );
    queryClient.setQueryData(
      trpc.logging.resolveDisplayNames.queryOptions({
        guildId: "g1",
        userIds: ["u1"],
        channelIds: ["c1"],
      }).queryKey,
      { users: { u1: "テストユーザー" }, channels: {} },
    );
    const html = renderPage("g1", queryClient);

    expect(html).toContain("テストユーザー");
    expect(html).not.toContain(">u1<");
  });

  test("名前解決できないIDはそのままID表示にフォールバックする", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({
        guildId: "g1",
        category: undefined,
        limit: 50,
        cursor: undefined,
      }).queryKey,
      {
        entries: [
          {
            id: "log-1",
            entry: {
              category: "message",
              guildId: "g1",
              createdAt: "2026-09-04T00:00:00.000Z",
              channelId: "c1",
              authorId: "u1",
              action: "delete",
            },
          },
        ],
        nextCursor: null,
      },
    );
    queryClient.setQueryData(
      trpc.logging.resolveDisplayNames.queryOptions({
        guildId: "g1",
        userIds: ["u1"],
        channelIds: ["c1"],
      }).queryKey,
      { users: {}, channels: {} },
    );
    const html = renderPage("g1", queryClient);

    expect(html).toContain("u1 が自分のメッセージを削除しました");
  });

  test("第三者によるメッセージ削除では実行者・投稿者の両方の名前を解決する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({
        guildId: "g1",
        category: undefined,
        limit: 50,
        cursor: undefined,
      }).queryKey,
      {
        entries: [
          {
            id: "log-1",
            entry: {
              category: "message",
              guildId: "g1",
              createdAt: "2026-09-04T00:00:00.000Z",
              channelId: "c1",
              authorId: "u1",
              executorId: "mod1",
              action: "delete",
            },
          },
        ],
        nextCursor: null,
      },
    );
    // userIds: ["mod1", "u1"](実行者・投稿者の両方)でキャッシュしておき、queryKeyが一致した場合のみ
    // 解決結果がヒットすることで、authorId(投稿者)もexecutorId(実行者)と同様に収集されることを検証する。
    queryClient.setQueryData(
      trpc.logging.resolveDisplayNames.queryOptions({
        guildId: "g1",
        userIds: ["mod1", "u1"],
        channelIds: ["c1"],
      }).queryKey,
      { users: { mod1: "Admin", u1: "Yuzuki" }, channels: {} },
    );
    const html = renderPage("g1", queryClient);

    expect(html).toContain("Admin が Yuzuki のメッセージを削除しました");
  });

  test("ボイスログのチャンネルIDをresolveDisplayNamesのchannelIdsに含めて問い合わせる", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({
        guildId: "g1",
        category: undefined,
        limit: 50,
        cursor: undefined,
      }).queryKey,
      {
        entries: [
          {
            id: "log-1",
            entry: {
              category: "voice",
              guildId: "g1",
              createdAt: "2026-09-04T00:00:00.000Z",
              userId: "u1",
              channelId: "c2",
              previousChannelId: "c1",
              action: "move",
            },
          },
        ],
        nextCursor: null,
      },
    );
    // channelIds: ["c1", "c2"]でキャッシュしておき、queryKeyが一致した場合のみusersの解決結果がヒットすることで
    // channelId/previousChannelIdが正しくresolveDisplayNamesのchannelIdsに集約されたことを間接的に検証する。
    queryClient.setQueryData(
      trpc.logging.resolveDisplayNames.queryOptions({
        guildId: "g1",
        userIds: ["u1"],
        channelIds: ["c1", "c2"],
      }).queryKey,
      { users: { u1: "Sora" }, channels: { c1: "雑談", c2: "ゲーム部屋" } },
    );
    const html = renderPage("g1", queryClient);

    expect(html).toContain("Sora");
    expect(html).not.toContain(">u1<");
  });

  test("threadName未設定(移行前)のスレッドログはthreadIdをresolveDisplayNamesのchannelIdsに含めて問い合わせる", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({
        guildId: "g1",
        category: undefined,
        limit: 50,
        cursor: undefined,
      }).queryKey,
      {
        entries: [
          {
            id: "log-1",
            entry: {
              category: "thread",
              guildId: "g1",
              createdAt: "2026-09-04T00:00:00.000Z",
              threadId: "t1",
              channelId: "c1",
              executorId: "mod1",
              action: "create",
            },
          },
        ],
        nextCursor: null,
      },
    );
    queryClient.setQueryData(
      trpc.logging.resolveDisplayNames.queryOptions({
        guildId: "g1",
        userIds: ["mod1"],
        channelIds: ["c1", "t1"],
      }).queryKey,
      { users: { mod1: "Admin" }, channels: { t1: "質問スレ" } },
    );
    const html = renderPage("g1", queryClient);

    expect(html).toContain("Admin が #質問スレ を作成しました");
  });
  test("展開したメンバーのニックネーム変更では差分を日本語ラベルで表示する", () => {
    const expandedIds = new Set(["log-1"]);
    let expandedStateInitialized = false;
    mock.module("react", () => ({
      ...React,
      useState: <T,>(initialValue: T) => {
        if (!expandedStateInitialized && initialValue instanceof Set && initialValue.size === 0) {
          expandedStateInitialized = true;
          const setExpandedIds = mock<React.Dispatch<React.SetStateAction<Set<string>>>>();
          return [expandedIds, setExpandedIds] as [T, React.Dispatch<React.SetStateAction<T>>];
        }
        return reactUseState(initialValue);
      },
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({ guildId: "g1", category: undefined, limit: 50, cursor: undefined }).queryKey,
      {
        entries: [
          {
            id: "log-1",
            entry: {
              category: "member",
              guildId: "g1",
              createdAt: "2026-09-04T00:00:00.000Z",
              userId: "u1",
              action: "nicknameChange",
              changes: { nickname: { before: null, after: "新しい名前" } },
            },
          },
        ],
        nextCursor: null,
      },
    );

    const html = renderPage("g1", queryClient);

    expect(html).toContain("ニックネーム");
    expect(html).toContain("未設定");
    expect(html).toContain("新しい名前");
    mock.restore();
  });
});
