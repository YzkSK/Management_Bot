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
  });
}
