import { protectedProcedure, resolveEffectiveCapabilities, router } from "@management-bot/dashboard-access";
import type { ManagedGuild } from "@management-bot/dashboard-access";
import { CAPABILITIES } from "@management-bot/shared";

export interface ManagedGuildWithAccess extends ManagedGuild {
  /**
   * ログインユーザーがこのguildでアクティビティモニター(VIEW_ACTIVITY)を閲覧できるか(issue #263, #505)。
   * isManagedはBot設定変更可否(オーナー/MANAGE_GUILD)の軸であり、これとは独立。
   * Dashboard UIのサーバー選択後の遷移先がアクティビティモニターのため、VIEW_ACTIVITYで判定する。
   * falseの場合、遷移してもrequireCapability(VIEW_ACTIVITY)がFORBIDDENを返すだけなので、
   * Dashboard UIの一覧ではクリック不可にしてよい。遷移先を変えたらここの判定も合わせて変えること。
   */
  canViewActivity: boolean;
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
          return { ...guild, canViewActivity: false };
        }
        const capabilities = await resolveCapabilities({
          guildId: guild.id,
          discordUserId: ctx.discordUserId,
          isOwner: membership.isOwner,
          roleIds: membership.roleIds,
        });
        return { ...guild, canViewActivity: (capabilities & CAPABILITIES.VIEW_ACTIVITY) === CAPABILITIES.VIEW_ACTIVITY };
      }),
    );
  }),
});
