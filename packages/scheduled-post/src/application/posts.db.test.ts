import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDb, guilds, scheduledPosts } from "@management-bot/db";
import { eq } from "drizzle-orm";
import {
  cancelScheduledPost,
  createScheduledPost,
  editScheduledPost,
  listGuildPosts,
  listMyPendingPosts,
} from "./posts.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const guildId = `test-guild-${randomUUID()}`;
const NOW = new Date("2026-10-05T03:00:00.000Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

afterAll(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await close();
});

beforeEach(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await db.insert(guilds).values({ id: guildId, name: "guild" });
});

const input = (overrides: Partial<Parameters<typeof createScheduledPost>[1]> = {}) => ({
  guildId,
  channelId: "c1",
  authorId: "u1",
  content: "hello",
  scheduledAt: at(120),
  now: NOW,
  ...overrides,
});

describe("createScheduledPost", () => {
  test("pendingとして登録される", async () => {
    const result = await createScheduledPost(db, input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.post).toMatchObject({ status: "pending", content: "hello", channelId: "c1", authorId: "u1" });
  });

  test("本文が空・2000文字超は登録しない", async () => {
    expect(await createScheduledPost(db, input({ content: "   " }))).toEqual({ ok: false, error: "invalid_content" });
    expect(await createScheduledPost(db, input({ content: "a".repeat(2001) }))).toEqual({
      ok: false,
      error: "invalid_content",
    });
    expect((await createScheduledPost(db, input({ content: "あ".repeat(2000) }))).ok).toBe(true);
  });

  test("1人10件まで(pendingのみ数える)。取り消せば再び登録できる", async () => {
    const posts = [];
    for (let i = 0; i < 10; i++) {
      const result = await createScheduledPost(db, input({ scheduledAt: at(120 + i) }));
      if (!result.ok) throw new Error("unexpected limit");
      posts.push(result.post);
    }
    expect(await createScheduledPost(db, input())).toEqual({ ok: false, error: "user_limit" });
    // 他のユーザーは影響を受けない
    expect((await createScheduledPost(db, input({ authorId: "u2" }))).ok).toBe(true);

    await cancelScheduledPost(db, { id: posts[0]!.id, by: "author", guildId, authorId: "u1", now: NOW });
    expect((await createScheduledPost(db, input())).ok).toBe(true);
  });

  test("1ギルド100件まで", async () => {
    await db.insert(scheduledPosts).values(
      Array.from({ length: 100 }, (_, i) => ({
        guildId,
        channelId: "c1",
        authorId: `other-${i}`,
        content: "x",
        scheduledAt: at(120),
      })),
    );
    expect(await createScheduledPost(db, input())).toEqual({ ok: false, error: "guild_limit" });
  });

  test("posted/failed/cancelledは上限に数えない", async () => {
    await db.insert(scheduledPosts).values(
      (["posted", "failed", "cancelled"] as const).flatMap((status) =>
        Array.from({ length: 5 }, () => ({
          guildId,
          channelId: "c1",
          authorId: "u1",
          content: "x",
          scheduledAt: at(-100),
          status,
        })),
      ),
    );
    expect((await createScheduledPost(db, input())).ok).toBe(true);
  });

  test("同時登録でも上限(1人10件)を超えない", async () => {
    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) => createScheduledPost(db, input({ scheduledAt: at(120 + i) }))),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    expect(await listMyPendingPosts(db, guildId, "u1")).toHaveLength(10);
  });
});

describe("editScheduledPost", () => {
  async function create(scheduledAt: Date = at(120)) {
    const result = await createScheduledPost(db, input({ scheduledAt }));
    if (!result.ok) throw new Error("create failed");
    return result.post;
  }

  test("本文と日時を更新し、変更前後を返す", async () => {
    const post = await create();
    const result = await editScheduledPost(db, {
      id: post.id,
      authorId: "u1",
      content: "edited",
      scheduledAt: at(300),
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.before.content).toBe("hello");
    expect(result.after).toMatchObject({ content: "edited", status: "pending", channelId: "c1" });
    expect(result.after.scheduledAt.getTime()).toBe(at(300).getTime());
  });

  test("投稿予定時刻の1分前を過ぎたら編集できない(境界: ちょうど1分前も不可、1分超は可)", async () => {
    const edit = (post: { id: string }, now: Date) =>
      editScheduledPost(db, { id: post.id, authorId: "u1", content: "e", scheduledAt: at(500), now });

    const post = await create(at(10));
    expect(await edit(post, at(9))).toEqual({ ok: false, error: "too_late" });
    expect(await edit(post, new Date(at(9).getTime() - 1))).toMatchObject({ ok: true });
  });

  test("本人以外・pending以外は編集できない", async () => {
    const post = await create();
    expect(
      await editScheduledPost(db, { id: post.id, authorId: "u2", content: "e", scheduledAt: at(300), now: NOW }),
    ).toEqual({ ok: false, error: "not_found" });

    await db.update(scheduledPosts).set({ status: "posting" }).where(eq(scheduledPosts.id, post.id));
    expect(
      await editScheduledPost(db, { id: post.id, authorId: "u1", content: "e", scheduledAt: at(300), now: NOW }),
    ).toEqual({ ok: false, error: "not_found" });
  });
});

describe("cancelScheduledPost", () => {
  test("本人の取り消しはpendingのみ成功し、2回目は失敗する", async () => {
    const created = await createScheduledPost(db, input());
    if (!created.ok) throw new Error("create failed");
    const id = created.post.id;

    const first = await cancelScheduledPost(db, { id, by: "author", guildId, authorId: "u1", now: NOW });
    expect(first).toMatchObject({ status: "cancelled", cancelledBy: "author" });
    expect(first?.finishedAt).not.toBeNull();
    expect(await cancelScheduledPost(db, { id, by: "author", guildId, authorId: "u1", now: NOW })).toBeNull();
  });

  test("他人は取り消せない・別ギルドの管理者取り消しは無効・管理者は取り消せる", async () => {
    const created = await createScheduledPost(db, input());
    if (!created.ok) throw new Error("create failed");
    const id = created.post.id;

    expect(await cancelScheduledPost(db, { id, by: "author", guildId, authorId: "u2", now: NOW })).toBeNull();
    expect(await cancelScheduledPost(db, { id, by: "admin", guildId: "other-guild", now: NOW })).toBeNull();
    expect(await cancelScheduledPost(db, { id, by: "admin", guildId, now: NOW })).toMatchObject({
      status: "cancelled",
      cancelledBy: "admin",
    });
  });

  test("投稿処理が始まった(posting)予約は取り消せない", async () => {
    const created = await createScheduledPost(db, input());
    if (!created.ok) throw new Error("create failed");
    await db.update(scheduledPosts).set({ status: "posting" }).where(eq(scheduledPosts.id, created.post.id));

    expect(await cancelScheduledPost(db, { id: created.post.id, by: "admin", guildId, now: NOW })).toBeNull();
  });
});

describe("listMyPendingPosts / listGuildPosts", () => {
  test("自分のpendingのみ予定時刻順、ギルド一覧は全状態", async () => {
    const a = await createScheduledPost(db, input({ scheduledAt: at(200) }));
    const b = await createScheduledPost(db, input({ scheduledAt: at(100) }));
    await createScheduledPost(db, input({ authorId: "u2" }));
    if (!a.ok || !b.ok) throw new Error("create failed");
    await cancelScheduledPost(db, { id: a.post.id, by: "author", guildId, authorId: "u1", now: NOW });

    const mine = await listMyPendingPosts(db, guildId, "u1");
    expect(mine.map((p) => p.id)).toEqual([b.post.id]);

    const all = await listGuildPosts(db, guildId);
    expect(all).toHaveLength(3);
  });
});
