/** サーバーに保存されている予約投稿の設定(getSettingsの戻り値)。 */
export interface ScheduledPostSettingsServerState {
  allowedRoleIds: readonly string[];
  allowEveryone: boolean;
  allowHere: boolean;
}

/** 画面で編集中の設定。保存バーから確定するまでサーバーへは送らない。 */
export interface ScheduledPostSettingsDraft {
  roleIds: string[];
  allowEveryone: boolean;
  allowHere: boolean;
}

export function buildScheduledPostSettingsDraft(server: ScheduledPostSettingsServerState): ScheduledPostSettingsDraft {
  return { roleIds: [...server.allowedRoleIds], allowEveryone: server.allowEveryone, allowHere: server.allowHere };
}

/** 下書きがサーバーの値と違うか。ロールは並びを問わず同じ集合なら変更なし。 */
export function hasScheduledPostSettingsChanges(
  server: ScheduledPostSettingsServerState,
  draft: ScheduledPostSettingsDraft,
): boolean {
  const saved = new Set(server.allowedRoleIds);
  const sameRoles = draft.roleIds.length === saved.size && draft.roleIds.every((id) => saved.has(id));
  return !sameRoles || draft.allowEveryone !== server.allowEveryone || draft.allowHere !== server.allowHere;
}

export function toUpdateSettingsInput(guildId: string, draft: ScheduledPostSettingsDraft) {
  return { guildId, roleIds: draft.roleIds, allowEveryone: draft.allowEveryone, allowHere: draft.allowHere };
}
