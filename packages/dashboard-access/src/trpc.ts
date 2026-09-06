import type { Db } from "@management-bot/db";
import { isKnownCapabilityMask } from "@management-bot/shared";
import { initTRPC, TRPCError } from "@trpc/server";
import { validateSession } from "./session.js";
import { resolveEffectiveCapabilities } from "./effective-capabilities.js";

export interface GuildMembership {
  isOwner: boolean;
  roleIds: readonly string[];
}

export interface ChannelOption {
  id: string;
  name: string;
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
}

const t = initTRPC.context<DashboardAccessContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;

interface AuthenticatedContext extends DashboardAccessContext {
  discordUserId: string;
}

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  const session = ctx.sessionId ? await validateSession(ctx.db, ctx.sessionId) : null;
  if (!session) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  const authenticatedCtx: AuthenticatedContext = { ...ctx, discordUserId: session.discordUserId };
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

    const capabilities = await resolveEffectiveCapabilities(db, {
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
