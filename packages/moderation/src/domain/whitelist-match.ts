export interface WhitelistMatchEntry {
  targetType: "user" | "role";
  targetId: string;
}

/**
 * ホワイトリストエントリ一覧に対し、userId/roleIdsのいずれかが一致するかを判定する純粋関数。
 * application/whitelist.tsのisWhitelisted(SQL版)と同じ判定ロジックをJS側に持つ
 * (moderation-config-cache.tsでキャッシュしたエントリ一覧に対して使うため、
 * SQL側のWHERE句フィルタはキャッシュと相性が悪く純粋関数へ移植する、#352)。
 */
export function isWhitelistMatch(
  entries: readonly WhitelistMatchEntry[],
  guildId: string,
  userId: string,
  roleIds: readonly string[],
): boolean {
  // `@everyone`(roleId===guildId)は全メンバーが持つロールのため、万一ホワイトリストに
  // 登録されていても一致対象から除外する(isWhitelisted(SQL版)と同じ防御)。
  const applicableRoleIds = roleIds.filter((roleId) => roleId !== guildId);
  return entries.some(
    (entry) =>
      (entry.targetType === "user" && entry.targetId === userId) ||
      (entry.targetType === "role" && applicableRoleIds.includes(entry.targetId)),
  );
}
