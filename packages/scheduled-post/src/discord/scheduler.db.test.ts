import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDb, guildFeatureToggles, guilds, scheduledPosts, syncFeatureMetadata } from "@management-bot/db";
import type { ScheduledPostEventRecordedEvent } from "@management-bot/shared";
import { eq } from "drizzle-orm";
import { cancelScheduledPost, setAllowedRoleIds, setScheduledPostEnabled } from "../application/index.js";
import type { AllowedMentionsSpec, PostFacts } from "../domain/index.js";
import { handleAdminCancelNotification } from "./dashboard-action-listener.js";
import { cancelOwnPostAction, createPostAction, editPostAction } from "./schedule-actions.js";
import {
  createScheduler,
  recoverInterruptedPosts,
  runSchedulerTick,
  type PostInspection,
  type SchedulerDeps,
  type SchedulerGateway,
} from "./scheduler.js";
import type { PostView } from "./post-message.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const { db, close } = createDb(databaseUrl);
const guildId = `test-guild-${randomUUID()}`;
const T0 = new Date("2026-10-05T03:00:00.000Z");
const minutes = (n: number) => n * 60_000;

afterAll(async () => {
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await close();
});

beforeEach(async () => {
  await syncFeatureMetadata(db);
  await db.delete(guilds).where(eq(guilds.id, guildId));
  await db.insert(guilds).values({ id: guildId, name: "test" });
  await db.insert(guildFeatureToggles).values({ guildId, featureKey: "scheduled-post", enabled: true });
});

const okFacts: PostFacts = {
  authorIsMember: true,
  authorRoleIds: ["role-a"],
  channelKind: "message-channel",
  threadClosed: false,
  authorCanSend: true,
  botCanSend: true,
};

interface Harness {
  deps: SchedulerDeps;
  events: ScheduledPostEventRecordedEvent[];
  sends: { channelId: string; content: string; view: PostView; mentions: AllowedMentionsSpec }[];
  dms: { userId: string; text: string }[];
  clock: { now: Date };
  setFacts: (facts: Partial<PostFacts>) => void;
  failSendWith: (error: unknown) => void;
  failDm: () => void;
  inspection: Partial<PostInspection>;
}

function createHarness(): Harness {
  const events: ScheduledPostEventRecordedEvent[] = [];
  const sends: Harness["sends"] = [];
  const dms: Harness["dms"] = [];
  const clock = { now: T0 };
  let facts = okFacts;
  let sendError: unknown;
  let dmFails = false;
  const inspection: Partial<PostInspection> = {};
  const gateway: SchedulerGateway = {
    inspect: async () => ({
      facts,
      canMentionEveryone: false,
      isRoleMentionable: () => false,
      channelName: "general",
      authorName: "ゆずき",
      authorAvatarUrl: "https://cdn.example/a.png",
      ...inspection,
    }),
    send: async (post, view, mentions) => {
      if (sendError) throw sendError;
      sends.push({ channelId: post.channelId, content: post.content, view, mentions });
      return { messageId: `m-${sends.length}` };
    },
    sendDm: async (userId, text) => {
      if (dmFails) throw new Error("Cannot send messages to this user");
      dms.push({ userId, text });
    },
  };
  const deps: SchedulerDeps = {
    db,
    gateway,
    publish: async (event) => {
      events.push(event);
    },
    now: () => clock.now,
  };
  return {
    deps,
    events,
    sends,
    dms,
    clock,
    inspection,
    setFacts: (patch) => {
      facts = { ...facts, ...patch };
    },
    failSendWith: (error) => {
      sendError = error;
    },
    failDm: () => {
      dmFails = true;
    },
  };
}

async function statusOf(id: string) {
  const [row] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, id));
  return row;
}

async function reserve(h: Harness, scheduledAtOffsetMin: number, content = "こんにちは") {
  const result = await createPostAction(h.deps, {
    guildId,
    channelId: "c1",
    channelName: "general",
    authorId: "u1",
    authorName: "ゆずき",
    content,
    scheduledAt: new Date(T0.getTime() + minutes(scheduledAtOffsetMin)),
  });
  if (!result.ok) throw new Error(`create failed: ${result.error}`);
  return result.post;
}

describe("予約投稿の複合シナリオ", () => {
  test("登録→編集→時刻到来→権限確認→投稿→ログイベントが順に発行され、再実行しても二重投稿されない", async () => {
    const h = createHarness();
    const post = await reserve(h, 10);

    h.clock.now = new Date(T0.getTime() + minutes(1));
    const edited = await editPostAction(h.deps, {
      id: post.id,
      authorId: "u1",
      authorName: "ゆずき",
      content: "編集後の本文",
      scheduledAt: new Date(T0.getTime() + minutes(20)),
    });
    expect(edited.ok).toBe(true);

    // 元の時刻(10分後)ではまだ投稿されない。
    h.clock.now = new Date(T0.getTime() + minutes(11));
    await runSchedulerTick(h.deps);
    expect(h.sends).toHaveLength(0);

    h.clock.now = new Date(T0.getTime() + minutes(20));
    await runSchedulerTick(h.deps);
    await runSchedulerTick(h.deps);

    expect(h.sends).toHaveLength(1);
    expect(h.sends[0]?.content).toBe("編集後の本文");
    expect(h.sends[0]?.view).toEqual({ authorName: "ゆずき", authorAvatarUrl: "https://cdn.example/a.png" });
    const row = await statusOf(post.id);
    expect(row?.status).toBe("posted");
    expect(row?.messageId).toBe("m-1");
    expect(h.events.map((e) => e.action)).toEqual(["created", "edited", "posted"]);
    const editedEvent = h.events[1];
    if (editedEvent?.action !== "edited") throw new Error("expected edited event");
    expect(editedEvent.before.content).toBe("こんにちは");
    expect(editedEvent.after.content).toBe("編集後の本文");
  });

  test("本人の取り消し後は投稿されず、cancelledイベント(by=author)が発行される", async () => {
    const h = createHarness();
    const post = await reserve(h, 5);
    const cancelled = await cancelOwnPostAction(h.deps, { id: post.id, guildId, authorId: "u1", authorName: "ゆずき" });
    expect(cancelled?.status).toBe("cancelled");

    h.clock.now = new Date(T0.getTime() + minutes(6));
    await runSchedulerTick(h.deps);

    expect(h.sends).toHaveLength(0);
    const last = h.events.at(-1);
    expect(last?.action === "cancelled" && last.by).toBe("author");
  });

  test.each([
    ["author_left", { authorIsMember: false }],
    ["no_permission", { authorCanSend: false }],
    ["channel_deleted", { channelKind: "missing" as const }],
    ["thread_archived", { channelKind: "thread" as const, threadClosed: true }],
    ["bot_missing_permission", { botCanSend: false }],
  ] as const)("投稿直前の確認で%sなら投稿せず失敗とし、DMとログを残す", async (reason, patch) => {
    const h = createHarness();
    const post = await reserve(h, 5);
    h.setFacts(patch);

    h.clock.now = new Date(T0.getTime() + minutes(5));
    await runSchedulerTick(h.deps);

    expect(h.sends).toHaveLength(0);
    const row = await statusOf(post.id);
    expect(row?.status).toBe("failed");
    expect(row?.failureReason).toBe(reason);
    expect(h.dms.map((d) => d.userId)).toEqual(["u1"]);
    const last = h.events.at(-1);
    expect(last?.action === "failed" && last.reason).toBe(reason);
  });

  test("使えるロールが設定され、予約者がそのロールを失っていたらno_roleで失敗する", async () => {
    const h = createHarness();
    const post = await reserve(h, 5);
    await setAllowedRoleIds(db, guildId, ["role-b"]);

    h.clock.now = new Date(T0.getTime() + minutes(5));
    await runSchedulerTick(h.deps);

    expect((await statusOf(post.id))?.failureReason).toBe("no_role");
    expect(h.sends).toHaveLength(0);
  });

  test("使えるロールを予約者が持っていれば投稿できる", async () => {
    const h = createHarness();
    const post = await reserve(h, 5);
    await setAllowedRoleIds(db, guildId, ["role-a"]);

    h.clock.now = new Date(T0.getTime() + minutes(5));
    await runSchedulerTick(h.deps);

    expect((await statusOf(post.id))?.status).toBe("posted");
  });

  test("Bot停止中に時刻を過ぎても、遅れが1時間以内なら投稿し、超えたら時間切れで失敗する", async () => {
    const h = createHarness();
    const recent = await reserve(h, 5, "30分遅れ");
    const old = await reserve(h, 6, "2時間遅れ");

    h.clock.now = new Date(T0.getTime() + minutes(6 + 120));
    // recentは5分後予定→6+120分時点で2時間超過になるため、投稿可能な側を別途作る。
    await db.update(scheduledPosts).set({ scheduledAt: new Date(h.clock.now.getTime() - minutes(30)) }).where(eq(scheduledPosts.id, recent.id));
    await runSchedulerTick(h.deps);

    expect((await statusOf(recent.id))?.status).toBe("posted");
    const oldRow = await statusOf(old.id);
    expect(oldRow?.status).toBe("failed");
    expect(oldRow?.failureReason).toBe("expired");
    expect(h.sends.map((s) => s.content)).toEqual(["30分遅れ"]);
    expect(h.dms.some((d) => d.text.includes("時間切れ"))).toBe(true);
  });

  test("投稿処理中(posting)のまま残った予約は、unknown_resultで失敗とし、再送しない", async () => {
    const h = createHarness();
    const post = await reserve(h, 1);
    await db.update(scheduledPosts).set({ status: "posting", updatedAt: T0 }).where(eq(scheduledPosts.id, post.id));

    h.clock.now = new Date(T0.getTime() + minutes(10));
    await recoverInterruptedPosts(h.deps);
    await runSchedulerTick(h.deps);

    const row = await statusOf(post.id);
    expect(row?.status).toBe("failed");
    expect(row?.failureReason).toBe("unknown_result");
    expect(h.sends).toHaveLength(0);
    expect(h.dms).toHaveLength(1);
    const last = h.events.at(-1);
    expect(last?.action === "failed" && last.reason).toBe("unknown_result");
  });

  test("機能OFFの間は投稿せず予約も消えず、ONに戻すと再開する", async () => {
    const h = createHarness();
    const post = await reserve(h, 5);
    await setScheduledPostEnabled(db, guildId, false);

    h.clock.now = new Date(T0.getTime() + minutes(10));
    await runSchedulerTick(h.deps);
    expect(h.sends).toHaveLength(0);
    expect((await statusOf(post.id))?.status).toBe("pending");

    await setScheduledPostEnabled(db, guildId, true);
    await runSchedulerTick(h.deps);
    expect((await statusOf(post.id))?.status).toBe("posted");
  });

  test.each([
    [10003, "channel_deleted"],
    [50013, "bot_missing_permission"],
    [50083, "thread_archived"],
    [undefined, "send_failed"],
  ] as const)("Discord APIエラー(code=%s)でもBotは落ちず、%sとして失敗する", async (code, reason) => {
    const h = createHarness();
    const post = await reserve(h, 5);
    h.failSendWith(Object.assign(new Error("discord error"), { code }));

    h.clock.now = new Date(T0.getTime() + minutes(5));
    await runSchedulerTick(h.deps); // 例外を投げない(投げればテストが失敗する)

    expect((await statusOf(post.id))?.failureReason).toBe(reason);
  });

  test("DMが届かなくても失敗の記録は残り、例外にならない", async () => {
    const h = createHarness();
    const post = await reserve(h, 5);
    h.setFacts({ authorIsMember: false });
    h.failDm();

    h.clock.now = new Date(T0.getTime() + minutes(5));
    await runSchedulerTick(h.deps);

    expect((await statusOf(post.id))?.status).toBe("failed");
    expect(h.events.at(-1)?.action).toBe("failed");
  });

  test("メンションは実行者の権限に応じたallowedMentionsで送られる", async () => {
    const h = createHarness();
    await reserve(h, 5, "<@&111> <@&222> <@123> @everyone");
    h.inspection.isRoleMentionable = (roleId) => roleId === "111";

    h.clock.now = new Date(T0.getTime() + minutes(5));
    await runSchedulerTick(h.deps);

    expect(h.sends[0]?.mentions).toEqual({ parse: ["users"], roles: ["111"] });
  });

  test("MentionEveryone権限を持つ実行者の投稿はeveryone・ロールを許可する", async () => {
    const h = createHarness();
    await reserve(h, 5, "@everyone");
    h.inspection.canMentionEveryone = true;

    h.clock.now = new Date(T0.getTime() + minutes(5));
    await runSchedulerTick(h.deps);

    expect(h.sends[0]?.mentions.parse).toEqual(["users", "roles", "everyone"]);
  });

  test("管理者のDashboard取り消しは、cancelledイベント(by=admin、実行者付き)を発行し予約者へDMする", async () => {
    const h = createHarness();
    const post = await reserve(h, 30);
    const row = await cancelScheduledPost(db, { id: post.id, by: "admin", guildId, now: T0 });
    expect(row?.cancelledBy).toBe("admin");

    const sentDms: { userId: string; text: string }[] = [];
    await handleAdminCancelNotification(
      {
        ...h.deps,
        discord: {
          channelName: () => "general",
          authorName: () => "ゆずき",
          sendDm: async (userId, text) => {
            sentDms.push({ userId, text });
          },
        },
      },
      { guildId, postId: post.id, executorId: "admin-1", executorName: "管理者" },
    );

    const last = h.events.at(-1);
    expect(last?.action).toBe("cancelled");
    if (last?.action !== "cancelled") throw new Error("expected cancelled event");
    expect(last.by).toBe("admin");
    expect(last.executorId).toBe("admin-1");
    expect(sentDms.map((d) => d.userId)).toEqual(["u1"]);
    expect(sentDms[0]?.text).toContain("管理者によって取り消されました");
  });

  test("管理者取り消しの通知は、DMが届かなくても例外にならず、別ギルドの予約は処理しない", async () => {
    const h = createHarness();
    const post = await reserve(h, 30);
    await cancelScheduledPost(db, { id: post.id, by: "admin", guildId, now: T0 });
    const discord = {
      channelName: () => undefined,
      authorName: () => undefined,
      sendDm: async () => {
        throw new Error("DM closed");
      },
    };

    await handleAdminCancelNotification({ ...h.deps, discord }, { guildId, postId: post.id, executorId: "admin-1" });
    const before = h.events.length;
    await handleAdminCancelNotification({ ...h.deps, discord }, { guildId: "other-guild", postId: post.id, executorId: "admin-1" });
    expect(h.events).toHaveLength(before);
  });

  test("createSchedulerは起動時にposting残留を回復し、tickで期限の来た予約を投稿し、stopで止まる", async () => {
    const h = createHarness();
    const stuck = await reserve(h, 1, "残留");
    const due = await reserve(h, 2, "期限到来");
    await db.update(scheduledPosts).set({ status: "posting", updatedAt: T0 }).where(eq(scheduledPosts.id, stuck.id));

    h.clock.now = new Date(T0.getTime() + minutes(10));
    const scheduler = createScheduler(h.deps, 20);
    await scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await scheduler.stop();

    expect((await statusOf(stuck.id))?.failureReason).toBe("unknown_result");
    expect((await statusOf(due.id))?.status).toBe("posted");
    expect(h.sends.map((s) => s.content)).toEqual(["期限到来"]);

    // stop後はtickが走らない。
    const late = await reserve(h, 3, "停止後");
    h.clock.now = new Date(T0.getTime() + minutes(10));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await statusOf(late.id))?.status).toBe("pending");
  });
});
