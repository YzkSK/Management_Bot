/** 一時VCの設定変更ダイアログの下書きと、保存時に送る操作列(updateChannelのaction)への変換。 */
import { TRPCClientError } from "@trpc/client";

export const SAVE_SUCCESS_MESSAGE = "変更を反映しました。";

/**
 * 保存が途中で失敗したときのトースト文言。サーバー(updateChannel)のエラーメッセージをそのまま出し、
 * 既に反映済みの項目があればその旨を説明に添える。
 */
export function describeSaveFailure(error: unknown, appliedCount: number): { message: string; description?: string } {
  const message =
    error instanceof TRPCClientError && error.message !== ""
      ? error.message
      : "変更の反映に失敗しました。時間を置いて再度お試しください。";
  return appliedCount > 0 ? { message, description: "途中の項目までは反映されています。" } : { message };
}

export type OverrideTargetType = "user" | "role";
export type OverrideState = "allow" | "deny";

export interface OverrideEntry {
  targetType: OverrideTargetType;
  targetId: string;
  state: OverrideState;
  name?: string | undefined;
}

/** 個別許可/拒否の未保存の変更。removeは解除。 */
export interface PendingOverride {
  targetType: OverrideTargetType;
  targetId: string;
  name?: string | undefined;
  change: OverrideState | "remove";
}

export interface ChannelEditInitial {
  name: string;
  userLimit: number | null;
  bitrate: number | null;
  isLocked: boolean;
  isHidden: boolean;
}

export interface ChannelEditDraft {
  name: string;
  userLimit: string;
  bitrateKbps: string;
  locked: boolean;
  hidden: boolean;
  /** キーは`${targetType}:${targetId}`。 */
  pending: Record<string, PendingOverride>;
  /** 空文字なら移譲しない。 */
  transferTo: string;
}

export type ChannelEditAction =
  | { type: "rename"; name: string }
  | { type: "userLimit"; value: number }
  | { type: "bitrate"; kbps: number }
  | { type: "setLocked"; locked: boolean }
  | { type: "setHidden"; hidden: boolean }
  | { type: "permit" | "deny" | "removeOverride"; targetType: OverrideTargetType; targetId: string }
  | { type: "transferOwner"; userId: string };

export const overrideKey = (targetType: OverrideTargetType, targetId: string): string => `${targetType}:${targetId}`;

export function buildChannelEditDraft(initial: ChannelEditInitial): ChannelEditDraft {
  return {
    name: initial.name,
    userLimit: String(initial.userLimit ?? 0),
    bitrateKbps: initial.bitrate === null ? "" : String(Math.round(initial.bitrate / 1000)),
    locked: initial.isLocked,
    hidden: initial.isHidden,
    pending: {},
    transferTo: "",
  };
}

/** 現在の一覧に未保存の変更を重ねた、画面に出す個別許可/拒否の一覧。 */
export function effectiveOverrides(current: readonly OverrideEntry[], pending: ChannelEditDraft["pending"]): OverrideEntry[] {
  const merged = new Map<string, OverrideEntry>(current.map((o) => [overrideKey(o.targetType, o.targetId), o]));
  for (const [key, p] of Object.entries(pending)) {
    if (p.change === "remove") merged.delete(key);
    else merged.set(key, { targetType: p.targetType, targetId: p.targetId, state: p.change, name: p.name });
  }
  return [...merged.values()];
}

/** 入力検証(サーバー側でも検証する。ここは即時フィードバック用)。 */
export function validateChannelEditDraft(draft: ChannelEditDraft, initialName: string): string[] {
  const errors: string[] = [];
  const name = draft.name.trim();
  // 元の名前が不明(未取得)で触っていない場合は名前を送らないため空でも許容する。
  if (name.length === 0 && initialName !== "") errors.push("チャンネル名を入力してください。");
  else if (name.length > 100) errors.push("チャンネル名は100文字以内で入力してください。");
  const limit = Number(draft.userLimit);
  if (draft.userLimit.trim() === "" || !Number.isInteger(limit) || limit < 0 || limit > 99) {
    errors.push("人数制限は0〜99の整数で入力してください(0=無制限)。");
  }
  if (draft.bitrateKbps.trim() !== "") {
    const kbps = Number(draft.bitrateKbps);
    if (!Number.isInteger(kbps) || kbps < 8) errors.push("音質は8kbps以上の整数で入力してください。");
  }
  return errors;
}

/**
 * 変更された項目だけを、保存時に順に送る操作へ変換する。
 * オーナー移譲は自分のオーナー権限を失うため必ず最後に置く。
 */
export function buildChannelEditActions(
  initial: ChannelEditInitial,
  draft: ChannelEditDraft,
  currentOverrides: readonly OverrideEntry[],
): ChannelEditAction[] {
  const actions: ChannelEditAction[] = [];
  const name = draft.name.trim();
  if (name !== initial.name && name !== "") actions.push({ type: "rename", name });
  const limit = Number(draft.userLimit);
  if (limit !== (initial.userLimit ?? 0)) actions.push({ type: "userLimit", value: limit });
  if (draft.bitrateKbps.trim() !== "") {
    const kbps = Number(draft.bitrateKbps);
    if (initial.bitrate === null || kbps !== Math.round(initial.bitrate / 1000)) actions.push({ type: "bitrate", kbps });
  }
  if (draft.locked !== initial.isLocked) actions.push({ type: "setLocked", locked: draft.locked });
  if (draft.hidden !== initial.isHidden) actions.push({ type: "setHidden", hidden: draft.hidden });

  const currentByKey = new Map(currentOverrides.map((o) => [overrideKey(o.targetType, o.targetId), o]));
  for (const [key, p] of Object.entries(draft.pending)) {
    const current = currentByKey.get(key);
    const { targetType, targetId } = p;
    if (p.change === "remove") {
      if (current) actions.push({ type: "removeOverride", targetType, targetId });
    } else if (current?.state !== p.change) {
      actions.push({ type: p.change === "allow" ? "permit" : "deny", targetType, targetId });
    }
  }

  if (draft.transferTo !== "") actions.push({ type: "transferOwner", userId: draft.transferTo });
  return actions;
}
