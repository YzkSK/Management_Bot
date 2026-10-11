import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { auditLogs, capabilityGrants, createDb, guilds, sessions } from "@management-bot/db";
import { ALL_CAPABILITIES, CAPABILITIES } from "@management-bot/shared";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { auditLogRouter } from "./audit-log.js";
import { capabilityGrantsRouter } from "./router.js";
import {
  createCallerFactory,
  protectedProcedure,
  requireCapability,
  router,
  type GuildMembership,
} from "./trpc.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const testId = randomUUID();
const guildId = `test-guild-${testId}`;
const otherGuildId = `test-guild-other-${testId}`;

/** userId → セッション(`sess-<userId>`)。membershipはuserIdごとに指定する。 */
const USERS = ["owner", "admin", "viewer", "nobody", "outsider"] as const;
const memberships: Record<string, GuildMembership | null> = {
  owner: { isOwner: true, roleIds: [] },
  admin: { isOwner: false, roleIds: [] },
  viewer: { isOwner: false, roleIds: [] },
  nobody: { isOwner: false, roleIds: [] },
  outsider: null,
};

const executed: unknown[] = [];

const testRouter = router({
  logging: router({
    setThing: protectedProcedure
      .input(z.object({ guildId: z.string(), value: z.string(), webhookSecret: z.string().optional() }))
      .use(requireCapability(CAPABILITIES.MANAGE_LOGGING_SETTINGS))
      .mutation(({ ctx, input }) => {
        ctx.setAuditBefore({ value: "old", token: "old-token" });
        executed.push(input);
        return "ok";
      }),
    failThing: protectedProcedure
      .input(z.object({ guildId: z.string() }))
      .use(requireCapability(CAPABILITIES.MANAGE_LOGGING_SETTINGS))
      .mutation(() => {
        throw new Error("boom");
      }),
    readThing: protectedProcedure
      .input(z.object({ guildId: z.string() }))
      .use(requireCapability(CAPABILITIES.MANAGE_LOGGING_SETTINGS))
      .query(() => "read"),
  }),
  access: capabilityGrantsRouter,
  auditLog: auditLogRouter,
});

const createCaller = createCallerFactory(testRouter);

function callerFor(user: (typeof USERS)[number], dbOverride = db) {
  return createCaller({
    db: dbOverride,
    sessionId: `sess-${user}`,
    discordClientId: "test-client-id",
    getGuildMembership: async (g, userId) => (g === guildId || g === otherGuildId ? (memberships[userId] ?? null) : null),
    getGuildChannels: async () => [],
    getAllGuildChannels: async () => [],
    verifyGuildChannel: async () => false,
    getGuildMemberNames: async (_g, ids) => new Map(ids.map((id) => [id, `${id}-nick`])),
    getBotPermissions: async () => 0n,
    getGuildRoles: async () => [],
    getGuildAccessStatus: async () => "ok" as const,
    getGuildOwnerId: async () => "owner",
    verifyGuildRole: async () => true,
    getGuildMembersPage: async () => ({ members: [], nextAfter: undefined }),
    readRedisHash: async () => ({}),
    isGuildMember: async () => true,
    listMyGuilds: async () => [],
    getGuildVoiceChannelOptions: async () => [],
    getGuildCategoryOptions: async () => [],
    getMyAvatarUrl: async () => null,
  });
}

async function rowsOf(g: string) {
  return db.select().from(auditLogs).where(eq(auditLogs.guildId, g)).orderBy(auditLogs.createdAt);
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (e) {
    return e;
  }
}

function codeOf(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

beforeAll(async () => {
  await db.insert(guilds).values([
    { id: guildId, name: "guild" },
    { id: otherGuildId, name: "other" },
  ]);
  await db.insert(sessions).values(
    USERS.map((u) => ({
      id: `sess-${u}`,
      discordUserId: u,
      discordUsername: `${u}-name`,
      encryptedAccessToken: "t",
      encryptedRefreshToken: "r",
      expiresAt: new Date(Date.now() + 600_000),
    })),
  );
  await db.insert(capabilityGrants).values([
    { id: randomUUID(), guildId, targetType: "user", targetId: "admin", capabilities: ALL_CAPABILITIES },
    { id: randomUUID(), guildId, targetType: "user", targetId: "viewer", capabilities: CAPABILITIES.MANAGE_LOGGING_SETTINGS },
  ]);
});

afterAll(async () => {
  for (const u of USERS) await db.delete(sessions).where(eq(sessions.id, `sess-${u}`));
  // audit_logsは追記専用のため削除しない(テストごとに一意なguildIdを使う)。
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await db.delete(guilds).where(eq(guilds.id, otherGuildId));
  await close();
});

describe("requireCapabilityの操作履歴記録", () => {
  test("mutation成功: 実行前にpendingで記録→successに確定し、before/afterを残して秘密を伏せる", async () => {
    await callerFor("admin").logging.setThing({ guildId, value: "new", webhookSecret: "s3cret" });

    const [row] = (await rowsOf(guildId)).filter((r) => r.action === "setThing");
    expect(row).toMatchObject({
      guildId,
      kind: "action",
      actorId: "admin",
      actorName: "admin-nick",
      feature: "logging",
      action: "setThing",
      outcome: "success",
      before: { value: "old", token: "***" },
      after: { guildId, value: "new", webhookSecret: "***" },
    });
  });

  test("mutationが例外を投げたらfailureで確定する", async () => {
    const error = await captureRejection(callerFor("admin").logging.failThing({ guildId }));

    expect(error).toBeInstanceOf(Error);
    const row = (await rowsOf(guildId)).find((r) => r.action === "failThing");
    expect(row?.outcome).toBe("failure");
  });

  test("在籍しているが権限不足のmutationはdeniedで記録されFORBIDDEN、操作は実行されない", async () => {
    executed.length = 0;
    const error = await captureRejection(callerFor("nobody").logging.setThing({ guildId, value: "x" }));

    expect(codeOf(error)).toBe("FORBIDDEN");
    expect(executed).toHaveLength(0);
    const row = (await rowsOf(guildId)).find((r) => r.actorId === "nobody");
    expect(row).toMatchObject({ outcome: "denied", action: "setThing", actorName: "nobody-nick" });
  });

  test("在籍していない人の呼び出しはFORBIDDENで、任意のguildIdで行を作らせない", async () => {
    const error = await captureRejection(callerFor("outsider").logging.setThing({ guildId, value: "x" }));

    expect(codeOf(error)).toBe("FORBIDDEN");
    expect((await rowsOf(guildId)).some((r) => r.actorId === "outsider")).toBe(false);
  });

  test("queryは記録しない", async () => {
    const before = (await rowsOf(guildId)).length;
    await callerFor("admin").logging.readThing({ guildId });
    await captureRejection(callerFor("nobody").logging.readThing({ guildId }));

    expect((await rowsOf(guildId)).length).toBe(before);
  });

  test("記録に失敗したら操作は実行されない(INTERNAL_SERVER_ERROR)", async () => {
    executed.length = 0;
    const failingDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "insert") {
          return () => {
            throw new Error("insert failed");
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const error = await captureRejection(callerFor("admin", failingDb).logging.setThing({ guildId, value: "z" }));

    expect(codeOf(error)).toBe("INTERNAL_SERVER_ERROR");
    expect(executed).toHaveLength(0);
  });
});

describe("オーナー専用capability(VIEW_AUDIT_LOG)の付与・剥奪", () => {
  const input = { guildId, targetType: "user" as const, targetId: "viewer", capabilities: CAPABILITIES.VIEW_AUDIT_LOG };

  test("全権限を持つ非オーナーでもVIEW_AUDIT_LOGは付与できない(API)", async () => {
    const error = await captureRejection(callerFor("admin").access.grantCapabilities(input));

    expect(codeOf(error)).toBe("FORBIDDEN");
  });

  test("オーナーは付与でき、付与された人は履歴を閲覧できる。非オーナーは剥奪できない", async () => {
    await callerFor("owner").access.grantCapabilities({
      ...input,
      capabilities: CAPABILITIES.VIEW_AUDIT_LOG | CAPABILITIES.VIEW_LOGS | CAPABILITIES.MANAGE_LOGGING_SETTINGS,
    });

    const list = await callerFor("viewer").auditLog.list({ guildId });
    expect(list.entries.some((e) => e.feature === "access" && e.action === "grantCapabilities")).toBe(true);

    const revokeError = await captureRejection(
      callerFor("admin").access.revokeCapabilityGrant({ guildId, targetType: "user", targetId: "viewer" }),
    );
    expect(codeOf(revokeError)).toBe("FORBIDDEN");

    // オーナー専用bitを含まない部分の変更は非オーナーでも可能だが、bitを落とすのは不可。
    const dropError = await captureRejection(
      callerFor("admin").access.grantCapabilities({ ...input, capabilities: CAPABILITIES.VIEW_LOGS | CAPABILITIES.MANAGE_LOGGING_SETTINGS }),
    );
    expect(codeOf(dropError)).toBe("FORBIDDEN");

    await callerFor("owner").access.revokeCapabilityGrant({ guildId, targetType: "user", targetId: "viewer" });
    await db
      .insert(capabilityGrants)
      .values({ id: randomUUID(), guildId, targetType: "user", targetId: "viewer", capabilities: CAPABILITIES.MANAGE_LOGGING_SETTINGS })
      .onConflictDoNothing();
  });
});

describe("auditLog.list / listFilterOptions", () => {
  test("設定変更→履歴記録→権限者(オーナー)のみ閲覧可。権限のない人はFORBIDDEN", async () => {
    await callerFor("admin").logging.setThing({ guildId, value: "flow" });

    const asOwner = await callerFor("owner").auditLog.list({ guildId });
    expect(asOwner.entries.some((e) => e.action === "setThing" && e.after !== null)).toBe(true);

    const error = await captureRejection(callerFor("nobody").auditLog.list({ guildId }));
    expect(codeOf(error)).toBe("FORBIDDEN");
    const optionsError = await captureRejection(callerFor("nobody").auditLog.listFilterOptions({ guildId }));
    expect(codeOf(optionsError)).toBe("FORBIDDEN");
  });

  test("ギルド間で履歴が混ざらない", async () => {
    await callerFor("owner").logging.setThing({ guildId: otherGuildId, value: "other-guild" });

    const list = await callerFor("owner").auditLog.list({ guildId });
    expect(list.entries.every((e) => e.guildId === guildId)).toBe(true);
    const otherList = await callerFor("owner").auditLog.list({ guildId: otherGuildId });
    expect(otherList.entries.length).toBeGreaterThan(0);
    expect(otherList.entries.every((e) => e.guildId === otherGuildId)).toBe(true);
  });

  test("操作者・機能・アクセス履歴の絞り込みとセレクター用オプション", async () => {
    await callerFor("owner").auditLog.recordAccess({ guildId });

    const all = await callerFor("owner").auditLog.list({ guildId });
    expect(all.entries.some((e) => e.kind === "access")).toBe(true);

    const hidden = await callerFor("owner").auditLog.list({ guildId, hideAccess: true });
    expect(hidden.entries.some((e) => e.kind === "access")).toBe(false);

    const byActor = await callerFor("owner").auditLog.list({ guildId, actorId: "admin", feature: "logging" });
    expect(byActor.entries.length).toBeGreaterThan(0);
    expect(byActor.entries.every((e) => e.actorId === "admin" && e.feature === "logging")).toBe(true);

    const future = await callerFor("owner").auditLog.list({ guildId, from: new Date(Date.now() + 86_400_000).toISOString() });
    expect(future.entries).toHaveLength(0);

    const options = await callerFor("owner").auditLog.listFilterOptions({ guildId });
    expect(options.actors).toContainEqual({ id: "admin", name: "admin-nick" });
    expect(options.features).toContain("logging");
    expect(options.features).toContain("dashboard");
  });
});

describe("auditLog.recordAccess", () => {
  test("同一actor・guildは30分に1回にまとめ、30分を過ぎたら再度記録する。非在籍はFORBIDDEN", async () => {
    const accessCount = async (actor: string) =>
      (await db.select().from(auditLogs).where(and(eq(auditLogs.guildId, guildId), eq(auditLogs.kind, "access"), eq(auditLogs.actorId, actor)))).length;

    await callerFor("viewer").auditLog.recordAccess({ guildId });
    await callerFor("viewer").auditLog.recordAccess({ guildId });
    expect(await accessCount("viewer")).toBe(1);

    // 別ギルドは別カウント。
    await callerFor("viewer").auditLog.recordAccess({ guildId: otherGuildId });
    expect(await accessCount("viewer")).toBe(1);

    // 古い(45分前)アクセス履歴しかない人は新規に記録される。
    await db.insert(auditLogs).values({
      id: randomUUID(),
      guildId,
      kind: "access",
      actorId: "nobody",
      actorName: "nobody-nick",
      feature: "dashboard",
      action: "open",
      outcome: "success",
      createdAt: new Date(Date.now() - 45 * 60_000),
    });
    await callerFor("nobody").auditLog.recordAccess({ guildId });
    expect(await accessCount("nobody")).toBe(2);

    const error = await captureRejection(callerFor("outsider").auditLog.recordAccess({ guildId }));
    expect(codeOf(error)).toBe("FORBIDDEN");
    expect(await accessCount("outsider")).toBe(0);
  });
});
