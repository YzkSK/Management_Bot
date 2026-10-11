import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { Lock } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { trpc } from "../trpc.js";
import { describeChanges, type AuditNames } from "./audit-log-changes.js";
import { auditActionLabel, auditFeatureLabel, auditOutcomeLabel, periodToRange } from "./audit-log-labels.js";
import { formatTime, groupByDay } from "./day-groups.js";
import { AuditLogFilter, EMPTY_AUDIT_FILTER, type AuditFilterValue } from "./AuditLogFilter.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InitialAvatar } from "@/components/initial-avatar";
import { Loading } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

const OUTCOME_TONES: Record<string, string> = {
  success: "bg-success/10 text-success",
  failure: "bg-destructive/10 text-destructive",
  denied: "bg-warning/10 text-warning",
  pending: "bg-muted text-muted-foreground",
};

/** 失敗・権限不足の行の左端に出す色の線。 */
const OUTCOME_RAILS: Record<string, string> = { failure: "bg-destructive", denied: "bg-warning" };

const OUTCOME_NOTES: Record<string, string> = {
  denied: "この操作を行う権限がありませんでした",
  pending: "結果を記録できませんでした。変更が反映されたか設定画面で確認してください",
};

interface AuditRowData {
  id: string;
  kind: string;
  createdAt: string;
  actorId: string | null;
  actorName: string;
  feature: string;
  action: string;
  outcome: string;
  before?: unknown;
  after?: unknown;
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground mb-1 text-xs">{label}</p>
      <pre className="bg-card max-h-64 overflow-auto rounded-md border p-2 text-xs whitespace-pre-wrap break-all">
        {value === null || value === undefined ? "(なし)" : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function AuditRow({ row, names }: { row: AuditRowData; names: AuditNames }) {
  const actor = row.actorId === null ? "Bot(自動)" : row.actorName;
  const time = (
    <time dateTime={row.createdAt} className="text-muted-foreground text-xs tabular-nums">
      {formatTime(row.createdAt)}
    </time>
  );

  if (row.kind === "access") {
    return (
      <div className="bg-muted/40 text-muted-foreground grid grid-cols-1 items-baseline gap-x-3 border-t px-4 py-1.5 text-xs first:border-t-0 sm:grid-cols-[3rem_minmax(0,1fr)]">
        {time}
        <span className="min-w-0 break-words">{actor} が管理画面を開きました</span>
      </div>
    );
  }

  const changes = describeChanges(row.feature, row.action, row.before, row.after, names);
  const note = OUTCOME_NOTES[row.outcome];
  const rail = OUTCOME_RAILS[row.outcome];
  return (
    <div className="relative grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 border-t px-4 py-3 first:border-t-0 sm:grid-cols-[3rem_2rem_minmax(0,1fr)_auto]">
      {rail && <span className={cn("absolute inset-y-0 left-0 w-[3px]", rail)} aria-hidden="true" />}
      <div className="col-start-2 row-start-1 sm:col-start-1 sm:pt-1.5">{time}</div>
      <InitialAvatar name={actor} className="col-start-1 row-span-3 row-start-1 sm:col-start-2 sm:row-span-1" />
      <div className="col-start-2 row-start-2 min-w-0 sm:col-start-3 sm:row-start-1">
        <p className="text-sm break-words">
          <span className="text-muted-foreground mr-1.5 inline-block rounded border px-1.5 align-[1px] text-[11px]">
            {auditFeatureLabel(row.feature)}
          </span>
          <b className="font-semibold">{actor}</b> が {auditActionLabel(row.feature, row.action)}
        </p>
        {note && <p className="text-muted-foreground mt-1.5 text-[13px]">{note}</p>}
        {changes.length > 0 && (
          <dl className="bg-muted/30 mt-2 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-[13px]">
            {changes.map((change) => (
              <div key={change.label} className="contents">
                <dt className="text-muted-foreground">{change.label}</dt>
                <dd className="break-words [overflow-wrap:anywhere]">
                  {change.before !== undefined && (
                    <>
                      <del className="text-muted-foreground">{change.before}</del>
                      <span className="text-muted-foreground mx-1.5" aria-hidden="true">
                        →
                      </span>
                    </>
                  )}
                  <ins className="font-semibold no-underline">{change.after}</ins>
                </dd>
              </div>
            ))}
          </dl>
        )}
        {((row.before ?? null) !== null || (row.after ?? null) !== null) && (
          <details className="text-muted-foreground mt-1.5 text-xs">
            <summary className="w-fit cursor-pointer">詳細データ</summary>
            <div className="mt-1.5 grid gap-2 md:grid-cols-2">
              <JsonBlock label="変更前" value={row.before} />
              <JsonBlock label="変更後(送信内容)" value={row.after} />
            </div>
          </details>
        )}
      </div>
      <span
        className={cn(
          "col-start-2 row-start-3 mt-1 inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-0.5 text-xs whitespace-nowrap sm:col-start-4 sm:row-start-1",
          OUTCOME_TONES[row.outcome] ?? OUTCOME_TONES.pending,
        )}
      >
        <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
        {auditOutcomeLabel(row.outcome)}
      </span>
    </div>
  );
}

export function AuditLogPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<AuditFilterValue>(EMPTY_AUDIT_FILTER);

  const optionsQuery = useQuery({
    ...trpc.auditLog.listFilterOptions.queryOptions({ guildId: guildId ?? "" }),
    enabled: Boolean(guildId),
  });
  const { from, to } = periodToRange(filter.period, filter.fromDate, filter.toDate);
  const baseInput = {
    guildId: guildId ?? "",
    actorId: filter.actorId === "" ? undefined : filter.actorId,
    feature: filter.feature === "" ? undefined : filter.feature,
    from,
    to,
    hideAccess: filter.hideAccess,
    onlyIssues: filter.onlyIssues,
    limit: PAGE_SIZE,
  };
  // offset方式のまま「さらに読み込む」で続きを足していく。
  const listQuery = useInfiniteQuery({
    queryKey: ["auditLog", "list", "infinite", baseInput],
    enabled: Boolean(guildId),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      queryClient.fetchQuery({ ...trpc.auditLog.list.queryOptions({ ...baseInput, offset: pageParam }), staleTime: 0 }),
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.entries.length, 0);
      return loaded < lastPage.totalCount ? loaded : undefined;
    },
  });

  if (!guildId) {
    return (
      <Alert variant="destructive">
        <AlertDescription>サーバーが指定されていません。</AlertDescription>
      </Alert>
    );
  }

  const isForbidden = listQuery.error instanceof TRPCClientError && listQuery.error.data?.code === "FORBIDDEN";
  const entries = listQuery.data?.pages.flatMap((page) => page.entries) ?? [];
  const names = (listQuery.data?.pages ?? []).reduce<Record<string, string>>((acc, page) => ({ ...acc, ...page.names }), {});
  const groups = groupByDay(entries, (entry) => entry.createdAt);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">操作履歴</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          ダッシュボードで誰がいつ何を変更したかを確認できます。記録は1年間保存されます。
        </p>
      </div>

      <AuditLogFilter
        value={filter}
        onChange={setFilter}
        actors={optionsQuery.data?.actors ?? []}
        features={optionsQuery.data?.features ?? []}
      />

      {listQuery.isPending && !listQuery.isError && <Loading />}
      {isForbidden && (
        <Alert variant="warning">
          <Lock />
          <AlertDescription>
            この操作を行う権限がありません。操作履歴の閲覧には「操作履歴の閲覧」権限が必要です。
          </AlertDescription>
        </Alert>
      )}
      {listQuery.isError && !isForbidden && (
        <Alert variant="destructive">
          <AlertDescription>操作履歴の取得に失敗しました。時間をおいて再度お試しください。</AlertDescription>
        </Alert>
      )}

      {listQuery.data && (
        <>
          {entries.length === 0 ? (
            <p className="text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
              条件に合う履歴はありません。
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {groups.map((group) => (
                <section key={group.key} className="flex flex-col gap-2">
                  <h2 className="flex items-center gap-2.5 text-[13px] font-semibold after:h-px after:flex-1 after:bg-border">
                    {group.relative}
                    <small className={cn("font-normal", group.relative ? "text-muted-foreground" : "text-foreground font-semibold")}>
                      {group.date}
                    </small>
                  </h2>
                  <div className="bg-card overflow-hidden rounded-xl border">
                    {group.items.map((row) => (
                      <AuditRow key={row.id} row={row} names={names} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
          {listQuery.hasNextPage && (
            <div className="flex justify-center">
              <Button type="button" variant="outline" disabled={listQuery.isFetchingNextPage} onClick={() => void listQuery.fetchNextPage()}>
                {listQuery.isFetchingNextPage ? "読み込み中..." : "さらに読み込む"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
