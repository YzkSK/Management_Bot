import { protectedProcedure, resolveEffectiveCapabilities, router } from "@management-bot/dashboard-access";
import type { ManagedGuild } from "@management-bot/dashboard-access";
import { CAPABILITIES } from "@management-bot/shared";

export interface ManagedGuildWithAccess extends ManagedGuild {
  /**
   * ログインユーザーがこのguildでログ一覧(VIEW_LOGS)を閲覧できるか(issue #263)。
   * isManagedはBot設定変更可否(オーナー/MANAGE_GUILD)の軸であり、これとは独立。
   * GuildListPageの遷移先は現状ログ一覧のみのためVIEW_LOGSのみで判定する。
   * falseの場合、遷移してもrequireCapability(VIEW_LOGS)がFORBIDDENを返すだけなので、
   * Dashboard UIの一覧ではクリック不可にしてよい。
   * 遷移先の機能が増えたら(FEATURE_METADATAの実装済みキーが増えたら)、
   * それらのviewCapabilityも合わせて判定する必要がある。
   */
  canViewLogs: boolean;
}

export const guildSettingsRouter = router({
  listMyGuilds: protectedProcedure.query(async ({ ctx }): Promise<readonly ManagedGuildWithAccess[]> => {
    const guilds = await ctx.listMyGuilds();
    const resolveCapabilities = ctx.resolveEffectiveCapabilities ?? ((input) => resolveEffectiveCapabilities(ctx.db, input));

    // ponytail: guild数分のgetGuildMembership(Bot API)を無制限並列で呼ぶ。通常の所属guild数では
    // 問題にならないが、所属guildが非常に多いユーザーでレート制限に達するようなら並列数を絞る。
    return Promise.all(
      guilds.map(async (guild): Promise<ManagedGuildWithAccess> => {
        const membership = await ctx.getGuildMembership(guild.id, ctx.discordUserId);
        if (!membership) {
          return { ...guild, canViewLogs: false };
        }
        const capabilities = await resolveCapabilities({
          guildId: guild.id,
          discordUserId: ctx.discordUserId,
          isOwner: membership.isOwner,
          roleIds: membership.roleIds,
        });
        return { ...guild, canViewLogs: (capabilities & CAPABILITIES.VIEW_LOGS) === CAPABILITIES.VIEW_LOGS };
      }),
    );
  }),
});
