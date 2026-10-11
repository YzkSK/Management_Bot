import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDb, guilds, scheduledPosts, syncFeatureMetadata } from "@management-bot/db";
import type { ScheduledPostEventRecordedEvent } from "@management-bot/shared";
import { eq } from "drizzle-orm";
import { cancelScheduledPost, getSettings, saveSettings } from "../application/index.js";
import type { MentionMessage, MentionSelection, PostFacts } from "../domain/index.js";
import { handleAdminCancelNotification, processPendingAdminCancels } from "./dashboard-action-listener.js";
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
  sends: { channelId: string; content: string; view: PostView; mention: MentionMessage }[];
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
    send: async (post, view, mention) => {
      if (sendError) throw sendError;
      sends.push({ channelId: post.channelId, content: post.content, view, mention });
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

async function reserve(h: Harness, scheduledAtOffsetMin: number, content = "こんにちは", mentions?: MentionSelection) {
  const result = await createPostAction(h.deps, {
    guildId,
    channelId: "c1",
    channelName: "general",
    authorId: "u1",
    authorName: "ゆずき",
    content,
    scheduledAt: new Date(T0.getTime() + minutes(scheduledAtOffsetMin)),
    mentions,
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
    await saveSettings(db, guildId, { ...(await getSettings(db, guildId)), allowedRoleIds: ["role-b"] });

    h.clock.now = new Date(T0.getTime() + minutes(5));
    await runSchedulerTick(h.deps);

    expect((await statusOf(post.id))?.failureReason).toBe("no_role");
    expect(h.sends).toHaveLength(0);
  });

  test("使えるロールを予約者が持っていれば投稿できる", async () => {
    const h = createHarness();
    const post = await reserve(h, 5);
    await saveSettings(db, guildId, { ...(await getSettings(db, guildId)), allowedRoleIds: ["role-a"] });

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

  const allMentions: MentionSelection = { everyone: true, here: true, roleIds: ["111", "222"], userIds: ["123"] };

  test("メンション付き予約は、contentにメンション行・allowedMentionsを明示して投稿される", async () => {
    const h = createHarness();
    await saveSettings(db, guildId, { allowedRoleIds: [], allowEveryone: true, allowHere: true });
    await reserve(h, 5, "本文", allMentions);
    h.inspection.canMentionEveryone = true;

    h.clock.now = new Date(T0.getTime() + minutes(5));
    await runSchedulerTick(h.deps);

    expect(h.sends[0]?.mention).toEqual({
      content: "@everyone @here <@&111> <@&222> <@123>",
      allowedMentions: { parse: ["everyone"], roles: ["111", "222"], users: ["123"] },
    });
  });

  test("投稿時に権限・設定を失っていたら、許されない分だけ除外して投稿を続行する", async () => {
    const h = createHarness();
    await saveSettings(db, guildId, { allowedRoleIds: [], allowEveryone: true, allowHere: true });
    const post = await reserve(h, 5, "本文", allMentions);
    // 登録後に@hereが不許可になり、実行者もMentionEveryoneを失った(111のみmentionable)。
    await saveSettings(db, guildId, { allowedRoleIds: [], allowEveryone: true, allowHere: false });
    h.inspection.canMentionEveryone = false;
    h.inspection.isRoleMentionable = (roleId) => roleId === "111";

    h.clock.now = new Date(T0.getTime() + minutes(5));
    await runSchedulerTick(h.deps);

    expect((await statusOf(post.id))?.status).toBe("posted");
    expect(h.sends[0]?.mention).toEqual({
      content: "<@&111> <@123>",
      allowedMentions: { parse: [], roles: ["111"], users: ["123"] },
    });
  });

  test("メンション指定がない予約はcontentなしで投稿される", async () => {
    const h = createHarness();
    await reserve(h, 5);

    h.clock.now = new Date(T0.getTime() + minutes(5));
    await runSchedulerTick(h.deps);

    expect(h.sends[0]?.mention).toEqual({ content: undefined, allowedMentions: { parse: [], roles: [], users: [] } });
  });

  test("管理者のDashboard取り消しは、cancelledイベント(by=admin、実行者付き)を発行し予約者へDMする", async () => {
    const h = createHarness();
    const post = await reserve(h, 30);
    const row = await cancelScheduledPost(db, {
      id: post.id,
      by: "admin",
      guildId,
      executor: { id: "admin-1", name: "管理者" },
      now: T0,
    });
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
      { guildId, postId: post.id },
    );

    const last = h.events.at(-1);
    expect(last?.action).toBe("cancelled");
    if (last?.action !== "cancelled") throw new Error("expected cancelled event");
    expect(last.by).toBe("admin");
    expect(last.executorId).toBe("admin-1");
    expect(last.executorName).toBe("管理者");
    expect(sentDms.map((d) => d.userId)).toEqual(["u1"]);
    expect(sentDms[0]?.text).toContain("管理者によって取り消されました");
  });

  test("同じ管理者取り消しを並行で2回handleしても、DM・ログイベントは1回だけ", async () => {
    const h = createHarness();
    const post = await reserve(h, 30);
    await cancelScheduledPost(db, { id: post.id, by: "admin", guildId, executor: { id: "admin-1" }, now: T0 });
    const sentDms: string[] = [];
    const deps = {
      ...h.deps,
      discord: {
        channelName: () => "general",
        authorName: () => "ゆずき",
        sendDm: async (userId: string) => {
          sentDms.push(userId);
        },
      },
    };
    const before = h.events.length;

    await Promise.all([
      handleAdminCancelNotification(deps, { guildId, postId: post.id }),
      handleAdminCancelNotification(deps, { guildId, postId: post.id }),
    ]);

    expect(sentDms).toEqual(["u1"]);
    expect(h.events).toHaveLength(before + 1);
  });

  test("pg_notifyを受け取れなかった管理者取り消しは、tickの回収で1回だけ処理される", async () => {
    const h = createHarness();
    const post = await reserve(h, 30);
    await cancelScheduledPost(db, { id: post.id, by: "admin", guildId, executor: { id: "admin-1", name: "管理者" }, now: T0 });
    const sentDms: string[] = [];
    const adminCancel = {
      channelName: () => "general",
      authorName: () => "ゆずき",
      sendDm: async (userId: string) => {
        sentDms.push(userId);
      },
    };
    const before = h.events.length;

    await processPendingAdminCancels({ ...h.deps, discord: adminCancel });
    await processPendingAdminCancels({ ...h.deps, discord: adminCancel });

    expect(sentDms).toEqual(["u1"]);
    expect(h.events).toHaveLength(before + 1);
    const last = h.events.at(-1);
    if (last?.action !== "cancelled") throw new Error("expected cancelled event");
    expect(last.executorId).toBe("admin-1");
    expect((await statusOf(post.id))?.cancelNotifiedAt).not.toBeNull();
  });

  test("createSchedulerのtickは未処理の管理者取り消しを回収する", async () => {
    const h = createHarness();
    const post = await reserve(h, 30);
    await cancelScheduledPost(db, { id: post.id, by: "admin", guildId, executor: { id: "admin-1" }, now: T0 });
    const sentDms: string[] = [];
    const scheduler = createScheduler(
      {
        ...h.deps,
        adminCancel: {
          channelName: () => undefined,
          authorName: () => undefined,
          sendDm: async (userId) => {
            sentDms.push(userId);
          },
        },
      },
      20,
    );
    await scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await scheduler.stop();

    expect(sentDms).toEqual(["u1"]);
  });

  test("本人取り消し(by=author)は管理者取り消しの回収対象にならない", async () => {
    const h = createHarness();
    const post = await reserve(h, 30);
    await cancelScheduledPost(db, { id: post.id, by: "author", guildId, authorId: "u1", now: T0 });
    const sentDms: string[] = [];
    const before = h.events.length;

    await processPendingAdminCancels({
      ...h.deps,
      discord: {
        channelName: () => undefined,
        authorName: () => undefined,
        sendDm: async (userId) => {
          sentDms.push(userId);
        },
      },
    });

    expect(sentDms).toEqual([]);
    expect(h.events).toHaveLength(before);
    expect((await statusOf(post.id))?.cancelNotifiedAt).toBeNull();
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

    await handleAdminCancelNotification({ ...h.deps, discord }, { guildId, postId: post.id });
    const before = h.events.length;
    await handleAdminCancelNotification({ ...h.deps, discord }, { guildId: "other-guild", postId: post.id });
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
