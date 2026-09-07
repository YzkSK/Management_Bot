import type { AppRouter } from "@management-bot/dashboard-api";
import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import { createTRPCOptionsProxy, type TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { createDashboardQueryClient } from "./dashboard-query-client.js";

if (!import.meta.env.VITE_API_URL) {
  throw new Error("VITE_API_URL is required");
}
export const API_URL: string = import.meta.env.VITE_API_URL;

const client: TRPCClient<AppRouter> = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: `${API_URL}/trpc`, fetch: (url, opts) => fetch(url, { ...opts, credentials: "include" }) })],
});

export const queryClient = createDashboardQueryClient(() => {
  window.location.href = `${API_URL}/auth/login`;
});

export const trpc: TRPCOptionsProxy<AppRouter> = createTRPCOptionsProxy<AppRouter>({
  client,
  queryClient,
});
