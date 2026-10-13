import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { completeAuditLog, purgeExpiredAuditLogs, recordAuditLog } from "./audit-log.js";
import { createDb } from "./client.js";
import { auditLogs } from "./schema/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const guildId = `test-guild-${randomUUID()}`;

afterAll(async () => {
  // 追記専用のため、保存期間内のテスト行は削除できない(テスト用DBは使い捨てコンテナ前提)。
  await purgeExpiredAuditLogs(db);
  await close();
});

const base = { guildId, kind: "action", actorId: "u1", actorName: "n", feature: "logging", action: "x" } as const;

async function rejects(promise: PromiseLike<unknown>): Promise<boolean> {
  try {
    await promise;
    return false;
  } catch {
    return true;
  }
}

async function insertAged(kind: "action" | "access", ageDays: number): Promise<string> {
  const id = randomUUID();
  await db.insert(auditLogs).values({
    id,
    guildId,
    kind,
    actorId: "u1",
    actorName: "n",
    feature: "f",
    action: "a",
    outcome: "success",
    createdAt: new Date(Date.now() - ageDays * 86_400_000),
  });
  return id;
}

async function exists(id: string): Promise<boolean> {
  return (await db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.id, id))).length > 0;
}

describe("audit_logsの追記専用トリガー", () => {
  test("pending→確定のoutcome更新(とbeforeのNULL→値)は許可され、確定後の再更新は拒否される", async () => {
    const id = await recordAuditLog(db, { ...base, outcome: "pending", after: { a: 1, token: "t" } });
    await completeAuditLog(db, id, "success", { b: 2 });

    const [row] = await db.select().from(auditLogs).where(eq(auditLogs.id, id));
    expect(row).toMatchObject({ outcome: "success", before: { b: 2 }, after: { a: 1, token: "***" } });

    expect(await rejects(db.update(auditLogs).set({ outcome: "failure" }).where(eq(auditLogs.id, id)))).toBe(true);
  });

  test("outcome以外の列の更新・既存beforeの書き換え・他列の変更は拒否される", async () => {
    const id = await recordAuditLog(db, { ...base, outcome: "pending", before: { v: 1 } });

    expect(await rejects(db.update(auditLogs).set({ actorName: "evil" }).where(eq(auditLogs.id, id)))).toBe(true);
    expect(await rejects(db.update(auditLogs).set({ outcome: "success", after: { x: 1 } }).where(eq(auditLogs.id, id)))).toBe(true);
    expect(await rejects(db.update(auditLogs).set({ outcome: "success", before: { v: 2 } }).where(eq(auditLogs.id, id)))).toBe(true);
    expect(await rejects(db.update(auditLogs).set({ outcome: "success", guildId: "other" }).where(eq(auditLogs.id, id)))).toBe(true);
  });

  test("deniedなど最初から確定している行は更新できない", async () => {
    const id = await recordAuditLog(db, { ...base, outcome: "denied" });

    expect(await rejects(db.update(auditLogs).set({ outcome: "success" }).where(eq(auditLogs.id, id)))).toBe(true);
  });

  test("保存期間内の行のDELETEは拒否される", async () => {
    const id = await recordAuditLog(db, { ...base, outcome: "success" });
    const accessId = await insertAged("access", 89);
    const actionId = await insertAged("action", 364);

    for (const target of [id, accessId, actionId]) {
      expect(await rejects(db.delete(auditLogs).where(eq(auditLogs.id, target)))).toBe(true);
      expect(await exists(target)).toBe(true);
    }
  });

  test("purgeExpiredAuditLogsは期限切れ(action 1年超 / access 90日超)の行のみ削除する", async () => {
    const oldAction = await insertAged("action", 400);
    const oldAccess = await insertAged("access", 91);
    const freshAction = await insertAged("action", 100);
    const freshAccess = await insertAged("access", 30);

    await purgeExpiredAuditLogs(db);

    expect(await exists(oldAction)).toBe(false);
    expect(await exists(oldAccess)).toBe(false);
    expect(await exists(freshAction)).toBe(true);
    expect(await exists(freshAccess)).toBe(true);
  });

  test("kind/outcomeのCHECK制約に反する値は挿入できない", async () => {
    const insert = (kind: string, outcome: string) =>
      db.execute(
        sql`INSERT INTO audit_logs (id, guild_id, kind, actor_name, feature, action, outcome) VALUES (${randomUUID()}, ${guildId}, ${kind}, 'n', 'f', 'a', ${outcome})`,
      );

    expect(await rejects(insert("bad", "success"))).toBe(true);
    expect(await rejects(insert("action", "bad"))).toBe(true);
  });
});
