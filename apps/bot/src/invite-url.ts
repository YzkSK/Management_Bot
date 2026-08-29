const BOT_PERMISSIONS = 0n;

/** bot招待用OAuth2 URL。最小権限方針: 権限は機能有効化に応じて個別に要求する想定のため、招待時点では0(無権限)固定。 */
export function buildInviteUrl(clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: "bot applications.commands",
    permissions: BOT_PERMISSIONS.toString(),
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}
