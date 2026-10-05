import { z } from "zod";

/**
 * コンポーネント・モーダルのcustomId。他機能のcustomIdと混在するため"scheduled-post:"で始める。
 * customIdはクライアント由来の入力のため、解釈時は必ずzodで検証する。
 */
const PREFIX = "scheduled-post:";

export const CREATE_MODAL_CUSTOM_ID = `${PREFIX}create`;
export const EDIT_MODAL_PREFIX = `${PREFIX}editModal:`;
export const EDIT_BUTTON_PREFIX = `${PREFIX}edit:`;
export const CANCEL_BUTTON_PREFIX = `${PREFIX}cancel:`;
export const SELECT_CUSTOM_ID = `${PREFIX}select`;

export function isScheduledPostCustomId(customId: string): boolean {
  return customId.startsWith(PREFIX);
}

export const editModalCustomId = (postId: string): string => `${EDIT_MODAL_PREFIX}${postId}`;
export const editButtonCustomId = (postId: string): string => `${EDIT_BUTTON_PREFIX}${postId}`;
export const cancelButtonCustomId = (postId: string): string => `${CANCEL_BUTTON_PREFIX}${postId}`;

const postIdSchema = z.uuid();

function suffixOf(customId: string, prefix: string): string | null {
  return customId.startsWith(prefix) ? customId.slice(prefix.length) : null;
}

function parsePostId(customId: string, prefix: string): string | null {
  const parsed = postIdSchema.safeParse(suffixOf(customId, prefix));
  return parsed.success ? parsed.data : null;
}

export const parseEditModalCustomId = (customId: string): string | null => parsePostId(customId, EDIT_MODAL_PREFIX);
export const parseEditButtonCustomId = (customId: string): string | null => parsePostId(customId, EDIT_BUTTON_PREFIX);
export const parseCancelButtonCustomId = (customId: string): string | null => parsePostId(customId, CANCEL_BUTTON_PREFIX);

/** 一覧のセレクトメニューで選ばれた予約ID(value)を検証して取り出す。 */
export function parseSelectedPostId(values: readonly string[]): string | null {
  const parsed = postIdSchema.safeParse(values[0]);
  return parsed.success ? parsed.data : null;
}
