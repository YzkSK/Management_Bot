import { DISCORD_PERMISSION_LABELS } from "@management-bot/shared";

export interface RoleFilterValue {
  /** 選択した権限のキー(DISCORD_PERMISSION_LABELSのkey)。すべて持つロールだけに絞る。 */
  permissionKeys: string[];
  /** メンバー数の下限・上限(空文字=指定なし)。入力欄の値をそのまま持つ。 */
  minMembers: string;
  maxMembers: string;
}

export const EMPTY_ROLE_FILTER: RoleFilterValue = { permissionKeys: [], minMembers: "", maxMembers: "" };

export interface FilterableRole {
  name: string;
  /** 権限ビットフィールド(10進文字列)。 */
  permissions: string;
  /** メンバー数。取得できない・@everyoneはnull。 */
  memberCount: number | null;
}

const ADMINISTRATOR_BIT = 1n << 3n;

function parsePermissions(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : 0n;
}

/** 入力欄の文字列を境界値にする。空・数値でない場合は指定なし(null)。 */
function parseBound(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 管理者権限を持つロールは、すべての権限を持つものとして扱う。 */
export function roleHasPermissions(permissions: string, requiredBits: bigint): boolean {
  const granted = parsePermissions(permissions);
  return (granted & ADMINISTRATOR_BIT) === ADMINISTRATOR_BIT || (granted & requiredBits) === requiredBits;
}

/**
 * 名前(大文字小文字を区別しない部分一致)・権限(選んだものをすべて持つ)・メンバー数(上限下限とも含む)で絞り込む。
 * メンバー数が不明(null)のロールは、上限または下限を指定したときだけ除外する。
 */
export function filterRoles<T extends FilterableRole>(roles: readonly T[], nameQuery: string, filter: RoleFilterValue): T[] {
  const query = nameQuery.trim().toLowerCase();
  const requiredBits = DISCORD_PERMISSION_LABELS.filter(({ key }) => filter.permissionKeys.includes(key)).reduce(
    (mask, { bit }) => mask | bit,
    0n,
  );
  const min = parseBound(filter.minMembers);
  const max = parseBound(filter.maxMembers);

  return roles.filter((role) => {
    if (query !== "" && !role.name.toLowerCase().includes(query)) return false;
    if (requiredBits !== 0n && !roleHasPermissions(role.permissions, requiredBits)) return false;
    if (min !== null || max !== null) {
      if (role.memberCount === null) return false;
      if (min !== null && role.memberCount < min) return false;
      if (max !== null && role.memberCount > max) return false;
    }
    return true;
  });
}
