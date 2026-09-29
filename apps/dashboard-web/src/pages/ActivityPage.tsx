import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { useParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { trpc } from "../trpc.js";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  ACTIVITY_PERIODS,
  type ActivityPeriod,
  type ActivityRange,
  type ActivitySeriesPoint,
  fillSeries,
  formatBucketLabel,
  formatDuration,
  formatRelative,
  toRange,
} from "./activity-range.js";

type MemberDetail = inferOutput<typeof trpc.activity.memberDetail>;
type RankingSort = "voice" | "messages";

// ライト/ダーク両テーマで判別できるよう、色相だけでなく明度も離した2色(発言=青、VC=オレンジ)。
const MESSAGE_COLOR = "#2563eb";
const VOICE_COLOR = "#f59e0b";
const NUMBER_FORMAT = new Intl.NumberFormat("ja-JP");
/** 集計範囲の終端(現在時刻)を進めて再取得する間隔。botの書き込み間隔(10秒)に合わせる。 */
export const ACTIVITY_REFRESH_MS = 10_000;

function PeriodPicker({ value, onChange }: { value: ActivityPeriod; onChange: (value: ActivityPeriod) => void }) {
  return (
    <div role="group" aria-label="期間" className="inline-flex overflow-hidden rounded-md border">
      {ACTIVITY_PERIODS.map((period) => (
        <button
          key={period.value}
          type="button"
          aria-pressed={period.value === value}
          onClick={() => onChange(period.value)}
          className={cn(
            "border-l px-3 py-1.5 text-sm first:border-l-0",
            period.value === value ? "bg-primary text-primary-foreground" : "hover:bg-accent",
          )}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-4">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-2xl font-semibold">{value}</span>
      {sub && <span className="text-muted-foreground text-xs">{sub}</span>}
    </div>
  );
}

/** 発言数(左軸)とVC時間(右軸、時間単位)の棒グラフ。 */
function ActivityChart({
  data,
  height = 220,
}: {
  data: readonly { label: string; messageCount: number; voiceSeconds: number }[];
  height?: number;
}) {
  const rows = data.map((d) => ({ label: d.label, messages: d.messageCount, voiceHours: Math.round((d.voiceSeconds / 3600) * 10) / 10 }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} stroke="var(--muted-foreground)" />
        <YAxis yAxisId="messages" tickLine={false} axisLine={false} fontSize={12} width={40} stroke="var(--muted-foreground)" />
        <YAxis yAxisId="voice" orientation="right" tickLine={false} axisLine={false} fontSize={12} width={40} stroke="var(--muted-foreground)" />
        <Tooltip
          contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
          cursor={{ fill: "var(--accent)" }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar yAxisId="messages" dataKey="messages" name="発言数" fill={MESSAGE_COLOR} radius={[3, 3, 0, 0]} />
        <Bar yAxisId="voice" dataKey="voiceHours" name="VC時間(h)" fill={VOICE_COLOR} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function chartData(series: readonly ActivitySeriesPoint[], range: ActivityRange) {
  return fillSeries(series, range).map((p) => ({ ...p, label: formatBucketLabel(p.bucket, range.granularity) }));
}

function RankingTable({ guildId, range, now }: { guildId: string; range: ActivityRange; now: Date }) {
  const [sort, setSort] = useState<RankingSort>("voice");
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [guildId, range.from, sort]);

  const query = useQuery({
    ...trpc.activity.memberRanking.queryOptions({ guildId, from: range.from, to: range.to, sort, page }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold">メンバーランキング</h3>
        <Select value={sort} onValueChange={(value) => setSort(value === "messages" ? "messages" : "voice")}>
          <SelectTrigger className="w-40" aria-label="並び替え">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="voice">VC時間順</SelectItem>
            <SelectItem value="messages">発言数順</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {query.isPending ? (
        <p className="p-4 text-sm">読み込み中...</p>
      ) : query.isError ? (
        <p className="text-destructive p-4 text-sm">ランキングの取得に失敗しました。</p>
      ) : query.data.rows.length === 0 ? (
        <p className="text-muted-foreground p-8 text-center text-sm">この期間の活動はありません。</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>メンバー</TableHead>
                <TableHead className="text-right">発言数</TableHead>
                <TableHead className="text-right">VC時間</TableHead>
                <TableHead className="text-right">最終活動</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.rows.map((row, index) => (
                <TableRow key={row.userId}>
                  <TableCell className="text-muted-foreground">{page * query.data.pageSize + index + 1}</TableCell>
                  <TableCell>{row.name ?? row.userId}</TableCell>
                  <TableCell className="text-right">{NUMBER_FORMAT.format(row.messageCount)}</TableCell>
                  <TableCell className="text-right">{formatDuration(row.voiceSeconds)}</TableCell>
                  <TableCell className="text-muted-foreground text-right">{formatRelative(row.lastActiveAt, now)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {query.data.total > query.data.pageSize && (
            <div className="flex items-center justify-end gap-2 border-t px-4 py-2">
              <Button type="button" variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                前へ
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={(page + 1) * query.data.pageSize >= query.data.total}
                onClick={() => setPage(page + 1)}
              >
                次へ
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ServerStatsTab({ guildId, range, now }: { guildId: string; range: ActivityRange; now: Date }) {
  const query = useQuery({ ...trpc.activity.serverSummary.queryOptions({ guildId, ...range }), placeholderData: keepPreviousData });

  return (
    <div className="flex flex-col gap-4">
      {query.isPending ? (
        <p className="text-sm">読み込み中...</p>
      ) : query.isError ? (
        <p className="text-destructive text-sm">サーバー統計の取得に失敗しました。</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="発言数" value={NUMBER_FORMAT.format(query.data.totals.messageCount)} />
            <StatCard label="VC時間" value={formatDuration(query.data.totals.voiceSeconds)} />
            <StatCard
              label="アクティブメンバー"
              value={NUMBER_FORMAT.format(query.data.totals.activeMembers)}
              sub="期間内に発言またはVC参加"
            />
          </div>
          <div className="flex flex-col gap-2 rounded-lg border p-4">
            <h3 className="text-sm font-semibold">{range.granularity === "hour" ? "推移(時間別)" : "推移(日別)"}</h3>
            <ActivityChart data={chartData(query.data.series, range)} />
          </div>
        </>
      )}
      <RankingTable guildId={guildId} range={range} now={now} />
    </div>
  );
}

const FIRST_PAGE_KEY = "__first__";

/** ModerationPageのuseMemberOptionsと同様、ページング結果をカーソル単位で保持する。 */
function useMemberOptions(guildId: string) {
  const [after, setAfter] = useState<string | undefined>(undefined);
  const [pages, setPages] = useState<Record<string, readonly { id: string; name: string }[]>>({});

  useEffect(() => {
    setAfter(undefined);
    setPages({});
  }, [guildId]);

  const query = useQuery(trpc.activity.listMemberOptions.queryOptions({ guildId, after }));

  useEffect(() => {
    if (!query.data) return;
    const pageKey = after ?? FIRST_PAGE_KEY;
    setPages((prev) => ({ ...prev, [pageKey]: query.data.members }));
  }, [after, query.data]);

  return {
    options: Object.values(pages).flat(),
    isPending: query.isPending && Object.keys(pages).length === 0,
    isError: query.isError,
    nextAfter: query.data?.nextAfter,
    isFetchingNextPage: query.isFetching,
    loadNextPage: () => setAfter(query.data?.nextAfter),
  };
}

export function MemberDetailView({ detail, range, now }: { detail: MemberDetail; range: ActivityRange; now: Date }) {
  const rankText = (rank: number | null) => (rank === null ? undefined : `サーバー内 ${rank}位`);
  const byHour = detail.byHourOfDay.messageCount.map((messageCount, hour) => ({
    label: `${hour}時`,
    messageCount,
    voiceSeconds: detail.byHourOfDay.voiceSeconds[hour] ?? 0,
  }));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="発言数" value={NUMBER_FORMAT.format(detail.totals.messageCount)} sub={rankText(detail.rank.messages)} />
        <StatCard label="VC時間" value={formatDuration(detail.totals.voiceSeconds)} sub={rankText(detail.rank.voice)} />
        <StatCard label="最終発言" value={formatRelative(detail.lastMessageAt, now)} />
        <StatCard label="最終VC参加" value={formatRelative(detail.lastVoiceAt, now)} />
      </div>
      <div className="flex flex-col gap-2 rounded-lg border p-4">
        <h3 className="text-sm font-semibold">時間帯別の活動</h3>
        <ActivityChart data={byHour} height={180} />
      </div>
      <div className="flex flex-col gap-2 rounded-lg border p-4">
        <h3 className="text-sm font-semibold">日別</h3>
        <ActivityChart data={chartData(detail.daily, { ...range, granularity: "day" })} height={180} />
      </div>
    </div>
  );
}

function MemberTab({ guildId, range, now }: { guildId: string; range: ActivityRange; now: Date }) {
  const [userId, setUserId] = useState("");
  const memberOptions = useMemberOptions(guildId);
  const detailQuery = useQuery({
    ...trpc.activity.memberDetail.queryOptions({ guildId, userId, from: range.from, to: range.to }),
    enabled: userId !== "",
    placeholderData: keepPreviousData,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={userId} onValueChange={setUserId} disabled={memberOptions.isPending || memberOptions.isError}>
          <SelectTrigger className="w-64" aria-label="メンバーを選択">
            <SelectValue placeholder="メンバーを選択" />
          </SelectTrigger>
          <SelectContent>
            {memberOptions.options.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {memberOptions.nextAfter && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={memberOptions.isFetchingNextPage}
            onClick={memberOptions.loadNextPage}
          >
            さらに読み込む
          </Button>
        )}
      </div>
      {memberOptions.isError && <p className="text-destructive text-sm">メンバー候補の取得に失敗しました。</p>}
      {userId === "" ? (
        <p className="text-muted-foreground rounded-md border p-8 text-center text-sm">メンバーを選択してください。</p>
      ) : detailQuery.isPending ? (
        <p className="text-sm">読み込み中...</p>
      ) : detailQuery.isError ? (
        <p className="text-destructive text-sm">メンバーのアクティビティの取得に失敗しました。</p>
      ) : (
        <MemberDetailView detail={detailQuery.data} range={range} now={now} />
      )}
    </div>
  );
}

type ActivityTab = "server" | "member";

/** `now` はテストで範囲(=クエリキー)を固定するためのもの。通常はマウント時刻を使い、期間切り替え時に更新する。 */
export function ActivityPage({ now: fixedNow }: { now?: Date } = {}) {
  const { guildId = "" } = useParams<{ guildId: string }>();
  const [tab, setTab] = useState<ActivityTab>("server");
  const [period, setPeriod] = useState<ActivityPeriod>("7d");
  const [now, setNow] = useState(() => fixedNow ?? new Date());
  const range = useMemo(() => toRange(period, now), [period, now]);

  // 範囲の終端を現在時刻へ進め続けることで、開いたままでも新しい活動が反映される(クエリキーが変わり再取得される)。
  useEffect(() => {
    if (fixedNow) return;
    const timer = setInterval(() => setNow(new Date()), ACTIVITY_REFRESH_MS);
    return () => clearInterval(timer);
  }, [fixedNow]);

  const changePeriod = (next: ActivityPeriod) => {
    setPeriod(next);
    if (!fixedNow) setNow(new Date());
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">アクティビティモニター</h1>
      <Tabs value={tab} onValueChange={(value) => setTab(value === "member" ? "member" : "server")}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <TabsList aria-label="アクティビティモニター">
            <TabsTrigger value="server">サーバー統計</TabsTrigger>
            <TabsTrigger value="member">メンバー</TabsTrigger>
          </TabsList>
          <PeriodPicker value={period} onChange={changePeriod} />
        </div>
        <p className="text-muted-foreground text-xs">
          Botは除外し、ミュート中・AFKチャンネル滞在はVC時間に含みません。
        </p>
        <TabsContent value="server">
          <ServerStatsTab guildId={guildId} range={range} now={now} />
        </TabsContent>
        <TabsContent value="member">
          <MemberTab guildId={guildId} range={range} now={now} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
