const NO_PERMISSIONS = 0n;

/**
 * bot招待/再認可用OAuth2 URL。最小権限方針: 権限は機能有効化に応じて個別に要求する。
 * 初回招待時は無権限(0)、機能追加等で権限が必要になった場合は再認可導線から
 * `permissions`に必要なビットフィールドを渡して呼び出す。
 */
export function buildInviteUrl(clientId: string, permissions: bigint = NO_PERMISSIONS): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: "bot applications.commands",
    permissions: permissions.toString(),
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}
