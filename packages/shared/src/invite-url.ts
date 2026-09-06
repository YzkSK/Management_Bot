const NO_PERMISSIONS = 0n;

export interface InviteUrlOptions {
  /**
   * 再認可対象のguildを固定する。指定しない場合、認可ユーザーがDiscordのサーバー選択画面で
   * 任意のguildを選べてしまい、権限不足を解消したい元のguildが再認可されないおそれがある。
   */
  guildId?: string;
}

/**
 * bot招待/再認可用OAuth2 URL。最小権限方針: 権限は機能有効化に応じて個別に要求する。
 * 初回招待時は無権限(0)、機能追加等で権限が必要になった場合は再認可導線から
 * `permissions`に必要なビットフィールドを渡して呼び出す。
 * `guildId`を指定すると、Discordのサーバー選択をそのguildに固定する(disable_guild_select)。
 */
export function buildInviteUrl(
  clientId: string,
  permissions: bigint = NO_PERMISSIONS,
  { guildId }: InviteUrlOptions = {},
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: "bot applications.commands",
    permissions: permissions.toString(),
  });
  if (guildId) {
    params.set("guild_id", guildId);
    params.set("disable_guild_select", "true");
  }
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}
