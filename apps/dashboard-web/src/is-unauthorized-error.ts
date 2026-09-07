import { TRPCClientError } from "@trpc/client";

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof TRPCClientError && error.data?.code === "UNAUTHORIZED";
}
