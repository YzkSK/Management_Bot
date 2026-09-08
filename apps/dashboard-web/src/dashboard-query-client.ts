import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { isUnauthorizedError } from "./is-unauthorized-error.js";

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
        // dashboard-api側のTTLキャッシュ(getGuildMembership等、数秒〜30秒)と足並みを揃え、
        // 画面遷移・フォーカス復帰の度に全tRPCクエリが即再フェッチされるのを防ぐ。
        staleTime: 10_000,
      },
    },
  });
}
