import { protectedProcedure, resolveEffectiveCapabilities, router } from "@management-bot/dashboard-access";
import type { ManagedGuild } from "@management-bot/dashboard-access";

export interface ManagedGuildWithAccess extends ManagedGuild {
  /**
   * ログインユーザーのこのguildでの実効capabilities(issue #527)。未在籍なら0。
   * isManagedはBot設定変更可否(オーナー/MANAGE_GUILD)の軸であり、これとは独立。
   * Dashboard UIはこれを元にサーバー選択後の遷移先・サイドバーの表示項目を決める。
   * 表示の出し分けは利便性のためのもので、認可は各procedureのrequireCapabilityが最終的に強制する。
   */
  capabilities: number;
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
          return { ...guild, capabilities: 0 };
        }
        const capabilities = await resolveCapabilities({
          guildId: guild.id,
          discordUserId: ctx.discordUserId,
          isOwner: membership.isOwner,
          roleIds: membership.roleIds,
        });
        return { ...guild, capabilities };
      }),
    );
  }),
});
