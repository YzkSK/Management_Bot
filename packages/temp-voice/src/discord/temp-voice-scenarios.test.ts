import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDb, guilds, tempVoiceChannels, tempVoiceConfigs, tempVoicePermissionOverrides } from "@management-bot/db";
import { tempVoiceEventRecordedSchema, type TempVoiceEventRecordedEvent } from "@management-bot/shared";
import { ChannelType, Collection, DiscordAPIError, PermissionFlagsBits, RESTJSONErrorCodes } from "discord.js";
import { eq } from "drizzle-orm";
import {
  findTempVoiceChannel,
  insertTempVoiceChannel,
  listActiveTempVoiceChannels,
  replaceDenyProtectedRoles,
} from "../application/index.js";
import { handleTempVoiceButton } from "./handle-button.js";
import { EmptyChannelDeletionScheduler, handleEmptyChannel } from "./handle-empty-channel.js";
import { handleTempVoiceModalSubmit } from "./handle-modal-submit.js";
import { handleOwnerGrace } from "./handle-owner-grace.js";
import { handleTempVoiceRemoveMember } from "./handle-remove-member.js";
import { handleTempVoiceSelectMenu } from "./handle-select-menu.js";
import { handleVoiceSession } from "./handle-voice-session.js";
import { handleForceDeleteNotification } from "./dashboard-action-listener.js";
import { reconcileGuild } from "./reconcile.js";
import { createGraceRunner } from "./run-grace.js";
import { syncTempVoiceMemberCount } from "./sync-member-count.js";
import { handleVoiceCreate } from "./voice-create.js";
import { VoiceSessionStore } from "./voice-session-store.js";

/**
 * 一時VC機能(#405)全体を通した複合シナリオテスト(#416)。
 * 各ハンドラを個別に呼ぶ単体テストと異なり、テスト用PostgreSQL上の実DBと、入退室・権限評価を
 * 再現する簡易なDiscordギルドのfake(FakeWorld)を組み合わせ、「入室→作成→操作→退室→削除/再割当」
 * までをdiscord/index.tsと同じ順序でハンドラを連鎖させて検証する。
 * ログ連携はtemp-voice.event.recordedの発行までを対象とし、発行されたイベントがlogging側の
 * 購読スキーマ(tempVoiceEventRecordedSchema)を満たすことで確認する(feature間の直接importは
 * しない方針のため、logging側の書き込みはpackages/logging側のテストに委ねる)。
 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");
const { db, close } = createDb(databaseUrl);

const OWNER_GRACE_PERIOD_MS = 10 * 60 * 1000;
const EMPTY_GRACE_MS = 100;
const BOT_ID = "100000000000000000";

let snowflakeSeq = BigInt(Date.now()) * 1000n;
/** 実際のDiscord ID(snowflake)と同じ桁数のIDを採番する(customIdの100文字制限を実IDと同条件で満たすため)。 */
function snowflake(): string {
  snowflakeSeq += 1n;
  return (snowflakeSeq * 1000n).toString();
}

type PermissionKey = "Connect" | "ViewChannel" | "SendMessages";
type PermissionChanges = Partial<Record<PermissionKey, boolean | null>>;

async function waitFor(condition: () => boolean | Promise<boolean>, label: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function bits(has: bigint) {
  return { has: (bit: bigint) => (has & bit) === bit };
}

/** permissionOverwritesのfake。editの{Key: true/false/null}をallow/denyのビットへ反映する(discord.jsの実挙動に準拠)。 */
class FakeOverwrites {
  private readonly store = new Map<string, { allow: bigint; deny: bigint }>();

  constructor(
    private readonly owner: unknown,
    initial: { id: string; allow?: bigint[]; deny?: bigint[] }[] = [],
  ) {
    for (const entry of initial) {
      this.store.set(entry.id, {
        allow: (entry.allow ?? []).reduce((acc, bit) => acc | bit, 0n),
        deny: (entry.deny ?? []).reduce((acc, bit) => acc | bit, 0n),
      });
    }
  }

  readonly cache = {
    get: (id: string) => {
      const entry = this.store.get(id);
      return entry ? { allow: bits(entry.allow), deny: bits(entry.deny) } : undefined;
    },
  };

  /** Connectの明示設定(allow=true/deny=false/未設定=undefined)を返す。権限評価用。 */
  connectOf(id: string): boolean | undefined {
    const entry = this.store.get(id);
    if (!entry) return undefined;
    if (entry.deny & PermissionFlagsBits.Connect) return false;
    if (entry.allow & PermissionFlagsBits.Connect) return true;
    return undefined;
  }

  edit = mock((id: string, changes: PermissionChanges) => {
    const entry = this.store.get(id) ?? { allow: 0n, deny: 0n };
    for (const [key, value] of Object.entries(changes)) {
      const bit = PermissionFlagsBits[key as PermissionKey];
      entry.allow &= ~bit;
      entry.deny &= ~bit;
      if (value === true) entry.allow |= bit;
      if (value === false) entry.deny |= bit;
    }
    this.store.set(id, entry);
    return Promise.resolve(this.owner);
  });
}

interface FakeMember {
  id: string;
  displayName: string;
  roles: { cache: { has: (roleId: string) => boolean } };
  voice: { channelId: string | null; setChannel: (channel: { id: string }) => Promise<void>; disconnect: () => Promise<void> };
  send: () => Promise<void>;
}

/**
 * 1ギルド分のDiscord状態のfake。入退室はvoiceStateUpdate相当のイベントとしてキューに積み、
 * drain()でdiscord/index.tsと同じハンドラ群へ順に配送する(setChannel/disconnectの結果として
 * 発生する入退室も同じキューに載るため、Discordの非同期なイベント配送順を再現できる)。
 */
class FakeWorld {
  readonly guildId = `test-guild-${randomUUID()}`;
  readonly categoryId = snowflake();
  readonly createChannelId = snowflake();
  readonly channels = new Collection<string, Record<string, unknown>>();
  readonly members = new Collection<string, FakeMember>();
  readonly roles = new Collection<string, { id: string; name: string }>();
  readonly memberRoles = new Map<string, Set<string>>();
  readonly events: TempVoiceEventRecordedEvent[] = [];
  readonly sessionStore = new VoiceSessionStore();
  readonly scheduler = new EmptyChannelDeletionScheduler();
  private readonly queue: { userId: string; from: string | null; to: string | null }[] = [];

  readonly eventBus = {
    publish: (event: { type: string }) => {
      // logging側が購読時に行う検証と同じスキーマで検証しておく(ログ連携の契約確認)。
      if (event.type === "temp-voice.event.recorded") this.events.push(tempVoiceEventRecordedSchema.parse(event));
      return Promise.resolve("0-0");
    },
  };

  readonly guild: Record<string, unknown>;
  readonly client: Record<string, unknown>;

  constructor() {
    this.client = {
      user: { id: BOT_ID },
      channels: { cache: this.channels },
      guilds: { cache: new Collection<string, unknown>(), fetch: () => Promise.reject(new Error("unknown guild")) },
    };
    this.guild = {
      id: this.guildId,
      maximumBitrate: 96_000,
      client: this.client,
      roles: { everyone: { id: this.guildId }, cache: this.roles },
      members: { cache: this.members, me: { id: BOT_ID } },
      channels: {
        cache: this.channels,
        create: (options: {
          name: string;
          type: ChannelType;
          parent?: string;
          userLimit?: number;
          bitrate?: number;
          permissionOverwrites?: { id: string; allow?: bigint[]; deny?: bigint[] }[];
        }) => Promise.resolve(this.addChannel(options.type, options.name, options.parent ?? null, options)),
        fetch: (id: string) => {
          const channel = this.channels.get(id);
          if (channel) return Promise.resolve(channel);
          return Promise.reject(
            new DiscordAPIError(
              { message: "Unknown Channel", code: RESTJSONErrorCodes.UnknownChannel },
              RESTJSONErrorCodes.UnknownChannel,
              404,
              "GET",
              `/channels/${id}`,
              { body: undefined, files: undefined },
            ),
          );
        },
      },
    };
    (this.client.guilds as { cache: Collection<string, unknown> }).cache.set(this.guildId, this.guild);
    this.addChannel(ChannelType.GuildCategory, "一時VC", null, {}, this.categoryId);
    this.addChannel(ChannelType.GuildVoice, "+ VCを作成", this.categoryId, {}, this.createChannelId);
  }

  addChannel(
    type: ChannelType,
    name: string,
    parentId: string | null,
    options: { userLimit?: number; bitrate?: number; permissionOverwrites?: { id: string; allow?: bigint[]; deny?: bigint[] }[] },
    id = snowflake(),
  ): Record<string, unknown> {
    const guildMembers = this.members;
    const channel: Record<string, unknown> = {
      id,
      name,
      type,
      parentId,
      guild: this.guild,
      guildId: this.guildId,
      userLimit: options.userLimit ?? 0,
      bitrate: options.bitrate ?? 64_000,
      get members() {
        return guildMembers.filter((member) => member.voice.channelId === id);
      },
      isVoiceBased: () => type === ChannelType.GuildVoice,
      isTextBased: () => type === ChannelType.GuildText,
      isDMBased: () => false,
      setName: mock((next: string) => {
        channel.name = next;
        return Promise.resolve(channel);
      }),
      setUserLimit: mock((next: number) => {
        channel.userLimit = next;
        return Promise.resolve(channel);
      }),
      setBitrate: mock((next: number) => {
        channel.bitrate = next;
        return Promise.resolve(channel);
      }),
      send: mock(() => Promise.resolve()),
      delete: mock(() => {
        this.channels.delete(id);
        for (const member of this.members.values()) {
          if (member.voice.channelId === id) this.moveLater(member.id, null);
        }
        return Promise.resolve(channel);
      }),
    };
    channel.permissionOverwrites = new FakeOverwrites(channel, options.permissionOverwrites);
    this.channels.set(id, channel);
    return channel;
  }

  addMember(displayName: string, roleIds: string[] = []): FakeMember {
    const id = snowflake();
    this.memberRoles.set(id, new Set(roleIds));
    const member: FakeMember = {
      id,
      displayName,
      roles: { cache: { has: (roleId: string) => this.memberRoles.get(id)?.has(roleId) ?? false } },
      voice: {
        channelId: null,
        setChannel: (channel) => {
          this.moveLater(id, channel.id);
          return Promise.resolve();
        },
        disconnect: () => {
          this.moveLater(id, null);
          return Promise.resolve();
        },
      },
      send: () => Promise.resolve(),
    };
    this.members.set(id, member);
    return member;
  }

  addRole(name: string): string {
    const id = snowflake();
    this.roles.set(id, { id, name });
    return id;
  }

  channel(id: string): Record<string, unknown> & { permissionOverwrites: FakeOverwrites } {
    const channel = this.channels.get(id);
    if (!channel) throw new Error(`channel ${id} does not exist`);
    return channel as Record<string, unknown> & { permissionOverwrites: FakeOverwrites };
  }

  /** Discord側で実際に起きる状態変化(メンバーのchannelId更新)とvoiceStateUpdateの発火予約。 */
  private moveLater(userId: string, to: string | null): void {
    const member = this.members.get(userId);
    if (!member) return;
    const from = member.voice.channelId;
    member.voice.channelId = to;
    this.queue.push({ userId, from, to });
  }

  /**
   * Discordのパーミッション評価(チャンネルoverwrite部分)を再現する。@everyone→ロール(拒否の後に許可)
   * →メンバー個別の順に上書きし、Connectできるかを返す。拒否ならDiscord側で入室自体が弾かれる。
   */
  canConnect(userId: string, channelId: string): boolean {
    const overwrites = this.channel(channelId).permissionOverwrites;
    let allowed = overwrites.connectOf(this.guildId) ?? true;
    const roleStates = [...(this.memberRoles.get(userId) ?? [])].map((roleId) => overwrites.connectOf(roleId));
    if (roleStates.includes(false)) allowed = false;
    if (roleStates.includes(true)) allowed = true;
    return overwrites.connectOf(userId) ?? allowed;
  }

  /** ユーザー操作としての入退室。権限が無ければ入室できずfalseを返す。 */
  async move(userId: string, to: string | null): Promise<boolean> {
    if (to !== null && !this.canConnect(userId, to)) return false;
    this.moveLater(userId, to);
    await this.drain();
    return true;
  }

  private voiceState(userId: string, channelId: string | null) {
    return {
      id: userId,
      channelId,
      channel: channelId ? (this.channels.get(channelId) ?? null) : null,
      guild: this.guild,
      member: this.members.get(userId) ?? null,
    };
  }

  /** キューに積まれたvoiceStateUpdateを、discord/index.tsと同じハンドラ群へ順に配送する。 */
  async drain(): Promise<void> {
    for (let next = this.queue.shift(); next; next = this.queue.shift()) {
      const oldState = this.voiceState(next.userId, next.from) as never;
      const newState = this.voiceState(next.userId, next.to) as never;
      const deps = { db, eventBus: this.eventBus as never, sessionStore: this.sessionStore };
      // discord/index.tsと同じく全ハンドラを待たずに起動してから、完了だけをまとめて待つ
      // (ハンドラ間の実行タイミングを本番と揃え、直列化で不具合を隠さないため)。
      const pending = [
        handleVoiceCreate(deps, newState),
        handleVoiceSession(deps, oldState, newState),
        handleOwnerGrace({ db, gracePeriodMs: OWNER_GRACE_PERIOD_MS }, oldState, newState),
      ];
      handleEmptyChannel({ ...deps, graceMs: EMPTY_GRACE_MS }, this.scheduler, oldState, newState);
      syncTempVoiceMemberCount(deps, oldState, newState);
      await Promise.all(pending);
    }
  }

  interaction(customId: string, user: FakeMember, extra: { values?: string[]; input?: string } = {}) {
    return {
      customId,
      user: { id: user.id, displayName: user.displayName },
      guild: this.guild,
      values: extra.values ?? [],
      fields: { getTextInputValue: () => extra.input ?? "" },
      message: { edit: mock(() => Promise.resolve()) },
      reply: mock(() => Promise.resolve()),
      update: mock(() => Promise.resolve()),
      showModal: mock(() => Promise.resolve()),
      deferUpdate: mock(() => Promise.resolve()),
      editReply: mock(() => Promise.resolve()),
      followUp: mock(() => Promise.resolve()),
    };
  }

  /** 制御パネルのボタン・モーダル・セレクトメニュー操作。操作の結果起きた入退室(kick等)も配送する。 */
  async press(customId: string, user: FakeMember) {
    const interaction = this.interaction(customId, user);
    if (customId.startsWith("temp-voice:removeMember:")) {
      await handleTempVoiceRemoveMember({ db, eventBus: this.eventBus as never }, interaction as never);
    } else {
      await handleTempVoiceButton({ db, eventBus: this.eventBus as never, canRename: () => true }, interaction as never);
    }
    await this.drain();
    return interaction;
  }

  async submitModal(customId: string, user: FakeMember, input: string) {
    const interaction = this.interaction(customId, user, { input });
    await handleTempVoiceModalSubmit({ db, eventBus: this.eventBus as never, tryReserveRenameSlot: () => true }, interaction as never);
    await this.drain();
    return interaction;
  }

  async select(customId: string, user: FakeMember, value: string) {
    const interaction = this.interaction(customId, user, { values: [value] });
    await handleTempVoiceSelectMenu({ db, eventBus: this.eventBus as never }, interaction as never);
    await this.drain();
    return interaction;
  }

  /** 作成用VCへ入室して一時VCを作成し、作成されたVC・制御チャンネルのIDを返す。 */
  async createTempVoice(owner: FakeMember): Promise<{ vcId: string; controlId: string }> {
    await this.move(owner.id, this.createChannelId);
    const row = await db.select().from(tempVoiceChannels).where(eq(tempVoiceChannels.ownerId, owner.id));
    const created = row[0];
    if (!created) throw new Error("temp voice channel was not created");
    return { vcId: created.channelId, controlId: created.controlChannelId };
  }

  actions(): string[] {
    return this.events.map((event) => event.action);
  }
}

let world: FakeWorld;

beforeEach(async () => {
  world = new FakeWorld();
  await db.insert(guilds).values({ id: world.guildId, name: "guild" });
  await db.insert(tempVoiceConfigs).values({
    guildId: world.guildId,
    createChannelId: world.createChannelId,
    categoryId: world.categoryId,
    nameTemplate: "{username}のVC",
    defaultUserLimit: 0,
    defaultBitrate: 64_000,
  });
});

afterEach(async () => {
  world.scheduler.cancelAll();
  await db.delete(guilds).where(eq(guilds.id, world.guildId));
});

afterAll(async () => {
  await close();
});

function panelJson(interaction: { editReply: ReturnType<typeof mock> }): string {
  return JSON.stringify(interaction.editReply.mock.calls.at(-1)?.[0]);
}

describe("一時VC 複合シナリオ", () => {
  test("作成→制御パネル操作(rename→lock→hide→人数制限→音質)→各操作のログイベント発行", async () => {
    const owner = world.addMember("太郎");
    const { vcId, controlId } = await world.createTempVoice(owner);

    expect(owner.voice.channelId).toBe(vcId);
    expect(world.channel(vcId).name).toBe("太郎のVC");
    expect(world.channel(controlId).parentId).toBe(world.categoryId);

    await world.submitModal(`temp-voice:rename:${vcId}`, owner, "作業部屋");
    await world.press(`temp-voice:toggleLock:${vcId}`, owner);
    await world.press(`temp-voice:toggleHide:${vcId}`, owner);
    await world.submitModal(`temp-voice:userLimit:${vcId}`, owner, "5");
    await world.submitModal(`temp-voice:bitrate:${vcId}`, owner, "96");

    const vc = world.channel(vcId);
    expect(vc.name).toBe("作業部屋");
    expect(world.channel(controlId).name).toBe("作業部屋");
    expect(vc.userLimit).toBe(5);
    expect(vc.bitrate).toBe(96_000);
    expect(world.canConnect(world.addMember("通りすがり").id, vcId)).toBe(false);
    // オーナー自身はロック・非表示の影響を受けない(#441)。
    expect(world.canConnect(owner.id, vcId)).toBe(true);

    expect(world.actions()).toEqual(["created", "renamed", "permissionChanged", "permissionChanged", "userLimitChanged", "bitrateChanged"]);
    expect(world.events[1]).toMatchObject({ before: "太郎のVC", after: "作業部屋", executorId: owner.id });
    expect(world.events[2]).toMatchObject({ permission: "connect", allowed: false });
    expect(world.events[3]).toMatchObject({ permission: "view", allowed: false });
    expect(world.events[4]).toMatchObject({ before: 0, after: 5 });
    expect(world.events[5]).toMatchObject({ before: 64_000, after: 96_000 });
  });

  test("オーナー退出→10分猶予→期限切れ→最古参メンバーへ自動再割当→ログイベント発行", async () => {
    const owner = world.addMember("オーナー");
    const veteran = world.addMember("古参");
    const newcomer = world.addMember("新参");
    const { vcId, controlId } = await world.createTempVoice(owner);
    await world.move(veteran.id, vcId);
    await world.move(newcomer.id, vcId);

    const leftAt = Date.now();
    await world.move(owner.id, null);

    const graced = await findTempVoiceChannel(db, vcId);
    expect(graced?.ownerId).toBe(owner.id);
    const [graceRow] = await db.select().from(tempVoiceChannels).where(eq(tempVoiceChannels.channelId, vcId));
    expect(graceRow?.gracePeriodOwnerId).toBe(owner.id);
    expect(graceRow?.gracePeriodEndsAt?.getTime()).toBeGreaterThanOrEqual(leftAt + OWNER_GRACE_PERIOD_MS - 1000);

    // 10分経過した状態を再現する(猶予期限を過去へずらす)。
    await db.update(tempVoiceChannels).set({ gracePeriodEndsAt: new Date(Date.now() - 1000) }).where(eq(tempVoiceChannels.channelId, vcId));
    await createGraceRunner({ db, client: world.client as never, eventBus: world.eventBus as never, sessionStore: world.sessionStore }, () => {}).run();

    const transferred = await findTempVoiceChannel(db, vcId);
    expect(transferred?.ownerId).toBe(veteran.id);
    expect(world.channel(controlId).permissionOverwrites.cache.get(veteran.id)?.allow.has(PermissionFlagsBits.ViewChannel)).toBe(true);
    expect(world.channel(controlId).permissionOverwrites.cache.get(owner.id)?.allow.has(PermissionFlagsBits.ViewChannel)).toBe(false);
    expect(world.events.at(-1)).toMatchObject({
      action: "ownerTransferred",
      trigger: "autoGraceExpired",
      previousOwnerId: owner.id,
      newOwnerId: veteran.id,
      newOwnerName: "古参",
    });
  });

  test("オーナーが猶予中に再入室すると猶予が解除される", async () => {
    const owner = world.addMember("オーナー");
    const guest = world.addMember("ゲスト");
    const { vcId } = await world.createTempVoice(owner);
    await world.move(guest.id, vcId);

    await world.move(owner.id, null);
    await world.move(owner.id, vcId);

    const [row] = await db.select().from(tempVoiceChannels).where(eq(tempVoiceChannels.channelId, vcId));
    expect(row?.gracePeriodEndsAt).toBeNull();
    expect(row?.ownerId).toBe(owner.id);
  });

  test("最後の1人が退出→猶予中に再入室すると削除がキャンセルされる", async () => {
    const owner = world.addMember("オーナー");
    const { vcId, controlId } = await world.createTempVoice(owner);

    await world.move(owner.id, null);
    await world.move(owner.id, vcId);
    await new Promise((resolve) => setTimeout(resolve, EMPTY_GRACE_MS * 3));

    expect(world.channels.has(vcId)).toBe(true);
    expect(world.channels.has(controlId)).toBe(true);
    expect(await findTempVoiceChannel(db, vcId)).not.toBeNull();
    expect(world.actions()).not.toContain("deleted");
  });

  test("最後の1人が退出→再入室なしで猶予が切れるとVC・制御チャンネル・DB行が削除される", async () => {
    const owner = world.addMember("オーナー");
    const { vcId, controlId } = await world.createTempVoice(owner);

    await world.move(owner.id, null);
    await waitFor(() => world.actions().includes("deleted"), "deleted event");

    expect(world.channels.has(vcId)).toBe(false);
    expect(world.channels.has(controlId)).toBe(false);
    expect(await findTempVoiceChannel(db, vcId)).toBeNull();
    expect(world.events.at(-1)).toMatchObject({ action: "deleted", channelId: vcId, ownerId: owner.id });
  });

  test("個別拒否: VC内にいれば即kickされ、以後の入室も拒否される", async () => {
    const owner = world.addMember("オーナー");
    const target = world.addMember("対象");
    const { vcId } = await world.createTempVoice(owner);
    await world.move(target.id, vcId);

    await world.select(`temp-voice:denyMemberUser:${vcId}`, owner, target.id);

    expect(target.voice.channelId).toBeNull();
    expect(await world.move(target.id, vcId)).toBe(false);
    const overrides = await db.select().from(tempVoicePermissionOverrides).where(eq(tempVoicePermissionOverrides.channelId, vcId));
    expect(overrides).toEqual([expect.objectContaining({ targetType: "user", targetId: target.id, state: "deny" })]);
    expect(world.events.at(-1)).toMatchObject({ action: "memberPermissionChanged", state: "deny", targetId: target.id, targetName: "対象" });
    // 拒否されていないメンバーは入室できる。
    expect(await world.move(world.addMember("他人").id, vcId)).toBe(true);
  });

  test("ロール拒否: 対象ロールを持つVC内メンバー全員が即kickされる", async () => {
    const roleId = world.addRole("問題児");
    const owner = world.addMember("オーナー");
    const withRole1 = world.addMember("ロール持ち1", [roleId]);
    const withRole2 = world.addMember("ロール持ち2", [roleId]);
    const withoutRole = world.addMember("ロールなし");
    const { vcId } = await world.createTempVoice(owner);
    for (const member of [withRole1, withRole2, withoutRole]) await world.move(member.id, vcId);

    await world.select(`temp-voice:denyMemberRole:${vcId}`, owner, roleId);

    expect(withRole1.voice.channelId).toBeNull();
    expect(withRole2.voice.channelId).toBeNull();
    expect(withoutRole.voice.channelId).toBe(vcId);
    expect(owner.voice.channelId).toBe(vcId);
    expect(await world.move(withRole1.id, vcId)).toBe(false);
  });

  test("保護ロール・@everyoneは拒否指定できず、Dashboardでの保護設定・解除が反映される", async () => {
    const roleId = world.addRole("モデレーター");
    const owner = world.addMember("オーナー");
    const moderator = world.addMember("モデ", [roleId]);
    const { vcId } = await world.createTempVoice(owner);
    await world.move(moderator.id, vcId);

    // Dashboard(拒否禁止ロールタブ)で保護ロールに登録する。
    await replaceDenyProtectedRoles(db, world.guildId, [roleId]);
    const rejected = await world.select(`temp-voice:denyMemberRole:${vcId}`, owner, roleId);
    expect(rejected.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("拒否指定できません") }));
    expect(moderator.voice.channelId).toBe(vcId);

    const everyone = await world.select(`temp-voice:denyMemberRole:${vcId}`, owner, world.guildId);
    expect(everyone.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("拒否指定できません") }));
    expect(await db.select().from(tempVoicePermissionOverrides).where(eq(tempVoicePermissionOverrides.channelId, vcId))).toEqual([]);

    // 保護を解除すると拒否指定できるようになる。
    await replaceDenyProtectedRoles(db, world.guildId, []);
    await world.select(`temp-voice:denyMemberRole:${vcId}`, owner, roleId);
    expect(moderator.voice.channelId).toBeNull();
  });

  test("ロック中でも個別許可されたユーザーは入室できる", async () => {
    const owner = world.addMember("オーナー");
    const friend = world.addMember("友達");
    const stranger = world.addMember("知らない人");
    const { vcId } = await world.createTempVoice(owner);

    await world.press(`temp-voice:toggleLock:${vcId}`, owner);
    await world.select(`temp-voice:permitMemberUser:${vcId}`, owner, friend.id);

    expect(await world.move(friend.id, vcId)).toBe(true);
    expect(await world.move(stranger.id, vcId)).toBe(false);
  });

  test("ロック⇄ロック解除・非表示⇄表示のトグルが現在状態に応じたラベル・処理に切り替わる", async () => {
    const owner = world.addMember("オーナー");
    const guest = world.addMember("ゲスト");
    const { vcId } = await world.createTempVoice(owner);

    const locked = await world.press(`temp-voice:toggleLock:${vcId}`, owner);
    expect(panelJson(locked)).toContain("ロック解除");
    expect(world.canConnect(guest.id, vcId)).toBe(false);

    const unlocked = await world.press(`temp-voice:toggleLock:${vcId}`, owner);
    expect(panelJson(unlocked)).not.toContain("ロック解除");
    expect(world.canConnect(guest.id, vcId)).toBe(true);

    const hidden = await world.press(`temp-voice:toggleHide:${vcId}`, owner);
    expect(panelJson(hidden)).toContain("表示する");
    expect(world.channel(vcId).permissionOverwrites.cache.get(world.guildId)?.deny.has(PermissionFlagsBits.ViewChannel)).toBe(true);

    const shown = await world.press(`temp-voice:toggleHide:${vcId}`, owner);
    expect(panelJson(shown)).toContain("非表示にする");
    expect(world.channel(vcId).permissionOverwrites.cache.get(world.guildId)?.deny.has(PermissionFlagsBits.ViewChannel)).toBe(false);

    expect(world.events.filter((event) => event.action === "permissionChanged")).toEqual([
      expect.objectContaining({ permission: "connect", allowed: false }),
      expect.objectContaining({ permission: "connect", allowed: true }),
      expect.objectContaining({ permission: "view", allowed: false }),
      expect.objectContaining({ permission: "view", allowed: true }),
    ]);
  });

  test("メンバー管理から個別許可を解除するとDBとDiscordの両方から消え、@everyoneのロック設定にフォールバックする", async () => {
    const owner = world.addMember("オーナー");
    const friend = world.addMember("友達");
    const { vcId } = await world.createTempVoice(owner);
    await world.press(`temp-voice:toggleLock:${vcId}`, owner);
    await world.select(`temp-voice:permitMemberUser:${vcId}`, owner, friend.id);
    expect(world.canConnect(friend.id, vcId)).toBe(true);

    const list = await world.press(`temp-voice:manageMembers:${vcId}`, owner);
    const removeCustomId = `temp-voice:removeMember:${vcId}:user:${friend.id}`;
    expect(JSON.stringify(list.reply.mock.calls[0]?.[0])).toContain(removeCustomId);

    await world.press(removeCustomId, owner);

    expect(await db.select().from(tempVoicePermissionOverrides).where(eq(tempVoicePermissionOverrides.channelId, vcId))).toEqual([]);
    expect(world.channel(vcId).permissionOverwrites.connectOf(friend.id)).toBeUndefined();
    expect(world.canConnect(friend.id, vcId)).toBe(false);
    expect(world.events.at(-1)).toMatchObject({ action: "memberPermissionChanged", state: "cleared", targetId: friend.id });

    // ロックを解除すれば@everyoneの設定どおり入室できる。
    await world.press(`temp-voice:toggleLock:${vcId}`, owner);
    expect(world.canConnect(friend.id, vcId)).toBe(true);
  });

  test("Dashboard強制削除: 一覧に在室人数が出て、実行後は在室者ごと削除され一覧から消える", async () => {
    const owner = world.addMember("オーナー");
    const guest = world.addMember("ゲスト");
    const { vcId, controlId } = await world.createTempVoice(owner);
    await world.move(guest.id, vcId);

    // 確認ダイアログの在室人数はlistActiveTempVoiceChannelsのmemberCountを表示する。
    await waitFor(async () => (await listActiveTempVoiceChannels(db, world.guildId))[0]?.memberCount === 2, "member count sync");

    await handleForceDeleteNotification(
      { client: world.client as never, db, eventBus: world.eventBus as never },
      { guildId: world.guildId, channelId: vcId },
    );
    await world.drain();

    expect(world.channels.has(vcId)).toBe(false);
    expect(world.channels.has(controlId)).toBe(false);
    expect(owner.voice.channelId).toBeNull();
    expect(guest.voice.channelId).toBeNull();
    expect(await listActiveTempVoiceChannels(db, world.guildId)).toEqual([]);
    expect(world.events.at(-1)).toMatchObject({ action: "deleted", channelId: vcId, executorId: "dashboard" });
  });
});

describe("一時VC 起動時リコンサイル(bot再起動の再現)", () => {
  /** bot停止中から存在する一時VCを用意する(DB行+Discord側チャンネル)。sessionStoreは空=再起動直後の状態。 */
  async function existingTempVoice(ownerId: string, options: { withVoice?: boolean; withControl?: boolean } = {}) {
    const { withVoice = true, withControl = true } = options;
    const vcId = snowflake();
    const controlId = snowflake();
    if (withVoice) world.addChannel(ChannelType.GuildVoice, "既存VC", world.categoryId, {}, vcId);
    if (withControl) world.addChannel(ChannelType.GuildText, "既存VC", world.categoryId, {}, controlId);
    await insertTempVoiceChannel(db, { channelId: vcId, guildId: world.guildId, controlChannelId: controlId, ownerId });
    return { vcId, controlId };
  }

  function reconcileDeps() {
    return {
      db,
      client: world.client as never,
      eventBus: world.eventBus as never,
      sessionStore: world.sessionStore,
      emptyChannelScheduler: world.scheduler,
    };
  }

  test("片肺状態(制御チャンネルのみ消失)ならVCも削除しDB行を消す", async () => {
    const owner = world.addMember("オーナー");
    const { vcId } = await existingTempVoice(owner.id, { withControl: false });

    await reconcileGuild(reconcileDeps(), world.guildId);

    expect(world.channels.has(vcId)).toBe(false);
    expect(await findTempVoiceChannel(db, vcId)).toBeNull();
    expect(world.events.at(-1)).toMatchObject({ action: "deleted", channelId: vcId });
  });

  test("片肺状態(VCのみ消失)なら制御チャンネルも削除する", async () => {
    const owner = world.addMember("オーナー");
    const { vcId, controlId } = await existingTempVoice(owner.id, { withVoice: false });

    await reconcileGuild(reconcileDeps(), world.guildId);

    expect(world.channels.has(controlId)).toBe(false);
    expect(await findTempVoiceChannel(db, vcId)).toBeNull();
  });

  test("無人VCは即時削除せず削除猶予タイマーを再セットする", async () => {
    const owner = world.addMember("オーナー");
    const { vcId } = await existingTempVoice(owner.id);

    await reconcileGuild(reconcileDeps(), world.guildId);

    expect(world.channels.has(vcId)).toBe(true);
    expect(world.scheduler.isCurrent(vcId, 1)).toBe(true);
    // 再入室すればタイマーは解除される(通常の入退室処理へ合流する)。
    await world.move(owner.id, vcId);
    expect(world.scheduler.isCurrent(vcId, 1)).toBe(false);
  });

  test("在室中VCはセッションを再構築し、オーナー不在なら猶予を開始して期限切れで自動再割当できる(#437)", async () => {
    const owner = world.addMember("オーナー");
    const stayer = world.addMember("残留者");
    const { vcId } = await existingTempVoice(owner.id);
    // bot停止中にオーナーが退出し、残留者だけが在室している。
    stayer.voice.channelId = vcId;

    await reconcileGuild(reconcileDeps(), world.guildId);

    expect(world.sessionStore.isTracked(vcId)).toBe(true);
    expect(world.sessionStore.findLongestPresentUserId(vcId)).toBe(stayer.id);
    const [graceRow] = await db.select().from(tempVoiceChannels).where(eq(tempVoiceChannels.channelId, vcId));
    expect(graceRow?.gracePeriodOwnerId).toBe(owner.id);
    expect(graceRow?.gracePeriodEndsAt).not.toBeNull();

    // 再起動後の入退室も追跡される。
    const joiner = world.addMember("再起動後の入室者");
    await world.move(joiner.id, vcId);
    expect(world.sessionStore.findLongestPresentUserId(vcId)).toBe(stayer.id);

    await db.update(tempVoiceChannels).set({ gracePeriodEndsAt: new Date(Date.now() - 1000) }).where(eq(tempVoiceChannels.channelId, vcId));
    await createGraceRunner({ db, client: world.client as never, eventBus: world.eventBus as never, sessionStore: world.sessionStore }, () => {}).run();

    expect((await findTempVoiceChannel(db, vcId))?.ownerId).toBe(stayer.id);
  });

  test("DB未登録の孤児チャンネルは削除せず警告ログのみ出す", async () => {
    const owner = world.addMember("オーナー");
    await existingTempVoice(owner.id);
    const orphan = world.addChannel(ChannelType.GuildVoice, "孤児", world.categoryId, {});
    const warn = spyOn(console, "warn").mockImplementation(() => {});

    try {
      await reconcileGuild(reconcileDeps(), world.guildId);

      expect(world.channels.has(orphan.id as string)).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain(orphan.id as string);
    } finally {
      warn.mockRestore();
    }
  });
});
