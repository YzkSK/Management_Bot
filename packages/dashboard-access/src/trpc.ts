import type { Db } from "@management-bot/db";
import { isKnownCapabilityMask } from "@management-bot/shared";
import { initTRPC, TRPCError } from "@trpc/server";
import { validateSession } from "./session.js";
import {
  resolveEffectiveCapabilities,
  type ResolveEffectiveCapabilitiesInput,
} from "./effective-capabilities.js";

export interface GuildMembership {
  isOwner: boolean;
  roleIds: readonly string[];
}

export interface ChannelOption {
  id: string;
  name: string;
}

export interface RoleOption {
  id: string;
  name: string;
}

export interface MemberOption {
  id: string;
  name: string;
}

export interface MemberPage {
  members: readonly MemberOption[];
  /** 次ページ取得用のuser id(昇順カーソル)。undefinedなら最終ページ。 */
  nextAfter: string | undefined;
}

export interface ManagedGuild {
  id: string;
  name: string;
}

export interface DashboardAccessContext {
  db: Db;
  sessionId: string | undefined;
  /** Bot招待/再認可URL生成に使うOAuth2クライアントID。dashboard-api側でenvから供給する。 */
  discordClientId: string;
  /**
   * ログインユーザーが管理者権限(オーナーまたはMANAGE_GUILD)を持ち、かつbotが導入済みのguild一覧を返す。
   * Dashboardのサーバー選択画面で使う。dashboard-api側でDiscord APIから供給する。
   */
  listMyGuilds: () => Promise<readonly ManagedGuild[]>;
  /**
   * guildIdにおけるdiscordUserIdの在籍状態を返す。非在籍(脱退・キック済み等)はnull。
   * dashboard-api側でDiscord APIやキャッシュから供給する。
   */
  getGuildMembership: (guildId: string, discordUserId: string) => Promise<GuildMembership | null>;
  /**
   * guildId直下の、botがメッセージ送信可能なテキストチャンネル一覧を返す。
   * Dashboard UIでのセレクター表示に使う。送信不可(権限不足・アナウンス専用等)の
   * チャンネルを含めると、設定自体は成功してもログ配信が以後毎回失敗するため
   * 実装側で送信可否まで絞り込むこと。表示専用なのでdashboard-api側で短命キャッシュしてよい。
   * チャンネルID設定時の実在検証には{@link verifyGuildChannel}を使うこと
   * (キャッシュ経由だと削除済みチャンネルの検証をすり抜けうるため)。
   */
  getGuildChannels: (guildId: string) => Promise<readonly ChannelOption[]>;
  /**
   * guildId直下の全チャンネル(種別・送信可否を問わない)を返す。ログ一覧のchannelId→name表示名解決専用
   * (issue #144)。getGuildChannelsは送信可能チャンネルのみに絞るため、ボイスチャンネル等のログでは
   * 使えない。表示専用なのでdashboard-api側で短命キャッシュしてよい。
   */
  getAllGuildChannels: (guildId: string) => Promise<readonly ChannelOption[]>;
  /**
   * guildId直下でchannelIdが実在し、botがメッセージ送信可能かをキャッシュを介さず確認する。
   * チャンネルID設定のmutation(setChannelSetting等)の実在検証専用。dashboard-api側でDiscord APIから供給する。
   */
  verifyGuildChannel: (guildId: string, channelId: string) => Promise<boolean>;
  /**
   * 指定したdiscordユーザーIDごとの表示名(サーバーニックネーム優先)を解決する。
   * ダッシュボードのログ一覧でユーザーIDをそのまま見せず名前表示するために使う。
   * 解決できなかったID(脱退済み等)はMapに含めない。dashboard-api側でDiscord APIから供給する。
   */
  getGuildMemberNames: (guildId: string, userIds: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  /**
   * guildIdにおけるBotの実効権限(guildロールのpermissionsのOR合成)ビットフィールドを返す。
   * loggingのintegration/auditLogCorrelationが依存するguildAuditLogEntryCreateイベントは
   * ViewAuditLog権限がないと配信されないため(issue #80)、この権限の有無を確認して
   * Dashboardの再認可導線に使う。dashboard-api側でDiscord APIから供給する。
   */
  getBotPermissions: (guildId: string) => Promise<bigint>;
  /**
   * guildId直下の全ロールのid/nameを返す。capability付与画面のロールセレクターに使う
   * (issue #198)。`@everyone`ロール(id===guildId)も含む。表示専用なのでdashboard-api側で
   * 短命キャッシュしてよい。
   */
  getGuildRoles: (guildId: string) => Promise<readonly RoleOption[]>;
  /**
   * guildId直下でroleIdが実在するかをキャッシュを介さず確認する。capability grantのtargetId
   * 実在検証専用(issue #198)。getGuildRolesは表示用に短命キャッシュされうるため、削除直後の
   * roleへの誤付与を防ぐにはこちらを使うこと(verifyGuildChannelと同じ考え方)。
   */
  verifyGuildRole: (guildId: string, roleId: string) => Promise<boolean>;
  /**
   * guildId直下のメンバーをuser id昇順で1ページ分取得する。capability付与画面のユーザー
   * セレクターに使う(issue #198)。大規模guildで全件を一度に返さないよう、afterで明示的に
   * ページ送りする(省略時は先頭ページ)。GUILD_MEMBERS Privileged Intent未設定の場合は
   * DiscordAccessForbiddenErrorが投げられうる。
   */
  getGuildMembersPage: (guildId: string, after?: string) => Promise<MemberPage>;
  /**
   * guildIdに指定userIdが実在(在籍)するかを判定する。capability grantのtargetId実在検証専用
   * (issue #198)。getGuildMembershipは「ログイン中の操作者自身」の在籍確認専用であり、
   * 任意のtargetユーザーの在籍確認には使えないため、別メソッドとして分離している。
   * キャッシュを介さずBot APIへ問い合わせること(実在検証の性質上、表示用キャッシュを使うと
   * 脱退直後のユーザーへの誤付与を許してしまう)。
   */
  isGuildMember: (guildId: string, userId: string) => Promise<boolean>;
  /**
   * requireCapabilityが実効capabilities(DB SELECT)を計算する際に使う関数。省略時は
   * effective-capabilities.tsのresolveEffectiveCapabilitiesを毎回そのまま呼ぶ。
   * 1画面が複数procedureを呼ぶ場合(例: AccessPageは最低5つ)の同一リクエストバッチ内での
   * 重複問い合わせを避けたいdashboard-api側は、短命TTLキャッシュ付きの実装をここに注入できる
   * (issue #198 パフォーマンス改善。getGuildMembershipキャッシュと同じ考え方)。
   */
  resolveEffectiveCapabilities?: (input: ResolveEffectiveCapabilitiesInput) => Promise<number>;
}

const t = initTRPC.context<DashboardAccessContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;

interface AuthenticatedContext extends DashboardAccessContext {
  discordUserId: string;
  discordUsername: string;
}

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  const session = ctx.sessionId ? await validateSession(ctx.db, ctx.sessionId) : null;
  if (!session) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  const authenticatedCtx: AuthenticatedContext = {
    ...ctx,
    discordUserId: session.discordUserId,
    discordUsername: session.discordUsername,
  };
  return next({ ctx: authenticatedCtx });
});

/**
 * inputに`guildId`を要求し、そのギルドに在籍していない、またはcapを持たない場合はFORBIDDENを投げる。
 * これがassertGuildScope相当を兼ねる: 在籍確認を通らない限り他ギルドのデータには到達できない。
 * protectedProcedureの後に.use()すること(discordUserIdをctxから読む)。
 */
export function requireCapability(cap: number) {
  if (!isKnownCapabilityMask(cap) || cap === 0) {
    throw new Error("requireCapability requires a non-zero known capability mask");
  }

  return t.middleware(async ({ ctx, input, next }) => {
    const { db, discordUserId } = ctx as AuthenticatedContext;
    const parsed = input as { guildId?: unknown };
    if (typeof parsed?.guildId !== "string") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "guildId is required" });
    }
    const guildId = parsed.guildId;

    const membership = await (ctx as DashboardAccessContext).getGuildMembership(
      guildId,
      discordUserId,
    );
    if (!membership) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    const resolve =
      (ctx as DashboardAccessContext).resolveEffectiveCapabilities ??
      ((input: ResolveEffectiveCapabilitiesInput) => resolveEffectiveCapabilities(db, input));
    const capabilities = await resolve({
      guildId,
      discordUserId,
      isOwner: membership.isOwner,
      roleIds: membership.roleIds,
    });

    if ((capabilities & cap) !== cap) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    return next({ ctx: { ...ctx, capabilities } });
  });
}
