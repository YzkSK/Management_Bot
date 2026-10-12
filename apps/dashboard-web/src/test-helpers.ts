import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";

export function forbiddenError() {
  return TRPCClientError.from({ error: { code: -32003, message: "forbidden", data: { code: "FORBIDDEN" } } });
}

/** SSRテスト用に、クエリを取得失敗(error)状態にしてキャッシュへ入れる。 */
export function seedQueryError(queryClient: QueryClient, queryKey: QueryKey, error: Error): void {
  queryClient.getQueryCache().build(queryClient, { queryKey }).setState({
    status: "error",
    error,
    fetchStatus: "idle",
  });
}
