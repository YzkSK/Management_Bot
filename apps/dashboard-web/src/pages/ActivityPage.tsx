import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { useParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { API_URL, trpc } from "../trpc.js";
import { ActiveVoiceTab } from "./ActiveVoiceTab.js";
import {
  ACTIVITY_INVALIDATE_DELAY_MS,
  addToBucket,
  currentBucket,
  currentJstHour,
  liveVoiceSeconds,
  parseActivityNotification,
  sumLive,
} from "./activity-live.js";
import { buildGuildWsUrl } from "./log-notifications.js";
import { useGuildWs } from "./use-guild-ws.js";
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
import { Loading, Skeleton } from "@/components/ui/skeleton";

type MemberDetail = inferOutput<typeof trpc.activity.memberDetail>;
type RankingSort = "voice" | "messages";

// ログのカテゴリ色と揃える(発言=メッセージの青、VC=ボイスの紫、アクティブメンバー=メンバーの緑)。
const MESSAGE_COLOR = "#2563eb";
const VOICE_COLOR = "#9333ea";
const MEMBER_COLOR = "#16a34a";
const NUMBER_FORMAT = new Intl.NumberFormat("ja-JP");
const emptyPoint = (bucket: string) => ({ bucket, messageCount: 0, voiceSeconds: 0 });

/** 進行中のVC区間(userId → 秒)。DBの確定値に画面側で足す。 */
type LiveVoice = ReadonlyMap<string, number>;

function PeriodPicker({ value, onChange }: { value: ActivityPeriod; onChange: (value: ActivityPeriod) => void }) {
  return (
    <div role="group" aria-label="期間" className="bg-muted inline-flex gap-0.5 rounded-lg p-1">
      {ACTIVITY_PERIODS.map((period) => (
        <button
          key={period.value}
          type="button"
          aria-pressed={period.value === value}
          onClick={() => onChange(period.value)}
          className={cn(
            "h-8 rounded-md px-3 text-sm",
            period.value === value ? "bg-background font-medium shadow-xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: ReactNode; sub?: string; color?: string }) {
  return (
    <div className="bg-card flex flex-col gap-1 rounded-xl border p-4">
      <span className="text-muted-foreground flex items-center gap-2 text-xs">
        {color && <span className="size-2 rounded-sm" style={{ backgroundColor: color }} aria-hidden="true" />}
        {label}
      </span>
      <span className="text-2xl font-semibold">{value}</span>
      {sub && <span className="text-muted-foreground text-xs">{sub}</span>}
    </div>
  );
}

const VALUE_SKELETON = <Skeleton className="h-8 w-24" />;

/** 読み込み中のグラフ枠。見出しは出し、グラフ部分だけスケルトンにする。 */
function ChartSkeleton({ title, height = 220 }: { title: string; height?: number }) {
  return (
    <div className="bg-card flex flex-col gap-2 rounded-xl border p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <Skeleton style={{ height }} />
    </div>
  );
}

/** 発言数とVC時間(時間単位)の棒グラフ。数値の目盛りは共通にし、単位だけ「件 / h」と併記する。 */
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
        <YAxis
          tickLine={false}
          axisLine={false}
          fontSize={11}
          width={72}
          stroke="var(--muted-foreground)"
          tickFormatter={(value: number) => (value === 0 ? "0" : `${value}件 / ${value}h`)}
        />
        <Tooltip
          contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
          cursor={{ fill: "var(--accent)" }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="messages" name="発言数(件)" fill={MESSAGE_COLOR} radius={[3, 3, 0, 0]} />
        <Bar dataKey="voiceHours" name="VC時間(h)" fill={VOICE_COLOR} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function chartData(series: readonly ActivitySeriesPoint[], range: ActivityRange) {
  return fillSeries(series, range).map((p) => ({ ...p, label: formatBucketLabel(p.bucket, range.granularity) }));
}

function RankingTable({ guildId, range, now, live }: { guildId: string; range: ActivityRange; now: Date; live: LiveVoice }) {
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
        <Loading />
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
                  {/* ponytail: 並び順は取得時のまま(次のstats通知で取り直した時に並び直る)。 */}
                  <TableCell className="text-right">{formatDuration(row.voiceSeconds + (live.get(row.userId) ?? 0))}</TableCell>
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

function ServerStatsTab({ guildId, range, now, live }: { guildId: string; range: ActivityRange; now: Date; live: LiveVoice }) {
  const query = useQuery({ ...trpc.activity.serverSummary.queryOptions({ guildId, ...range }), placeholderData: keepPreviousData });
  const liveTotal = sumLive(live);

  return (
    <div className="flex flex-col gap-4">
      {query.isPending ? (
        <Loading className="gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="発言数" value={VALUE_SKELETON} color={MESSAGE_COLOR} />
            <StatCard label="VC時間" value={VALUE_SKELETON} color={VOICE_COLOR} />
            <StatCard label="アクティブメンバー" value={VALUE_SKELETON} sub="期間内に発言またはVC参加" color={MEMBER_COLOR} />
          </div>
          <ChartSkeleton title={range.granularity === "hour" ? "推移(時間別)" : "推移(日別)"} />
        </Loading>
      ) : query.isError ? (
        <p className="text-destructive text-sm">サーバー統計の取得に失敗しました。</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="発言数" value={NUMBER_FORMAT.format(query.data.totals.messageCount)} color={MESSAGE_COLOR} />
            <StatCard label="VC時間" value={formatDuration(query.data.totals.voiceSeconds + liveTotal)} color={VOICE_COLOR} />
            <StatCard
              label="アクティブメンバー"
              value={NUMBER_FORMAT.format(query.data.totals.activeMembers)}
              sub="期間内に発言またはVC参加"
              color={MEMBER_COLOR}
            />
          </div>
          <div className="bg-card flex flex-col gap-2 rounded-xl border p-4">
            <h3 className="text-sm font-semibold">{range.granularity === "hour" ? "推移(時間別)" : "推移(日別)"}</h3>
            <ActivityChart
              data={chartData(addToBucket(query.data.series, currentBucket(now, range.granularity), liveTotal, emptyPoint), range)}
            />
          </div>
        </>
      )}
      <RankingTable guildId={guildId} range={range} now={now} live={live} />
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

export function MemberDetailView({
  detail,
  range,
  now,
  liveSeconds,
}: {
  detail: MemberDetail;
  range: ActivityRange;
  now: Date;
  /** 進行中のVC区間の秒数(DBの確定値に足す)。VC計上中でなければundefined。 */
  liveSeconds?: number;
}) {
  const inVoice = liveSeconds !== undefined;
  liveSeconds ??= 0;
  const rankText = (rank: number | null) => (rank === null ? undefined : `サーバー内 ${rank}位`);
  const liveHour = currentJstHour(now);
  const byHour = detail.byHourOfDay.messageCount.map((messageCount, hour) => ({
    label: `${hour}時`,
    messageCount,
    voiceSeconds: (detail.byHourOfDay.voiceSeconds[hour] ?? 0) + (hour === liveHour ? liveSeconds : 0),
  }));
  const daily = addToBucket(detail.daily, currentBucket(now, "day"), liveSeconds, emptyPoint);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="発言数" value={NUMBER_FORMAT.format(detail.totals.messageCount)} sub={rankText(detail.rank.messages)} />
        <StatCard label="VC時間" value={formatDuration(detail.totals.voiceSeconds + liveSeconds)} sub={rankText(detail.rank.voice)} />
        <StatCard label="最終発言" value={formatRelative(detail.lastMessageAt, now)} />
        <StatCard label="最終VC参加" value={inVoice ? "VC中" : formatRelative(detail.lastVoiceAt, now)} />
      </div>
      <div className="bg-card flex flex-col gap-2 rounded-xl border p-4">
        <h3 className="text-sm font-semibold">時間帯別の活動</h3>
        <ActivityChart data={byHour} height={180} />
      </div>
      <div className="bg-card flex flex-col gap-2 rounded-xl border p-4">
        <h3 className="text-sm font-semibold">日別</h3>
        <ActivityChart data={chartData(daily, { ...range, granularity: "day" })} height={180} />
      </div>
    </div>
  );
}

function MemberTab({ guildId, range, now, live }: { guildId: string; range: ActivityRange; now: Date; live: LiveVoice }) {
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
        <Loading className="gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {["発言数", "VC時間", "最終発言", "最終VC参加"].map((label) => (
              <StatCard key={label} label={label} value={VALUE_SKELETON} />
            ))}
          </div>
          <ChartSkeleton title="時間帯別の活動" height={180} />
          <ChartSkeleton title="日別" height={180} />
        </Loading>
      ) : detailQuery.isError ? (
        <p className="text-destructive text-sm">メンバーのアクティビティの取得に失敗しました。</p>
      ) : (
        <MemberDetailView detail={detailQuery.data} range={range} now={now} liveSeconds={live.get(userId)} />
      )}
    </div>
  );
}

type ActivityTab = "server" | "member" | "voice";

function toTab(value: string): ActivityTab {
  return value === "member" || value === "voice" ? value : "server";
}

/**
 * botからの変更通知(/ws/activity)を受けて取り直す。連続する通知は間引き、接続・再接続時は取りこぼし対策で全て取り直す。
 * stats: 範囲の終端を現在時刻へ進める(クエリキーが変わり、新しい活動を含めて再取得される)。voice: アクティブVCを取り直す。
 */
function useActivityNotifications(guildId: string, enabled: boolean, advanceRange: () => void): void {
  const queryClient = useQueryClient();
  const pending = useRef<{ stats: boolean; voice: boolean; timer: ReturnType<typeof setTimeout> | null }>({
    stats: false,
    voice: false,
    timer: null,
  });

  useEffect(
    () => () => {
      if (pending.current.timer) clearTimeout(pending.current.timer);
    },
    [],
  );

  const schedule = (kind: "stats" | "voice" | "all") => {
    const p = pending.current;
    if (kind !== "voice") p.stats = true;
    if (kind !== "stats") p.voice = true;
    if (p.timer) return;
    p.timer = setTimeout(() => {
      if (p.stats) advanceRange();
      if (p.voice) void queryClient.invalidateQueries({ queryKey: trpc.activity.activeVoice.pathKey() });
      p.stats = false;
      p.voice = false;
      p.timer = null;
    }, ACTIVITY_INVALIDATE_DELAY_MS);
  };

  useGuildWs(
    enabled ? buildGuildWsUrl(API_URL, "activity", guildId) : "",
    (data) => {
      const kind = parseActivityNotification(data);
      if (kind) schedule(kind);
    },
    () => schedule("all"),
  );
}

/** `now` はテストで範囲(=クエリキー)と表示時刻を固定するためのもの(指定時は通知も購読しない)。 */
export function ActivityPage({ now: fixedNow }: { now?: Date } = {}) {
  const { guildId = "" } = useParams<{ guildId: string }>();
  const [tab, setTab] = useState<ActivityTab>("server");
  const [period, setPeriod] = useState<ActivityPeriod>("7d");
  // rangeNow: 集計範囲の終端(通知・期間変更で進める)。clock: 表示用の時計(進行中VC時間・相対時刻を毎秒描き直す)。
  const [rangeNow, setRangeNow] = useState(() => fixedNow ?? new Date());
  const [clock, setClock] = useState(() => fixedNow ?? new Date());
  const range = useMemo(() => toRange(period, rangeNow), [period, rangeNow]);

  useEffect(() => {
    if (fixedNow) return;
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, [fixedNow]);

  useActivityNotifications(guildId, !fixedNow, () => setRangeNow(new Date()));

  // 進行中のVC区間。ActiveVoiceTabと同じクエリキーなのでキャッシュを共有する。
  const activeVoice = useQuery(trpc.activity.activeVoice.queryOptions({ guildId }));
  const live = useMemo(() => liveVoiceSeconds(activeVoice.data ?? [], clock), [activeVoice.data, clock]);

  const changePeriod = (next: ActivityPeriod) => {
    setPeriod(next);
    if (!fixedNow) setRangeNow(new Date());
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">アクティビティモニター</h1>
      <Tabs value={tab} onValueChange={(value) => setTab(toTab(value))}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <TabsList aria-label="アクティビティモニター" className="grid w-full grid-cols-3 sm:inline-flex sm:w-fit">
            <TabsTrigger value="server">サーバー統計</TabsTrigger>
            <TabsTrigger value="member">メンバー</TabsTrigger>
            <TabsTrigger value="voice">アクティブVC</TabsTrigger>
          </TabsList>
          {tab !== "voice" && <PeriodPicker value={period} onChange={changePeriod} />}
        </div>
        <p className="text-muted-foreground text-xs">
          Botは除外し、ミュート中・AFKチャンネル滞在はVC時間に含みません。
        </p>
        <TabsContent value="server">
          <ServerStatsTab guildId={guildId} range={range} now={clock} live={live} />
        </TabsContent>
        <TabsContent value="member">
          <MemberTab guildId={guildId} range={range} now={clock} live={live} />
        </TabsContent>
        <TabsContent value="voice">
          <ActiveVoiceTab guildId={guildId} now={clock} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
