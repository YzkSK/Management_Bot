import { useQuery } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { trpc } from "../trpc.js";
import { auditFeatureLabel, auditOutcomeLabel, dateInputToIso } from "./audit-log-labels.js";
import { formatCreatedAt } from "./format-created-at.js";
import { visiblePages } from "./pagination.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loading } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;
/** Radix Selectは空文字をvalueにできないため、「絞り込まない」を表す値。 */
const ALL = "__all__";

const OUTCOME_TONES: Record<string, string> = {
  success: "bg-success/10 text-success",
  failure: "bg-destructive/10 text-destructive",
  denied: "bg-warning/10 text-warning",
  pending: "bg-muted text-muted-foreground",
};

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

export function AuditLogPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const [actorId, setActorId] = useState(ALL);
  const [feature, setFeature] = useState(ALL);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [hideAccess, setHideAccess] = useState(false);
  const [page, setPage] = useState(0);

  const optionsQuery = useQuery({
    ...trpc.auditLog.listFilterOptions.queryOptions({ guildId: guildId ?? "" }),
    enabled: Boolean(guildId),
  });
  const listQuery = useQuery({
    ...trpc.auditLog.list.queryOptions({
      guildId: guildId ?? "",
      actorId: actorId === ALL ? undefined : actorId,
      feature: feature === ALL ? undefined : feature,
      from: dateInputToIso(fromDate, false),
      to: dateInputToIso(toDate, true),
      hideAccess,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    enabled: Boolean(guildId),
  });

  const totalPages = Math.ceil((listQuery.data?.totalCount ?? 0) / PAGE_SIZE);
  useEffect(() => {
    if (listQuery.data && page > 0 && page >= totalPages) setPage(Math.max(totalPages - 1, 0));
  }, [listQuery.data, page, totalPages]);

  if (!guildId) {
    return (
      <Alert variant="destructive">
        <AlertDescription>サーバーが指定されていません。</AlertDescription>
      </Alert>
    );
  }

  const isForbidden = listQuery.error instanceof TRPCClientError && listQuery.error.data?.code === "FORBIDDEN";
  const changeFilter = (apply: () => void) => {
    apply();
    setPage(0);
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">操作履歴</h1>

      <div className="bg-card flex flex-wrap items-end gap-3 rounded-xl border p-3">
        <label className="flex flex-col gap-1 text-xs">
          操作者
          <Select value={actorId} onValueChange={(v) => changeFilter(() => setActorId(v))}>
            <SelectTrigger className="w-48" aria-label="操作者">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>すべて</SelectItem>
              {(optionsQuery.data?.actors ?? []).map((actor) => (
                <SelectItem key={actor.id} value={actor.id}>
                  {actor.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          機能
          <Select value={feature} onValueChange={(v) => changeFilter(() => setFeature(v))}>
            <SelectTrigger className="w-48" aria-label="機能">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>すべて</SelectItem>
              {(optionsQuery.data?.features ?? []).map((f) => (
                <SelectItem key={f} value={f}>
                  {auditFeatureLabel(f)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          開始日
          <Input
            type="date"
            className="w-40"
            value={fromDate}
            onChange={(e) => changeFilter(() => setFromDate(e.target.value))}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          終了日
          <Input
            type="date"
            className="w-40"
            value={toDate}
            onChange={(e) => changeFilter(() => setToDate(e.target.value))}
          />
        </label>
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={hideAccess}
            onChange={(e) => changeFilter(() => setHideAccess(e.target.checked))}
          />
          アクセス履歴を隠す
        </label>
      </div>

      {listQuery.isPending && <Loading />}
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
          {listQuery.data.entries.length === 0 ? (
            <p className="text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
              該当する履歴はありません。
            </p>
          ) : (
            <div className="bg-card flex flex-col overflow-hidden rounded-xl border">
              {listQuery.data.entries.map((row) => {
                const isAccess = row.kind === "access";
                return (
                  <div
                    key={row.id}
                    className={cn("border-t px-3 py-2.5 first:border-t-0 sm:px-4", isAccess && "text-muted-foreground text-xs opacity-70")}
                  >
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <time dateTime={row.createdAt} className="text-muted-foreground w-40 shrink-0 text-xs">
                        {formatCreatedAt(row.createdAt)}
                      </time>
                      <span className={cn("w-40 shrink-0 truncate", !isAccess && "text-sm font-medium")}>
                        {row.actorId === null ? "Bot(自動)" : row.actorName}
                      </span>
                      <span className={cn("shrink-0", !isAccess && "text-sm")}>{auditFeatureLabel(row.feature)}</span>
                      <span className={cn("min-w-0 flex-1 break-all", !isAccess && "text-sm")}>
                        {isAccess ? "管理画面を開いた" : row.action}
                      </span>
                      {!isAccess && (
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2.5 py-0.5 text-xs",
                            OUTCOME_TONES[row.outcome] ?? OUTCOME_TONES.pending,
                          )}
                        >
                          {auditOutcomeLabel(row.outcome)}
                        </span>
                      )}
                    </div>
                    {!isAccess && (row.before !== null || row.after !== null) && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs">変更前 / 変更後</summary>
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          <JsonBlock label="変更前" value={row.before} />
                          <JsonBlock label="変更後(送信内容)" value={row.after} />
                        </div>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {totalPages > 1 && (
            <nav aria-label="ページ" className="flex justify-center gap-2">
              <Button type="button" variant="outline" size="icon" aria-label="前のページ" disabled={page === 0} onClick={() => setPage(page - 1)}>
                <ChevronLeft />
              </Button>
              {visiblePages(page, totalPages).map((p) => (
                <Button
                  key={p}
                  type="button"
                  variant={p === page ? "default" : "outline"}
                  size="icon"
                  aria-current={p === page ? "page" : undefined}
                  onClick={() => setPage(p)}
                >
                  {p + 1}
                </Button>
              ))}
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="次のページ"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight />
              </Button>
            </nav>
          )}
          <p className="text-muted-foreground text-center text-sm">
            {page + 1} / {Math.max(totalPages, 1)} ページ(全{listQuery.data.totalCount}件)
          </p>
        </>
      )}
    </div>
  );
}
