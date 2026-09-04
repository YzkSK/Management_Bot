import { useQuery } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useState } from "react";
import { useParams } from "react-router-dom";
import type { LogCategory } from "@management-bot/shared";
import { trpc } from "../trpc.js";
import { CATEGORY_OPTIONS, CATEGORY_LABELS } from "./category-labels.js";
import { formatCreatedAt } from "./format-created-at.js";
import { summarizeLogEntry } from "./log-entry-summary.js";
import { INITIAL_PAGINATION, currentCursor, goNextPage, goPrevPage } from "./pagination.js";

const PAGE_SIZE = 50;

export function LogListPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const [category, setCategory] = useState<LogCategory | "">("");
  const [pagination, setPagination] = useState(INITIAL_PAGINATION);

  const logsQuery = useQuery({
    ...trpc.logging.listLogEntries.queryOptions({
      guildId: guildId ?? "",
      category: category === "" ? undefined : category,
      limit: PAGE_SIZE,
      cursor: currentCursor(pagination),
    }),
    enabled: Boolean(guildId),
  });

  if (!guildId) {
    return <div role="alert">サーバーが指定されていません。</div>;
  }

  const isForbidden = logsQuery.error instanceof TRPCClientError && logsQuery.error.data?.code === "FORBIDDEN";

  return (
    <div>
      <h1>ログ一覧</h1>
      <label>
        カテゴリ:
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value as LogCategory | "");
            setPagination(INITIAL_PAGINATION);
          }}
        >
          <option value="">すべて</option>
          {CATEGORY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {logsQuery.isPending && <div>読み込み中...</div>}
      {isForbidden && <div role="alert">この操作を行う権限がありません。</div>}
      {logsQuery.isError && !isForbidden && <div role="alert">ログの取得に失敗しました。時間をおいて再度お試しください。</div>}

      {logsQuery.data && (
        <>
          {logsQuery.data.entries.length === 0 ? (
            <p>該当するログはありません。</p>
          ) : (
            <ul>
              {logsQuery.data.entries.map(({ id, entry }) => {
                const summary = summarizeLogEntry(entry);
                return (
                  <li key={id}>
                    <time dateTime={summary.createdAt}>{formatCreatedAt(summary.createdAt)}</time> [
                    {CATEGORY_LABELS[entry.category]}]
                    {summary.action && ` ${summary.action}`}
                    {summary.executorId && ` by ${summary.executorId}`}
                    <pre>{JSON.stringify(summary.details, null, 2)}</pre>
                  </li>
                );
              })}
            </ul>
          )}
          <button type="button" disabled={pagination.pageIndex === 0} onClick={() => setPagination(goPrevPage(pagination))}>
            前へ
          </button>
          <button
            type="button"
            disabled={logsQuery.data.nextCursor === null}
            onClick={() => setPagination(goNextPage(pagination, logsQuery.data.nextCursor))}
          >
            次へ
          </button>
        </>
      )}
    </div>
  );
}
