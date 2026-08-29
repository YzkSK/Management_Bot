import type { AppRouter } from "@management-bot/dashboard-api";
import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import { createTRPCOptionsProxy, type TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { QueryClient } from "@tanstack/react-query";

if (!import.meta.env.VITE_API_URL) {
  throw new Error("VITE_API_URL is required");
}
export const API_URL: string = import.meta.env.VITE_API_URL;

const client: TRPCClient<AppRouter> = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: `${API_URL}/trpc`, fetch: (url, opts) => fetch(url, { ...opts, credentials: "include" }) })],
});

export const queryClient = new QueryClient();

export const trpc: TRPCOptionsProxy<AppRouter> = createTRPCOptionsProxy<AppRouter>({
  client,
  queryClient,
});
