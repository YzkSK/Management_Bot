import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  createDb,
  type Db,
  guilds,
  moderationEscalationState,
  moderationNgwords,
  moderationThresholds,
} from "@management-bot/db";
import type { ModerationActionRecordedEvent } from "@management-bot/shared";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import type { Message } from "discord.js";
import { createModerationConfigCache } from "../application/index.js";
import { addNgword } from "../application/ngwords.js";
import { setEscalationPreset } from "../application/escalation-settings.js";
import { handleMessageCreate } from "./handle-message-create.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

async function isRedisAvailable(): Promise<boolean> {
  const probe = new Redis(REDIS_URL, { retryStrategy: () => null, lazyConnect: true });
  try {
    await probe.connect();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

/** 自Bot自身のユーザーID(client.user.id)の固定値。他テストのuserIdとは常に異なる。 */
const SELF_BOT_ID = "self-bot-id";

function fakeMessage(overrides: {
  guildId: string;
  userId: string;
  content: string;
  channelId?: string;
  bot?: boolean;
  hasGuild?: boolean;
  hasMember?: boolean;
  /** timeout()がDiscord APIエラーで失敗するケースを再現する(#350の処罰失敗パス検証用)。 */
  timeoutRejects?: boolean;
  /** client.userが未確定(ログイン処理中等)の状況を再現する(#377、fail-closedの回帰テスト用)。 */
  clientUserUndefined?: boolean;
}) {
  const deleteFn = mock(() => Promise.resolve());
  const bulkDelete = mock(() => Promise.resolve());
  const timeout = overrides.timeoutRejects
    ? mock(() => Promise.reject(new Error("Missing Permissions")))
    : mock(() => Promise.resolve());
  const kick = mock(() => Promise.resolve());
  const ban = mock(() => Promise.resolve());
  const send = mock(() => Promise.resolve());
  return {
    author: { id: overrides.userId, bot: overrides.bot ?? false, send },
    guild: overrides.hasGuild === false ? null : { id: overrides.guildId },
    member: overrides.hasMember === false ? null : { roles: { cache: new Map() }, timeout, kick, ban },
    client: { user: overrides.clientUserUndefined ? undefined : { id: SELF_BOT_ID } },
    id: randomUUID(),
    channelId: overrides.channelId ?? "channel-1",
    content: overrides.content,
    createdAt: new Date(),
    delete: deleteFn,
    deleteFn,
    channel: { bulkDelete },
    bulkDelete,
    timeout,
    kick,
    ban,
    send,
  };
}

describe.skipIf(!(await isRedisAvailable()))("handleMessageCreate", () => {
  let db: Db;
  let close: () => Promise<void>;
  const redis = new Redis(REDIS_URL);
  const guildId = `test-guild-${randomUUID()}`;
  /**
   * configCacheはguild単位でTTLキャッシュするため(#352)、テスト間で使い回すと前のテストの
   * DB設定がキャッシュに残り、afterEachでDB削除しても次のテストに漏れ残る。
   * beforeEachでテストごとに新規生成し、1テスト内の複数呼び出し(deps())では共有する。
   */
  let configCache: ReturnType<typeof createModerationConfigCache>;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    ({ db, close } = createDb(databaseUrl));
    await db.insert(guilds).values({ id: guildId, name: "Test Guild" });
  });

  beforeEach(() => {
    configCache = createModerationConfigCache();
  });

  afterAll(async () => {
    await db.delete(guilds).where(eq(guilds.id, guildId));
    await close();
    redis.disconnect();
  });

  afterEach(async () => {
    await db.delete(moderationThresholds).where(eq(moderationThresholds.guildId, guildId));
    await db.delete(moderationEscalationState).where(eq(moderationEscalationState.guildId, guildId));
    await db.delete(moderationNgwords).where(eq(moderationNgwords.guildId, guildId));
    const keys = await redis.keys(`moderation:*:${guildId}:*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  function fakeEventBus() {
    const published: ModerationActionRecordedEvent[] = [];
    return { published, publish: async (event: ModerationActionRecordedEvent) => void published.push(event) };
  }

  /** invite_link以外のテストでは呼ばれない想定のダミー実装(常に自ギルド扱い)。 */
  const resolveInviteGuildId = async (): Promise<string | null> => guildId;

  function deps(
    eventBus: ReturnType<typeof fakeEventBus>,
    overrides: Partial<Parameters<typeof handleMessageCreate>[0]> = {},
  ) {
    return { db, redis, eventBus, resolveInviteGuildId, configCache, ...overrides };
  }

  test("自Bot自身のメッセージは無視する(改善案7.2節)", async () => {
    const eventBus = fakeEventBus();
    const message = fakeMessage({ guildId, userId: SELF_BOT_ID, content: "hi", bot: true });
    await handleMessageCreate(deps(eventBus), message as unknown as Message);
    expect(eventBus.published).toEqual([]);
  });

  test("client.userが未確定の場合は何も検知しない(fail-closed、Codexレビュー指摘の回帰テスト)", async () => {
    const eventBus = fakeEventBus();
    await db.insert(moderationThresholds).values({ guildId, violationType: "ngword", preset: "medium", enabled: true });
    await addNgword(db, guildId, "exact", "banned-word");

    const message = fakeMessage({
      guildId,
      userId: `u-${randomUUID()}`,
      content: "banned-word",
      clientUserUndefined: true,
    });
    await handleMessageCreate(deps(eventBus), message as unknown as Message);

    expect(eventBus.published).toEqual([]);
  });

  test("他Bot・Webhookのメッセージ(自Bot以外)は通常のユーザー投稿と同様に検知対象になる(改善案7.2節)", async () => {
    const userId = `bot-${randomUUID()}`;
    await db.insert(moderationThresholds).values({ guildId, violationType: "ngword", preset: "medium", enabled: true });
    await addNgword(db, guildId, "exact", "banned-word");

    const eventBus = fakeEventBus();
    const message = fakeMessage({ guildId, userId, content: "banned-word", bot: true });
    await handleMessageCreate(deps(eventBus), message as unknown as Message);

    expect(eventBus.published).toHaveLength(2);
    expect(eventBus.published[1]).toMatchObject({ action: "resolve", result: "success" });
    expect(message.deleteFn).toHaveBeenCalledTimes(1);
  });

  test("Webhook投稿(memberなし)が違反検知された場合、timeout等の処罰はmember_not_foundで失敗するが削除は実行される(改善案7.2節)", async () => {
    const userId = `webhook-${randomUUID()}`;
    // strong preset: strikeCount=2でtimeout(改善案7.2節、Webhookはmemberを持たないためtimeout不可)。
    await db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "strong", enabled: true });
    await setEscalationPreset(db, guildId, "strong");
    await db.insert(moderationEscalationState).values({ guildId, userId, violationType: "flood", strikeCount: 1 });

    const eventBus = fakeEventBus();
    let last: ReturnType<typeof fakeMessage> | undefined;
    for (let i = 0; i < 3; i++) {
      last = fakeMessage({ guildId, userId, content: `msg-${i}`, bot: true, hasMember: false });
      await handleMessageCreate(deps(eventBus), last as unknown as Message);
    }

    expect(eventBus.published).toHaveLength(2);
    expect(eventBus.published[1]).toMatchObject({
      action: "resolve",
      actionType: "timeout",
      result: "failed",
      failureCode: "member_not_found",
    });
    // deleteBufferedMessagesSafely自体はmember不要のため実行される。
    expect(last?.bulkDelete).toHaveBeenCalledTimes(1);
  });

  test("guild/memberがないメッセージ(DM等)は無視する", async () => {
    const eventBus = fakeEventBus();
    const message = fakeMessage({ guildId, userId: `u-${randomUUID()}`, content: "hi", hasGuild: false });
    await handleMessageCreate(deps(eventBus), message as unknown as Message);
    expect(eventBus.published).toEqual([]);
  });

  test("連投でstrong presetの閾値に達するとバッファ済みメッセージの削除が実行される", async () => {
    const userId = `u-${randomUUID()}`;
    await db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "strong", enabled: true });
    await setEscalationPreset(db, guildId, "strong");

    const eventBus = fakeEventBus();
    let last: ReturnType<typeof fakeMessage> | undefined;
    for (let i = 0; i < 3; i++) {
      last = fakeMessage({ guildId, userId, content: `msg-${i}` });
      await handleMessageCreate(deps(eventBus), last as unknown as Message);
    }

    expect(last?.bulkDelete).toHaveBeenCalledTimes(1);
    // create(処罰予定)→resolve(実行結果)の2段階でpublishされる(#350)。
    expect(eventBus.published).toHaveLength(2);
    expect(eventBus.published[0]).toMatchObject({ action: "create" });
    expect(eventBus.published[1]).toMatchObject({ action: "resolve", result: "success" });
  });

  test("Discord API(timeout)がエラーで失敗した場合、resolveイベントはresult=failedでpublishされる(#350)", async () => {
    const userId = `u-${randomUUID()}`;
    // strong preset: ESCALATION_STEPS.strong[2]=timeout(5分)。strikeCountを1でseedし、
    // 1件目のflood検知で合計2に到達させてtimeoutを引き当てる。
    await db.insert(moderationThresholds).values({ guildId, violationType: "flood", preset: "strong", enabled: true });
    await setEscalationPreset(db, guildId, "strong");
    await db.insert(moderationEscalationState).values({ guildId, userId, violationType: "flood", strikeCount: 1 });

    const eventBus = fakeEventBus();
    let last: ReturnType<typeof fakeMessage> | undefined;
    for (let i = 0; i < 3; i++) {
      last = fakeMessage({ guildId, userId, content: `msg-${i}`, timeoutRejects: true });
      await handleMessageCreate(deps(eventBus), last as unknown as Message);
    }

    expect(eventBus.published).toHaveLength(2);
    expect(eventBus.published[0]).toMatchObject({ action: "create", actionType: "timeout" });
    expect(eventBus.published[1]).toMatchObject({
      action: "resolve",
      actionType: "timeout",
      result: "failed",
      failureCode: "discord_api_error",
    });
  });

  test("flood/duplicate_contentが同時にヒットしても、それぞれ同一バースト中は1回しかstrikeが進まない", async () => {
    const userId = `u-${randomUUID()}`;
    // flood: strong(windowSeconds=8, messageThreshold=3) / duplicate_content: strong(閾値0.85, strike1でwarn)
    await db.insert(moderationThresholds).values([
      { guildId, violationType: "flood", preset: "strong", enabled: true },
      { guildId, violationType: "duplicate_content", preset: "strong", enabled: true },
    ]);
    await setEscalationPreset(db, guildId, "strong");

    const eventBus = fakeEventBus();
    const content = "spam spam spam";
    let last: ReturnType<typeof fakeMessage> | undefined;
    for (let i = 0; i < 3; i++) {
      last = fakeMessage({ guildId, userId, content });
      await handleMessageCreate(deps(eventBus), last as unknown as Message);
    }

    // 2件目: duplicate_content(合計strikeCount=1)がヒットしESCALATION_STEPS.strong[1]=warn。
    // 以降8秒間はduplicate_contentのロックを保持。
    // 3件目: flood(合計strikeCount=2、duplicate_content分と合わせた統一カウンター、#311)がヒットし
    // ESCALATION_STEPS.strong[2]=timeoutに到達する。duplicate_contentも閾値には達し続けるが、
    // 同一バースト中(ロック保持中)のためstrikeは進まずイベントもpublishされない。
    // timeout実行時もdeleteBufferedMessagesSafely経由でバッファの削除は必ず行われる。
    // create×2(warn, timeout)→実際にDiscord APIへ実行されるのはmostSevere(timeout)の1回のみ。
    // 2件目のwarnと3件目のtimeoutは別のmessageCreateイベントで実行されるため、
    // どちらもresult="success"でresolveされる。result="skipped"になるのは同一イベントで
    // 複数outcomeが同時にヒットした場合のみ。
    expect(eventBus.published).toHaveLength(4);
    expect(eventBus.published.filter((e) => e.action === "create")).toHaveLength(2);
    const resolves = eventBus.published.filter((e) => e.action === "resolve");
    expect(resolves).toHaveLength(2);
    expect(resolves.filter((e) => e.action === "resolve" && e.result === "success")).toHaveLength(2);
    expect(resolves.filter((e) => e.action === "resolve" && e.result === "skipped")).toHaveLength(0);
    expect(last?.bulkDelete).toHaveBeenCalledTimes(1);
    expect(last?.timeout).toHaveBeenCalledTimes(1);
  });

  test("同一メッセージでflood(timeout)とduplicate_content(kick)が同時にヒットした場合、処罰はより重い方に集約されるがメッセージ削除は必ず実行される", async () => {
    const userId = `u-${randomUUID()}`;
    // flood: strong(windowSeconds=8, messageThreshold=3) / duplicate_content: strong(閾値0.85)
    await db.insert(moderationThresholds).values([
      { guildId, violationType: "flood", preset: "strong", enabled: true },
      { guildId, violationType: "duplicate_content", preset: "strong", enabled: true },
    ]);
    await setEscalationPreset(db, guildId, "strong");
    // duplicate_contentのstrikeCountを3でseedしておく(統一ストライクカウンター、#311)。
    // ESCALATION_STEPS.strong = {1: warn, 2: timeout5m, 3: timeout10m, 4: timeout30m, 5: kick, 6: ban}
    // (タイムアウトの多段階化、#322)。3件目で新バーストとしてflood/duplicate_contentが
    // 同時ヒットする際、処理順(スレッショルド登録順: flood→duplicate_content)で
    // 合計strikeCountが積み上がる:
    //   flood加算後の合計 = flood(1) + duplicate_content(3,seed) = 4 → ESCALATION_STEPS.strong[4]=timeout(30分)
    //   duplicate_content加算後の合計 = flood(1) + duplicate_content(4) = 5 → ESCALATION_STEPS.strong[5]=kick
    await db.insert(moderationEscalationState).values({
      guildId,
      userId,
      violationType: "duplicate_content",
      strikeCount: 3,
    });

    const eventBus = fakeEventBus();
    let last: ReturnType<typeof fakeMessage> | undefined;
    for (const content of ["A", "B", "B"]) {
      last = fakeMessage({ guildId, userId, content });
      await handleMessageCreate(deps(eventBus), last as unknown as Message);
    }

    // 3件目: floodがtimeout(合計4)、duplicate_content("B"が2連続)がkick(合計5)に到達。
    // moderation.action.recordedのcreateは両方publishされるが、Discord側の処罰実行はより重いkickに
    // 集約される(mostSevere)。kick側はresult="success"でresolveされ、集約されなかったtimeout側も
    // result="skipped"でresolveされる(未解決のまま残さないため、#350)。
    // バッファ済みメッセージの削除は処罰の集約とは関係なく実行される
    // (連投メッセージが削除されずに残らないようにするため)。
    expect(eventBus.published).toHaveLength(4);
    expect(eventBus.published.filter((e) => e.action === "create")).toHaveLength(2);
    const resolves = eventBus.published.filter((e) => e.action === "resolve");
    expect(resolves).toHaveLength(2);
    expect(resolves.filter((e) => e.action === "resolve" && e.result === "success")).toHaveLength(1);
    expect(resolves.filter((e) => e.action === "resolve" && e.result === "skipped")).toHaveLength(1);
    expect(last?.kick).toHaveBeenCalledTimes(1);
    expect(last?.timeout).not.toHaveBeenCalled();
    expect(last?.bulkDelete).toHaveBeenCalledTimes(1);
  });

  test("NGワードに一致するメッセージは検知され、そのメッセージ自身が削除される", async () => {
    const userId = `u-${randomUUID()}`;
    await db.insert(moderationThresholds).values({ guildId, violationType: "ngword", preset: "medium", enabled: true });
    await addNgword(db, guildId, "exact", "banned-word");

    const eventBus = fakeEventBus();
    const message = fakeMessage({ guildId, userId, content: "banned-word" });
    await handleMessageCreate(deps(eventBus), message as unknown as Message);

    expect(eventBus.published).toHaveLength(2);
    expect(eventBus.published[1]).toMatchObject({ action: "resolve", result: "success" });
    expect(message.deleteFn).toHaveBeenCalledTimes(1);
    expect(message.bulkDelete).not.toHaveBeenCalled();
  });

  test("1メッセージ内の大量メンションはmention_spamとして検知され、そのメッセージ自身が削除される", async () => {
    const userId = `u-${randomUUID()}`;
    await db
      .insert(moderationThresholds)
      .values({ guildId, violationType: "mention_spam", preset: "medium", enabled: true });

    const eventBus = fakeEventBus();
    const mentions = Array.from({ length: 6 }, (_, i) => `<@${i}>`).join(" ");
    const message = fakeMessage({ guildId, userId, content: mentions });
    await handleMessageCreate(deps(eventBus), message as unknown as Message);

    expect(eventBus.published).toHaveLength(2);
    expect(eventBus.published[1]).toMatchObject({ action: "resolve", result: "success" });
    expect(message.deleteFn).toHaveBeenCalledTimes(1);
    expect(message.bulkDelete).not.toHaveBeenCalled();
  });

  test("他ギルドへの招待リンクは検知され、そのメッセージ自身が削除される", async () => {
    const userId = `u-${randomUUID()}`;
    await db
      .insert(moderationThresholds)
      .values({ guildId, violationType: "invite_link", preset: "medium", enabled: true });

    const eventBus = fakeEventBus();
    const message = fakeMessage({ guildId, userId, content: "join us: discord.gg/other-guild-code" });
    await handleMessageCreate(
      deps(eventBus, { resolveInviteGuildId: async () => "other-guild-id" }),
      message as unknown as Message,
    );

    expect(eventBus.published).toHaveLength(2);
    expect(eventBus.published[1]).toMatchObject({ action: "resolve", result: "success" });
    expect(message.deleteFn).toHaveBeenCalledTimes(1);
    expect(message.bulkDelete).not.toHaveBeenCalled();
  });

  test("自ギルドへの招待リンクは検知されず、メッセージは削除されない", async () => {
    const userId = `u-${randomUUID()}`;
    await db
      .insert(moderationThresholds)
      .values({ guildId, violationType: "invite_link", preset: "medium", enabled: true });

    const eventBus = fakeEventBus();
    const message = fakeMessage({ guildId, userId, content: "join us: discord.gg/own-guild-code" });
    await handleMessageCreate(
      deps(eventBus, { resolveInviteGuildId: async () => guildId }),
      message as unknown as Message,
    );

    expect(eventBus.published).toEqual([]);
    expect(message.deleteFn).not.toHaveBeenCalled();
  });

  test("strikeロック中(10秒以内)の連続NGワード投稿は、strike加算やDM通知なしで2件目のメッセージ自身が削除される(#338)", async () => {
    const userId = `u-${randomUUID()}`;
    await db.insert(moderationThresholds).values({ guildId, violationType: "ngword", preset: "medium", enabled: true });
    await addNgword(db, guildId, "exact", "banned-word");

    const eventBus = fakeEventBus();
    const first = fakeMessage({ guildId, userId, content: "banned-word" });
    await handleMessageCreate(deps(eventBus), first as unknown as Message);
    const second = fakeMessage({ guildId, userId, content: "banned-word" });
    await handleMessageCreate(deps(eventBus), second as unknown as Message);

    expect(eventBus.published).toHaveLength(2);
    expect(first.deleteFn).toHaveBeenCalledTimes(1);
    expect(first.send).toHaveBeenCalledTimes(1);
    expect(second.deleteFn).toHaveBeenCalledTimes(1);
    expect(second.send).not.toHaveBeenCalled();
  });

  test("strikeロック中(10秒以内)の連続メンションスパム投稿は、strike加算やDM通知なしで2件目のメッセージ自身が削除される(#338)", async () => {
    const userId = `u-${randomUUID()}`;
    await db
      .insert(moderationThresholds)
      .values({ guildId, violationType: "mention_spam", preset: "medium", enabled: true });

    const eventBus = fakeEventBus();
    const mentions = Array.from({ length: 6 }, (_, i) => `<@${i}>`).join(" ");
    const first = fakeMessage({ guildId, userId, content: mentions });
    await handleMessageCreate(deps(eventBus), first as unknown as Message);
    const second = fakeMessage({ guildId, userId, content: mentions });
    await handleMessageCreate(deps(eventBus), second as unknown as Message);

    expect(eventBus.published).toHaveLength(2);
    expect(first.deleteFn).toHaveBeenCalledTimes(1);
    expect(second.deleteFn).toHaveBeenCalledTimes(1);
    expect(second.send).not.toHaveBeenCalled();
  });

  test("strikeロック中(10秒以内)の連続招待リンク投稿は、strike加算やDM通知なしで2件目のメッセージ自身が削除される(#338)", async () => {
    const userId = `u-${randomUUID()}`;
    await db
      .insert(moderationThresholds)
      .values({ guildId, violationType: "invite_link", preset: "medium", enabled: true });

    const eventBus = fakeEventBus();
    const content = "join us: discord.gg/other-guild-code";
    const first = fakeMessage({ guildId, userId, content });
    await handleMessageCreate(
      deps(eventBus, { resolveInviteGuildId: async () => "other-guild-id" }),
      first as unknown as Message,
    );
    const second = fakeMessage({ guildId, userId, content });
    await handleMessageCreate(
      deps(eventBus, { resolveInviteGuildId: async () => "other-guild-id" }),
      second as unknown as Message,
    );

    expect(eventBus.published).toHaveLength(2);
    expect(first.deleteFn).toHaveBeenCalledTimes(1);
    expect(second.deleteFn).toHaveBeenCalledTimes(1);
    expect(second.send).not.toHaveBeenCalled();
  });

  test("招待コード解決失敗時は安全側(検知扱い)に倒れ、メッセージが削除される", async () => {
    const userId = `u-${randomUUID()}`;
    await db
      .insert(moderationThresholds)
      .values({ guildId, violationType: "invite_link", preset: "medium", enabled: true });

    const eventBus = fakeEventBus();
    const message = fakeMessage({ guildId, userId, content: "join us: discord.gg/unresolvable-code" });
    await handleMessageCreate(
      deps(eventBus, { resolveInviteGuildId: async () => null }),
      message as unknown as Message,
    );

    expect(eventBus.published).toHaveLength(2);
    expect(message.deleteFn).toHaveBeenCalledTimes(1);
  });
});
