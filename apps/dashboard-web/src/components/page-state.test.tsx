import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { trpc } from "../trpc.js";
import { BotNotJoinedState, BotPermissionState, ErrorState, ForbiddenState, InlineError } from "./page-state.js";

const REAUTH_URL = "https://discord.com/oauth2/authorize?client_id=1";

function renderBot(options: { isManaged: boolean; reauthorizeUrl: string | null }): string {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  queryClient.setQueryData(trpc.guildSettings.listMyGuilds.queryOptions().queryKey, [
    { id: "g1", name: "サーバー", isManaged: options.isManaged, iconUrl: null, capabilities: 0 },
  ]);
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <BotPermissionState
        guildId="g1"
        permissions={["チャンネルを見る", "メッセージ履歴を読む"]}
        reauthorizeUrl={options.reauthorizeUrl}
      />
    </QueryClientProvider>,
  );
}

describe("ForbiddenState", () => {
  test("ページ名と必要な権限のラベルを文の途中に挟まず別の行で出す", () => {
    const html = renderToStaticMarkup(
      <ForbiddenState pageName="ログ" capabilities={["VIEW_LOGS", "VIEW_LOGS_RAW"]} />,
    );
    expect(html).toContain("このページを見る権限がありません");
    expect(html).toContain("ログを見るには次の権限が必要です。");
    expect(html).toContain("ログの閲覧");
    expect(html).toContain("ログの生データ閲覧");
    expect(html).toContain("サーバーの管理者に付与を依頼してください。");
    expect(html).toContain("whitespace-nowrap");
    expect(html).toContain("[text-wrap:balance]");
  });
});

describe("ErrorState", () => {
  test("対象名・文の区切りの改行・再読み込みボタンを出す", () => {
    const html = renderToStaticMarkup(<ErrorState subject="アクティビティ" onRetry={() => {}} />);
    expect(html).toContain("アクティビティを読み込めませんでした");
    expect(html).toContain("通信またはサーバーの一時的な問題の可能性があります。<br/>時間をおいて再度お試しください。");
    expect(html).toContain("再読み込み");
  });
});

describe("BotPermissionState", () => {
  test("サーバー管理者で再認可URLがあるときだけ再認可ボタンを出す", () => {
    const html = renderBot({ isManaged: true, reauthorizeUrl: REAUTH_URL });
    expect(html).toContain("Botの権限が足りません");
    expect(html).toContain("メッセージ履歴を読む");
    expect(html).toContain("Botを再認可する");
    expect(html).toContain(REAUTH_URL);
    expect(html).not.toContain("管理者に、Botへこれらの権限を付与するよう依頼してください。");
  });

  test("サーバー管理者でない閲覧者には再認可ボタンを出さず管理者への依頼を案内する", () => {
    const html = renderBot({ isManaged: false, reauthorizeUrl: REAUTH_URL });
    expect(html).not.toContain("Botを再認可する");
    expect(html).not.toContain(REAUTH_URL);
    expect(html).toContain("サーバーの管理者に、Botへこれらの権限を付与するよう依頼してください。");
  });

  test("再認可URLが無ければサーバー管理者でも依頼の案内にする", () => {
    const html = renderBot({ isManaged: true, reauthorizeUrl: null });
    expect(html).not.toContain("Botを再認可する");
    expect(html).toContain("依頼してください。");
  });
});

describe("BotNotJoinedState", () => {
  test("Bot未参加の見出しを出す", () => {
    expect(renderToStaticMarkup(<BotNotJoinedState />)).toContain("Botがこのサーバーに参加していません");
  });
});

describe("InlineError", () => {
  test("要約・補足・再読み込みを1行の帯で出す", () => {
    const html = renderToStaticMarkup(
      <InlineError summary="メンバー名を読み込めませんでした。" detail="一部の名前がIDで表示されています。" onRetry={() => {}} />,
    );
    expect(html).toContain("メンバー名を読み込めませんでした。");
    expect(html).toContain("一部の名前がIDで表示されています。");
    expect(html).toContain("再読み込み");
  });
});
