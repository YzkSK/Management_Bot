import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { isUnauthorizedError } from "./is-unauthorized-error.js";

/**
 * dashboard-api側は`getGuildMembership`等を30秒TTLでキャッシュしている(issue #99)。
 * フロント側のデフォルトstaleTimeを0のままにすると、画面遷移・フォーカス復帰・remountの度に
 * 全tRPCクエリを即座に再フェッチしてしまい、サーバー側キャッシュの効果を打ち消してしまう(issue #205)。
 * サーバー側TTLに合わせて揃える。
 */
export const DEFAULT_STALE_TIME_MS = 30_000;

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
        staleTime: DEFAULT_STALE_TIME_MS,
      },
    },
  });
}
