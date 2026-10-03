import { describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { trpc } from "../trpc.js";
import { LogListPage, shouldShowRawLogPayload } from "./LogListPage.js";

const reactUseState = React.useState;

/** 名前解決が完了して該当なし(IDにフォールバックする)状態にする。 */
function resolveNoNames(queryClient: QueryClient): void {
  const [path] = trpc.logging.resolveDisplayNames.pathKey();
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type === "added" && JSON.stringify(event.query.queryKey[0]) === JSON.stringify(path)) {
      event.query.setData({ users: {}, channels: {} });
    }
  });
}

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

  test("カテゴリ絞り込みは未選択時「すべて」を表示するボタンになっている(#505)", () => {
    const queryClient = new QueryClient();
    const html = renderPage("g1", queryClient);
    expect(html).toContain('aria-haspopup="true"');
    expect(html).toContain('<b>すべて</b>');
  });

  test("0件取得時は空状態メッセージを表示する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({
        guildId: "g1",
        categories: undefined,
        limit: 50,
        offset: 0,
      }).queryKey,
      { entries: [], totalCount: 0 },
    );
    const html = renderPage("g1", queryClient);
    expect(html).toContain("該当するログはありません");
  });

  test("総件数から現在ページ・総ページ数と最大5個のページ番号を表示する(#520)", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({ guildId: "g1", categories: undefined, limit: 50, offset: 0 }).queryKey,
      { hasRawAccess: true, entries: [], totalCount: 401 },
    );
    const html = renderPage("g1", queryClient);
    expect(html).toContain("1 / 9 ページ(全401件)");
    expect(html).toContain('aria-current="page"');
    const pageButtons = [...html.matchAll(/<button[^>]*>(\d+)<\/button>/g)].map((m) => m[1]);
    expect(pageButtons).toEqual(["1", "2", "3", "4", "5"]);
    expect(html).toContain('aria-label="前のページ"');
    expect(html).toContain('aria-label="次のページ"');
  });

  test("一覧では自然文の見出しのみを表示し、本文は展開後に表示する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    resolveNoNames(queryClient);
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({
        guildId: "g1",
        categories: undefined,
        limit: 50,
        offset: 0,
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
        totalCount: 0,
      },
    );
    const html = renderPage("g1", queryClient);

    expect(html).toContain("がメッセージを投稿しました");
    // 初期状態(未展開)ではカードは折りたたまれており、本文はクリックして展開するまでDOMに現れない。
    expect(html).not.toContain("こんにちは");
  });

  test("名前解決中は見出しの名前部分だけをスケルトンにしてIDを見せない", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({ guildId: "g1", categories: undefined, limit: 50, offset: 0 }).queryKey,
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
        totalCount: 0,
      },
    );
    const html = renderPage("g1", queryClient);

    expect(html.match(/aria-label="名前を読み込み中"/g)).toHaveLength(2); // チャンネルと投稿者
    expect(html).toContain("がメッセージを投稿しました");
    expect(html).not.toContain("a1");
    expect(html).not.toContain("");
  });

  test("executorNameスナップショットがあるログのexecutorIdはresolveDisplayNamesの対象から除外する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({
        guildId: "g1",
        categories: undefined,
        limit: 50,
        offset: 0,
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
        totalCount: 0,
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
        categories: undefined,
        limit: 50,
        offset: 0,
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
        totalCount: 0,
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
    resolveNoNames(queryClient);
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({
        guildId: "g1",
        categories: undefined,
        limit: 50,
        offset: 0,
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
        totalCount: 0,
      },
    );
    const html = renderPage("g1", queryClient);

    expect(html).toContain(">@a1</span> がメッセージを投稿しました");
  });

  test("実行者列にsubjectIdの表示名(resolveDisplayNamesの結果)が表示される", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({
        guildId: "g1",
        categories: undefined,
        limit: 50,
        offset: 0,
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
        totalCount: 0,
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
        categories: undefined,
        limit: 50,
        offset: 0,
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
        totalCount: 0,
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

    expect(html).toContain(">@u1</span> が自分のメッセージを削除しました");
  });

  test("第三者によるメッセージ削除では実行者・投稿者の両方の名前を解決する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({
        guildId: "g1",
        categories: undefined,
        limit: 50,
        offset: 0,
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
        totalCount: 0,
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

    expect(html).toContain(">@Admin</span> が <span class=\"rounded bg-indigo-100 px-1.5 font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200\">@Yuzuki</span> のメッセージを削除しました");
  });

  test("ボイスログのチャンネルIDをresolveDisplayNamesのchannelIdsに含めて問い合わせる", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({
        guildId: "g1",
        categories: undefined,
        limit: 50,
        offset: 0,
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
        totalCount: 0,
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
        categories: undefined,
        limit: 50,
        offset: 0,
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
        totalCount: 0,
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

    expect(html).toContain(">#質問スレ</span> を作成しました");
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
      trpc.logging.listLogEntries.queryOptions({ guildId: "g1", categories: undefined, limit: 50, offset: 0 }).queryKey,
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
        totalCount: 0,
      },
    );

    const html = renderPage("g1", queryClient);

    expect(html).toContain("ニックネーム");
    expect(html).toContain("未設定");
    expect(html).toContain("新しい名前");
    mock.restore();
  });
  test("一括削除に関連する投稿ログを初期状態で折りたたんで表示する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({ guildId: "g1", categories: undefined, limit: 50, offset: 0 }).queryKey,
      {
        entries: [
          {
            id: "log-bulk",
            entry: {
              category: "message",
              guildId: "g1",
              createdAt: "2026-09-20T00:00:00.000Z",
              channelId: "c1",
              action: "bulkDelete",
              deletedMessages: [{ messageId: "m1", authorId: "u1" }],
            },
            collapsedEntries: [
              {
                id: "log-create-1",
                entry: {
                  category: "message",
                  guildId: "g1",
                  createdAt: "2026-09-20T00:00:00.000Z",
                  channelId: "c1",
                  authorId: "u1",
                  authorName: "投稿者A",
                  messageId: "m1",
                  action: "create",
                  content: "削除対象の投稿本文",
                },
              },
            ],
          },
        ],
        totalCount: 0,
      },
    );

    const html = renderPage("g1", queryClient);

    expect(html).toContain("削除された投稿ログ（1件）");
    expect(html).not.toContain("削除対象の投稿本文");
  });

  test("折りたたんだ投稿ログを展開すると投稿者・本文・添付ファイルを表示する", () => {
    const expandedIds = new Set(["collapsed-log-bulk"]);
    let expandedStateInitialized = false;
    mock.module("react", () => ({
      ...React,
      useState: <T,>(initialValue: T) => {
        if (!expandedStateInitialized && initialValue instanceof Set && initialValue.size === 0) {
          expandedStateInitialized = true;
          return [expandedIds, mock<React.Dispatch<React.SetStateAction<Set<string>>>>()] as [T, React.Dispatch<React.SetStateAction<T>>];
        }
        return reactUseState(initialValue);
      },
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({ guildId: "g1", categories: undefined, limit: 50, offset: 0 }).queryKey,
      {
        entries: [
          {
            id: "log-bulk",
            entry: {
              category: "message",
              guildId: "g1",
              createdAt: "2026-09-20T00:00:00.000Z",
              channelId: "c1",
              action: "bulkDelete",
              deletedMessages: [{ messageId: "m1", authorId: "u1" }],
            },
            collapsedEntries: [
              {
                id: "log-create-1",
                entry: {
                  category: "message",
                  guildId: "g1",
                  createdAt: "2026-09-20T00:00:00.000Z",
                  channelId: "c1",
                  authorId: "u1",
                  authorName: "投稿者A",
                  messageId: "m1",
                  action: "create",
                  content: "削除対象の投稿本文",
                  attachments: [
                    { url: "https://cdn.discordapp.com/a.png", filename: "a.png", contentType: "image/png" },
                    { url: "https://media.tenor.com/x/cat.mp4", filename: "cat.mp4", contentType: "video/mp4", gifv: true },
                    { url: "https://cdn.discordapp.com/clip.mp4", filename: "clip.mp4", contentType: "video/mp4" },
                    { url: "https://cdn.discordapp.com/SPOILER_b.png", filename: "SPOILER_b.png", contentType: "image/png" },
                  ],
                },
              },
            ],
          },
        ],
        totalCount: 0,
      },
    );

    const html = renderPage("g1", queryClient);

    expect(html).toContain("投稿者A");
    expect(html).toContain("削除対象の投稿本文");
    expect(html).toContain('<img src="https://cdn.discordapp.com/a.png"');
    expect(html).toMatch(/<video src="https:\/\/media\.tenor\.com\/x\/cat\.mp4"[^>]*autoPlay=""[^>]*loop=""/);
    expect(html).toMatch(/<video src="https:\/\/cdn\.discordapp\.com\/clip\.mp4"[^>]*controls=""/);
    expect(html).not.toMatch(/clip\.mp4"[^>]*autoPlay/);
    expect(html).toMatch(/SPOILER_b\.png"[^>]*blur-xl/);
    expect(html).toContain("ネタバレ");
    mock.restore();
  });

  test("折りたたまれた投稿ログの投稿者IDも表示名解決の対象にする", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({ guildId: "g1", categories: undefined, limit: 50, offset: 0 }).queryKey,
      {
        entries: [
          {
            id: "log-bulk",
            entry: {
              category: "message",
              guildId: "g1",
              createdAt: "2026-09-20T00:00:00.000Z",
              channelId: "c1",
              action: "bulkDelete",
              deletedMessages: [{ messageId: "m1", authorId: "u1" }],
            },
            collapsedEntries: [
              {
                id: "log-create-1",
                entry: {
                  category: "message",
                  guildId: "g1",
                  createdAt: "2026-09-20T00:00:00.000Z",
                  channelId: "c1",
                  authorId: "u2",
                  messageId: "m1",
                  action: "create",
                },
              },
            ],
          },
        ],
        totalCount: 0,
      },
    );

    renderPage("g1", queryClient);

    const namesQueryKey = trpc.logging.resolveDisplayNames.queryOptions({
      guildId: "g1",
      userIds: ["u2"],
      channelIds: ["c1"],
    }).queryKey;
    expect(queryClient.getQueryCache().find({ queryKey: namesQueryKey, exact: true })).toBeDefined();
  });

  test("集約bulkDeleteを展開すると投稿者・本文・添付ファイル・メッセージIDを表示する", () => {
    const expandedIds = new Set(["log-bulk"]);
    let expandedStateInitialized = false;
    mock.module("react", () => ({
      ...React,
      useState: <T,>(initialValue: T) => {
        if (!expandedStateInitialized && initialValue instanceof Set && initialValue.size === 0) {
          expandedStateInitialized = true;
          return [expandedIds, mock<React.Dispatch<React.SetStateAction<Set<string>>>>()] as [T, React.Dispatch<React.SetStateAction<T>>];
        }
        return reactUseState(initialValue);
      },
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    resolveNoNames(queryClient);
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({ guildId: "g1", categories: undefined, limit: 50, offset: 0 }).queryKey,
      {
        entries: [
          {
            id: "log-bulk",
            entry: {
              category: "message",
              guildId: "g1",
              createdAt: "2026-09-20T00:00:00.000Z",
              channelId: "c1",
              action: "bulkDelete",
              deletedMessages: [
                {
                  messageId: "m1",
                  authorId: "u1",
                  authorName: "投稿者A",
                  content: "削除本文A",
                  attachments: [{ url: "https://cdn.discordapp.com/a.png", filename: "a.png", contentType: "image/png" }],
                },
                { messageId: "m2", authorId: "u2" },
              ],
            },
          },
        ],
        totalCount: 0,
      },
    );

    const html = renderPage("g1", queryClient);

    expect(html).toContain("2件のメッセージが一括削除されました");
    expect(html).toContain("削除されたメッセージ");
    expect(html).toContain("投稿者A");
    expect(html).toContain("削除本文A");
    expect(html).toContain("u2");
    expect(html).toContain("本文なし");
    expect(html).toContain("メッセージ ID: m1");
    expect(html).toContain("a.png");
    mock.restore();
  });
});
