import { describe, expect, mock, test } from "bun:test";
import { TRPCClientError } from "@trpc/client";
import {
  createDashboardQueryClient,
  DASHBOARD_QUERY_STALE_TIME_MS,
  shouldRetryDashboardQuery,
} from "./dashboard-query-client.js";

function unauthorizedError() {
  return TRPCClientError.from({
    error: { code: -32001, message: "unauthorized", data: { code: "UNAUTHORIZED" } },
  });
}

function internalServerError() {
  return TRPCClientError.from({
    error: { code: -32603, message: "boom", data: { code: "INTERNAL_SERVER_ERROR" } },
  });
}

function forbiddenError() {
  return TRPCClientError.from({
    error: { code: -32003, message: "forbidden", data: { code: "FORBIDDEN" } },
  });
}

describe("createDashboardQueryClient", () => {
  test("恒久的なクライアントエラーはリトライせず、一時的なエラーは最大3回リトライする", () => {
    expect(shouldRetryDashboardQuery(0, forbiddenError())).toBe(false);
    expect(shouldRetryDashboardQuery(0, internalServerError())).toBe(true);
    expect(shouldRetryDashboardQuery(2, internalServerError())).toBe(true);
    expect(shouldRetryDashboardQuery(3, internalServerError())).toBe(false);
  });

  test("作成したQueryClientは共通のリトライ方針を使用する", () => {
    const retry = createDashboardQueryClient(() => {}).getDefaultOptions().queries?.retry;

    expect(typeof retry).toBe("function");
    if (typeof retry !== "function") {
      throw new Error("dashboard query retry policy is not configured");
    }
    expect(retry(0, forbiddenError())).toBe(false);
    expect(retry(0, internalServerError())).toBe(true);
  });

  test("queryの既定staleTimeがDASHBOARD_QUERY_STALE_TIME_MSに設定される", () => {
    const client = createDashboardQueryClient(() => {});

    expect(client.getDefaultOptions().queries?.staleTime).toBe(DASHBOARD_QUERY_STALE_TIME_MS);
  });

  test("queryがUNAUTHORIZEDで失敗するとonUnauthorizedが呼ばれる", async () => {
    const onUnauthorized = mock();
    const client = createDashboardQueryClient(onUnauthorized);

    await client
      .fetchQuery({ queryKey: ["test"], queryFn: () => Promise.reject(unauthorizedError()), retry: false })
      .catch(() => {});

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  test("queryがUNAUTHORIZED以外で失敗してもonUnauthorizedは呼ばれない", async () => {
    const onUnauthorized = mock();
    const client = createDashboardQueryClient(onUnauthorized);

    await client
      .fetchQuery({ queryKey: ["test"], queryFn: () => Promise.reject(internalServerError()), retry: false })
      .catch(() => {});

    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  test("mutationがUNAUTHORIZEDで失敗してもonUnauthorizedが呼ばれる", async () => {
    const onUnauthorized = mock();
    const client = createDashboardQueryClient(onUnauthorized);

    await client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.reject(unauthorizedError()) })
      .execute(undefined)
      .catch(() => {});

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
