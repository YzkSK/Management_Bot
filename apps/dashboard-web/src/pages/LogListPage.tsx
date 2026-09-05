import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { LogCategory } from "@management-bot/shared";
import { trpc } from "../trpc.js";
import { CATEGORY_OPTIONS, CATEGORY_LABELS } from "./category-labels.js";
import { formatCreatedAt } from "./format-created-at.js";
import { summarizeLogEntry } from "./log-entry-summary.js";
import { INITIAL_PAGINATION, currentCursor, goNextPage, goPrevPage } from "./pagination.js";
import { useLogEntryNotifications } from "./use-log-entry-notifications.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const PAGE_SIZE = 50;
const ALL_CATEGORIES = "__all__";

const CONNECTION_STATUS_LABELS = {
  connecting: "リアルタイム更新: 接続中...",
  open: "リアルタイム更新: 有効",
  reconnecting: "リアルタイム更新: 切断中(再接続を試みています)",
  stopped: "リアルタイム更新: 停止しました(画面を再読み込みしてください)",
} as const;

/** 短時間に連続した通知をまとめて1回のrefetchにし、高頻度ログでの過剰な再取得を避ける。 */
const INVALIDATE_DEBOUNCE_MS = 300;

export function LogListPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const [category, setCategory] = useState<LogCategory | "">("");
  const [pagination, setPagination] = useState(INITIAL_PAGINATION);
  const queryClient = useQueryClient();

  const logsQuery = useQuery({
    ...trpc.logging.listLogEntries.queryOptions({
      guildId: guildId ?? "",
      category: category === "" ? undefined : category,
      limit: PAGE_SIZE,
      cursor: currentCursor(pagination),
    }),
    enabled: Boolean(guildId),
  });

  const invalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectionStatus = useLogEntryNotifications(guildId ?? "", (notifiedCategory) => {
    // 過去ページを閲覧中は表示中の内容を壊さないよう、最新ページ(先頭)表示中のみ自動更新する。
    if (pagination.pageIndex !== 0) return;
    if (category !== "" && category !== notifiedCategory) return;
    if (invalidateTimerRef.current) return; // 連続通知は1回のrefetchにまとめる
    invalidateTimerRef.current = setTimeout(() => {
      invalidateTimerRef.current = null;
      void queryClient.invalidateQueries({
        queryKey: trpc.logging.listLogEntries.queryOptions({
          guildId: guildId ?? "",
          category: category === "" ? undefined : category,
          limit: PAGE_SIZE,
          cursor: undefined,
        }).queryKey,
      });
    }, INVALIDATE_DEBOUNCE_MS);
  });

  if (!guildId) {
    return (
      <Alert variant="destructive">
        <AlertDescription>サーバーが指定されていません。</AlertDescription>
      </Alert>
    );
  }

  const isForbidden = logsQuery.error instanceof TRPCClientError && logsQuery.error.data?.code === "FORBIDDEN";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">ログ一覧</h1>
        <Button asChild variant="outline">
          <Link to={`/guilds/${guildId}/logs/settings`}>設定</Link>
        </Button>
      </div>

      <p
        className={
          connectionStatus === "open" ? "text-muted-foreground text-xs" : "text-destructive text-xs"
        }
      >
        {CONNECTION_STATUS_LABELS[connectionStatus]}
      </p>

      <Select
        value={category === "" ? ALL_CATEGORIES : category}
        onValueChange={(value) => {
          setCategory(value === ALL_CATEGORIES ? "" : (value as LogCategory));
          setPagination(INITIAL_PAGINATION);
        }}
      >
        <SelectTrigger className="w-48" aria-label="ログのカテゴリ">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_CATEGORIES}>すべて</SelectItem>
          {CATEGORY_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {logsQuery.isPending && <div className="text-sm">読み込み中...</div>}
      {isForbidden && (
        <Alert variant="destructive">
          <AlertDescription>この操作を行う権限がありません。</AlertDescription>
        </Alert>
      )}
      {logsQuery.isError && !isForbidden && (
        <Alert variant="destructive">
          <AlertDescription>ログの取得に失敗しました。時間をおいて再度お試しください。</AlertDescription>
        </Alert>
      )}

      {logsQuery.data && (
        <>
          {logsQuery.data.entries.length === 0 ? (
            <p className="text-muted-foreground text-sm">該当するログはありません。</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日時</TableHead>
                  <TableHead>カテゴリ</TableHead>
                  <TableHead>アクション</TableHead>
                  <TableHead>実行者</TableHead>
                  <TableHead>詳細</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logsQuery.data.entries.map(({ id, entry }) => {
                  const summary = summarizeLogEntry(entry);
                  return (
                    <TableRow key={id}>
                      <TableCell>
                        <time dateTime={summary.createdAt}>{formatCreatedAt(summary.createdAt)}</time>
                      </TableCell>
                      <TableCell>{CATEGORY_LABELS[entry.category]}</TableCell>
                      <TableCell>{summary.action ?? "-"}</TableCell>
                      <TableCell>{summary.executorId ?? "-"}</TableCell>
                      <TableCell>
                        {summary.content && <p className="mb-1 max-w-md text-sm whitespace-pre-wrap">{summary.content}</p>}
                        {Object.keys(summary.details).length > 0 && (
                          <details>
                            <summary className="text-muted-foreground cursor-pointer text-xs">詳細</summary>
                            <pre className="text-muted-foreground mt-1 text-xs">{JSON.stringify(summary.details, null, 2)}</pre>
                          </details>
                        )}
                        {!summary.content && Object.keys(summary.details).length === 0 && "-"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pagination.pageIndex === 0}
              onClick={() => setPagination(goPrevPage(pagination))}
            >
              前へ
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={logsQuery.data.nextCursor === null}
              onClick={() => setPagination(goNextPage(pagination, logsQuery.data.nextCursor))}
            >
              次へ
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
