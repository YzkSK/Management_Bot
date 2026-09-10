import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { isUnauthorizedError } from "./is-unauthorized-error.js";

// dashboard-api側のTTLキャッシュ(getGuildMembership等、数秒〜30秒)と足並みを揃え、
// 画面遷移・フォーカス復帰の度に全tRPCクエリが即再フェッチされるのを防ぐ既定値。
// mutation成功時のinvalidateQueriesはこの値を無視して即再取得するため、権限付与・設定変更等の
// 自分の操作は即座に反映される。他者による変更の反映は最大この秒数遅れうる。
export const DASHBOARD_QUERY_STALE_TIME_MS = 10_000;
export const DASHBOARD_QUERY_RETRY_COUNT = 3;

const PERMANENT_TPRC_ERROR_CODES = new Set([
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "METHOD_NOT_SUPPORTED",
  "CONFLICT",
  "PRECONDITION_FAILED",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "UNPROCESSABLE_CONTENT",
]);

export function shouldRetryDashboardQuery(failureCount: number, error: unknown): boolean {
  return (
    failureCount < DASHBOARD_QUERY_RETRY_COUNT &&
    !(error instanceof TRPCClientError && PERMANENT_TPRC_ERROR_CODES.has(error.data?.code ?? ""))
  );
}

export function createDashboardQueryClient(onUnauthorized: (error: unknown) => void): QueryClient {
  const onError = (error: unknown) => {
    if (isUnauthorizedError(error)) {
      onUnauthorized(error);
    }
  };

  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: DASHBOARD_QUERY_STALE_TIME_MS,
        retry: shouldRetryDashboardQuery,
      },
    },
  });
}
