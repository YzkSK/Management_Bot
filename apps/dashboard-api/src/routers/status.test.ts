import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createCallerFactory, type DashboardAccessContext } from "@management-bot/dashboard-access";
import { createDb, sessions, statusViewers } from "@management-bot/db";
import { TRPCError } from "@trpc/server";
import { inArray } from "drizzle-orm";
import { createStatusRouter, resolveStatusAccess, type StatusDeps } from "./status.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const OWNER = "900000000000000001";
const VIEWER = "900000000000000002";
const STRANGER = "900000000000000003";
const USERS = [OWNER, VIEWER, STRANGER];

const deps: StatusDeps = {
  getBotOwners: async () => [{ id: OWNER, name: "owner" }],
  collectStatus: async () => ({ checkedAt: "2026-09-30T00:00:00.000Z", summary: "ok", items: [] }),
  readLogs: async () => [],
  readResources: async () => [],
  readCurrentResources: async () => null,
  readBackups: async () => ({ updatedAt: "2026-09-30T00:00:00.000Z", files: [] }),
  requestBackup: async () => true,
};

async function cleanup() {
  await db.delete(sessions).where(inArray(sessions.discordUserId, USERS));
  await db.delete(statusViewers).where(inArray(statusViewers.discordUserId, USERS));
}

beforeEach(async () => {
  await cleanup();
  await db.insert(sessions).values(
    USERS.map((id) => ({
      id: `status-session-${id}`,
      discordUserId: id,
      discordUsername: `name-${id}`,
      encryptedAccessToken: "a",
      encryptedRefreshToken: "r",
      expiresAt: new Date(Date.now() + 60_000),
    })),
  );
});

afterAll(async () => {
  await cleanup();
  await close();
});

const createCaller = createCallerFactory(createStatusRouter(deps));
// status routerはprotectedProcedureのセッション検証とdbしか使わないため、他のcontext項目は呼ばれない。
const callerFor = (userId: string) =>
  createCaller({ db, sessionId: `status-session-${userId}` } as unknown as DashboardAccessContext);

const errorCode = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => (error instanceof TRPCError ? error.code : error),
  );

describe("status router", () => {
  test("オーナーでも許可ユーザーでもない人にはNOT_FOUNDを返す", async () => {
    expect(await errorCode(callerFor(STRANGER).overview())).toBe("NOT_FOUND");
    expect(await errorCode(callerFor(STRANGER).logs({}))).toBe("NOT_FOUND");
    expect(await errorCode(callerFor(STRANGER).resources({ range: "1h" }))).toBe("NOT_FOUND");
    expect(await errorCode(callerFor(STRANGER).resourcesNow())).toBe("NOT_FOUND");
  });

  test("閲覧できる人にはリソースのサンプルを返す", async () => {
    expect(await callerFor(OWNER).resources({ range: "24h" })).toEqual({ samples: [] });
    expect(await callerFor(OWNER).resourcesNow()).toEqual({ sample: null });
  });

  test("オーナーが追加したユーザーは閲覧できるが、閲覧権限の管理はできない", async () => {
    const owner = callerFor(OWNER);
    expect((await owner.viewerCandidates()).map((c) => c.id)).toEqual(expect.arrayContaining([VIEWER, STRANGER]));
    await owner.addViewer({ discordUserId: VIEWER });

    const viewer = callerFor(VIEWER);
    expect((await viewer.overview()).summary).toBe("ok");
    expect(await errorCode(viewer.viewers())).toBe("NOT_FOUND");
    expect(await errorCode(viewer.addViewer({ discordUserId: STRANGER }))).toBe("NOT_FOUND");

    expect(await owner.viewers()).toEqual({
      owners: [{ id: OWNER, name: "owner" }],
      viewers: [{ id: VIEWER, name: `name-${VIEWER}` }],
    });
    expect((await owner.viewerCandidates()).map((c) => c.id)).not.toContain(VIEWER);

    await owner.removeViewer({ discordUserId: VIEWER });
    expect(await errorCode(viewer.overview())).toBe("NOT_FOUND");
  });

  test("バックアップ一覧は閲覧者が取れ、手動バックアップの要求はオーナーだけができる", async () => {
    await callerFor(OWNER).addViewer({ discordUserId: VIEWER });
    const viewer = callerFor(VIEWER);
    expect(await viewer.backups()).toEqual({ backups: { updatedAt: "2026-09-30T00:00:00.000Z", files: [] } });
    expect(await errorCode(viewer.requestBackup())).toBe("NOT_FOUND");
    expect(await callerFor(OWNER).requestBackup()).toEqual({ queued: true });
  });

  test("ログインしたことのないユーザーは追加できない", async () => {
    expect(await errorCode(callerFor(OWNER).addViewer({ discordUserId: "900000000000000099" }))).toBe("BAD_REQUEST");
  });
});

test("オーナー判定に失敗したら閲覧不可に倒す", async () => {
  const failing: StatusDeps = { ...deps, getBotOwners: async () => Promise.reject(new Error("discord down")) };
  expect(await resolveStatusAccess(db, failing, OWNER)).toBeNull();
});
