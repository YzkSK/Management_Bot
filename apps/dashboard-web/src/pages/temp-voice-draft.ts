/** 一時VC設定の編集中の値。入力途中を保持するため数値も文字列で持つ。 */
export interface TempVoiceDraft {
  createChannelId: string;
  categoryId: string;
  nameTemplate: string;
  userLimit: string;
  /** kbps。空文字は未設定(サーバー既定)。 */
  bitrateKbps: string;
}

export interface TempVoiceServerConfig {
  createChannelId: string | null;
  categoryId: string | null;
  nameTemplate: string;
  defaultUserLimit: number;
  defaultBitrate: number | null;
}

export function buildTempVoiceDraft(config: TempVoiceServerConfig): TempVoiceDraft {
  return {
    createChannelId: config.createChannelId ?? "",
    categoryId: config.categoryId ?? "",
    nameTemplate: config.nameTemplate,
    userLimit: String(config.defaultUserLimit),
    bitrateKbps: config.defaultBitrate ? String(Math.floor(config.defaultBitrate / 1000)) : "",
  };
}

export interface TempVoiceChanges {
  /** setConfigへ渡す変更分(部分更新)。変更がなければ空オブジェクト。 */
  input: {
    createChannelId?: string;
    categoryId?: string;
    nameTemplate?: string;
    defaultUserLimit?: number;
    defaultBitrate?: number | null;
  };
  errors: string[];
}

export function diffTempVoiceConfig(config: TempVoiceServerConfig, draft: TempVoiceDraft): TempVoiceChanges {
  const input: TempVoiceChanges["input"] = {};
  const errors: string[] = [];

  if (draft.createChannelId !== (config.createChannelId ?? "") || draft.categoryId !== (config.categoryId ?? "")) {
    if (draft.createChannelId === "" || draft.categoryId === "") {
      errors.push("作成用ボイスチャンネルとカテゴリは両方選択してください。");
    } else {
      input.createChannelId = draft.createChannelId;
      input.categoryId = draft.categoryId;
    }
  }
  if (draft.nameTemplate !== config.nameTemplate) {
    if (draft.nameTemplate.trim() === "") errors.push("名前テンプレートを入力してください。");
    else input.nameTemplate = draft.nameTemplate;
  }
  const userLimit = Number(draft.userLimit);
  if (!Number.isInteger(userLimit) || userLimit < 0 || userLimit > 99 || draft.userLimit.trim() === "") {
    errors.push("デフォルト人数制限は0〜99で入力してください。");
  } else if (userLimit !== config.defaultUserLimit) {
    input.defaultUserLimit = userLimit;
  }
  if (draft.bitrateKbps.trim() === "") {
    if (config.defaultBitrate !== null) input.defaultBitrate = null;
  } else {
    const kbps = Number(draft.bitrateKbps);
    if (!Number.isInteger(kbps) || kbps <= 0) errors.push("デフォルト音質は正の整数(kbps)で入力してください。");
    else if (kbps * 1000 !== config.defaultBitrate) input.defaultBitrate = kbps * 1000;
  }
  return { input, errors };
}

export function hasTempVoiceChanges(changes: TempVoiceChanges): boolean {
  return Object.keys(changes.input).length > 0 || changes.errors.length > 0;
}
