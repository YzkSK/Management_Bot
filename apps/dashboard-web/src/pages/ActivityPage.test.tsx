import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { trpc } from "../trpc.js";
import { ActiveVoiceView } from "./ActiveVoiceTab.js";
import { ActivityPage, MemberDetailView, RankingTable } from "./ActivityPage.js";
import { toRange } from "./activity-range.js";

const guildId = "g1";
const now = new Date("2026-09-29T12:00:00.000Z");

function renderPage(queryClient: QueryClient): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/guilds/${guildId}/activity`]}>
        <Routes>
          <Route path="/guilds/:guildId/activity" element={<ActivityPage now={now} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
}

function seedRanking(queryClient: QueryClient, rows: unknown[]): ReturnType<typeof toRange> {
  const range = toRange("7d", now);
  queryClient.setQueryData(
    trpc.activity.memberRanking.queryOptions({ guildId, from: range.from, to: range.to, sort: "voice", page: 0 }).queryKey,
    { rows, total: rows.length, pageSize: 20 },
  );
  return range;
}

function renderRanking(
  queryClient: QueryClient,
  range: ReturnType<typeof toRange>,
  selectedUserId = "",
  live: ReadonlyMap<string, number> = new Map(),
): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <RankingTable
        guildId={guildId}
        range={range}
        now={now}
        live={live}
        sort="voice"
        selectedUserId={selectedUserId}
        onSelect={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe("ActivityPage", () => {
  test("サーバー統計タブはアクティブメンバー→発言数→VC時間の順に合計カードを出し、ランキングは出さない(#505)", () => {
    const queryClient = newClient();
    const range = toRange("7d", now);
    queryClient.setQueryData(trpc.activity.serverSummary.queryOptions({ guildId, ...range }).queryKey, {
      totals: { messageCount: 1210, voiceSeconds: 57 * 3600, activeMembers: 43 },
      series: [{ bucket: "2026-09-28", messageCount: 100, voiceSeconds: 3600 }],
    });

    const html = renderPage(queryClient);

    expect(html).toContain("アクティビティモニター");
    expect(html).toContain("1,210");
    expect(html).toContain("57h 0m");
    expect(html).toContain("43");
    expect(html.indexOf("アクティブメンバー")).toBeLessThan(html.indexOf("発言数"));
    expect(html).not.toContain("メンバーランキング");
  });
});

describe("RankingTable", () => {
  test("ランキングを表示し、名前が解決できないメンバーはIDを出す", () => {
    const queryClient = newClient();
    const range = seedRanking(queryClient, [
      { userId: "u1", name: "メンバーA", messageCount: 312, voiceSeconds: 14 * 3600 + 20 * 60, lastActiveAt: "2026-09-29T11:00:00.000Z" },
      { userId: "u2", name: null, messageCount: 5, voiceSeconds: 0, lastActiveAt: null },
    ]);

    const html = renderRanking(queryClient, range);

    expect(html).toContain("メンバーランキング");
    expect(html).toContain("メンバーA");
    expect(html).toContain("14h 20m");
    expect(html).toContain("u2");
  });

  test("アバター画像の読み込みが終わるまではランキングを出さず読み込み中にする", () => {
    const queryClient = newClient();
    const range = seedRanking(queryClient, [
      { userId: "u1", name: "メンバーA", avatarUrl: "https://cdn.discordapp.com/avatars/1/a.png", messageCount: 1, voiceSeconds: 0, lastActiveAt: null },
    ]);

    const html = renderRanking(queryClient, range);

    expect(html).toContain("メンバーランキング");
    expect(html).not.toContain("メンバーA");
  });

  test("選択中のメンバーの行を強調する", () => {
    const queryClient = newClient();
    const range = seedRanking(queryClient, [
      { userId: "u1", name: "メンバーA", messageCount: 1, voiceSeconds: 0, lastActiveAt: null },
    ]);

    expect(renderRanking(queryClient, range, "u1")).toContain("bg-accent");
  });

  test("今VCで計上中のメンバーは最終活動の代わりにVC中と表示する", () => {
    const queryClient = newClient();
    const range = seedRanking(queryClient, [
      { userId: "u1", name: "メンバーA", messageCount: 0, voiceSeconds: 600, lastActiveAt: "2026-09-29T11:00:00.000Z" },
      { userId: "u2", name: "メンバーB", messageCount: 1, voiceSeconds: 0, lastActiveAt: "2026-09-29T11:00:00.000Z" },
    ]);

    const html = renderRanking(queryClient, range, "", new Map([["u1", 120]]));

    expect(html.match(/VC中/g)).toHaveLength(1);
    expect(html).toContain("12m");
  });

  test("期間内に活動が無ければ案内を表示する", () => {
    const queryClient = newClient();
    const range = seedRanking(queryClient, []);

    expect(renderRanking(queryClient, range)).toContain("この期間の活動はありません");
  });
});

describe("MemberDetailView", () => {
  test("合計・順位・最終活動を表示する", () => {
    const html = renderToStaticMarkup(
      <MemberDetailView
        now={now}
        detail={{
          totals: { messageCount: 312, voiceSeconds: 3600 },
          rank: { messages: 1, voice: null },
          byHourOfDay: { messageCount: Array.from({ length: 24 }, () => 0), voiceSeconds: Array.from({ length: 24 }, () => 0) },
          daily: [],
          lastMessageAt: "2026-09-29T11:00:00.000Z",
          lastVoiceAt: null,
        }}
        range={toRange("30d", now)}
      />,
    );
    expect(html).toContain("312");
    expect(html).toContain("サーバー内 1位");
    expect(html).toContain("1h 0m");
    expect(html).toContain("1時間前");
    expect(html).not.toContain("VC中");
  });

  test("進行中のVC秒を合計に加算し、最終VC参加はVC中と表示する", () => {
    const html = renderToStaticMarkup(
      <MemberDetailView
        now={now}
        liveSeconds={1800}
        detail={{
          totals: { messageCount: 0, voiceSeconds: 3600 },
          rank: { messages: null, voice: null },
          byHourOfDay: { messageCount: Array.from({ length: 24 }, () => 0), voiceSeconds: Array.from({ length: 24 }, () => 0) },
          daily: [],
          lastMessageAt: null,
          lastVoiceAt: null,
        }}
        range={toRange("30d", now)}
      />,
    );
    expect(html).toContain("1h 30m");
    expect(html).toContain("VC中");
  });
});

describe("ActiveVoiceView", () => {
  const member = {
    userId: "u1",
    name: "Alice",
    avatarUrl: null,
    selfMute: false,
    selfDeaf: false,
    serverMute: false,
    serverDeaf: false,
    streaming: true,
    video: false,
    counting: true,
    countingSince: null,
  };
  test("概要・チャンネルカード・継続時間・状態アイコンを表示する", () => {
    const html = renderToStaticMarkup(
      <ActiveVoiceView
        now={now}
        channels={[
          {
            channelId: "c1",
            channelName: "雑談VC",
            afk: false,
            startedAt: "2026-09-29T10:46:00.000Z",
            members: [member, { ...member, userId: "u2", name: "Bob", streaming: false, serverMute: true, counting: false }],
          },
          {
            channelId: "c2",
            channelName: "AFK",
            afk: true,
            startedAt: "2026-09-29T11:00:00.000Z",
            members: [{ ...member, userId: "u3", name: "Carol", streaming: false, counting: false }],
          },
        ]}
      />,
    );
    expect(html).toContain("VC <b");
    expect(html).toMatch(/VC <b[^>]*>2<\/b> チャンネル ・ 在室 <b[^>]*>3<\/b> 人/);
    expect(html).toContain("雑談VC");
    expect(html).toContain("1h 14m");
    expect(html).toContain('aria-label="画面共有中"');
    expect(html).toContain('aria-label="サーバーミュート"');
    expect(html).toContain("opacity-50");
    expect(html).not.toContain("集計対象外");
  });
  test("在室者がいなければ空状態", () => {
    expect(renderToStaticMarkup(<ActiveVoiceView now={now} channels={[]} />)).toContain("現在VCにいるメンバーはいません。");
  });
});
