import { useQuery } from "@tanstack/react-query";
import { knownPermissionsForBits } from "@management-bot/shared";
import { Bot, Lock, Search, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { isForbiddenError } from "../dashboard-query-client.js";
import { trpc } from "../trpc.js";
import { permissionIcon } from "./permission-icons.js";
import { RoleFilter } from "./RoleFilter.js";
import { EMPTY_ROLE_FILTER, filterRoles, type RoleFilterValue } from "./role-filter.js";
import { ErrorState, ForbiddenState } from "@/components/page-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dropdown, DropdownContent, DropdownTrigger } from "@/components/starwind/dropdown";
import { Input } from "@/components/starwind/input";
import { Loading } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const NUMBER_FORMAT = new Intl.NumberFormat("ja-JP");
const MAX_PERMISSION_TAGS = 3;
const BADGE_BASE = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs leading-none font-medium";

interface RoleRowData {
  id: string;
  name: string;
  color: number;
  permissions: string;
  memberCount: number | null;
  isEveryone: boolean;
  managed: boolean;
  botId: string | null;
  botManageable: boolean;
}

/** 「操作不可」をクリックしたときに出す理由。 */
function lockedReason(role: RoleRowData): string {
  return role.managed
    ? "連携サービス(サーバーブースト・外部アプリ等)が管理するロールのため、Botからは付け外しできません。"
    : "Botの最上位ロールと同じ位置かそれより上にあるため、Botからは付け外し・設定変更ができません。Discordのサーバー設定でBotのロールをこのロールより上に移動すると操作できるようになります。";
}

/** クリックで中身を開くバッジ・タグ。 */
function ClickPopover({ trigger, label, children }: { trigger: ReactNode; label: string; children: ReactNode }) {
  return (
    <Dropdown className="contents">
      <DropdownTrigger asChild>
        <button type="button" aria-label={label} className="shrink-0 cursor-pointer rounded-full">
          {trigger}
        </button>
      </DropdownTrigger>
      <DropdownContent
        align="end"
        className="max-h-[min(24rem,var(--sw-floating-available-height))] max-w-80 overflow-y-auto p-3 text-sm"
      >
        {children}
      </DropdownContent>
    </Dropdown>
  );
}

function roleColor(color: number): string | undefined {
  return color === 0 ? undefined : `#${color.toString(16).padStart(6, "0")}`;
}

/** 主な権限の表示用タグ。管理者は全権限を含むため管理者のみ。絞り込みで選んだ権限を先頭に出す。 */
function permissionTags(permissions: string, selectedKeys: readonly string[]) {
  const known = knownPermissionsForBits(/^\d+$/.test(permissions) ? BigInt(permissions) : 0n);
  const admin = known.find((p) => p.key === "Administrator");
  if (admin) return [admin];
  return [...known.filter((p) => selectedKeys.includes(p.key)), ...known.filter((p) => !selectedKeys.includes(p.key))];
}

function PermissionCell({ permissions, selectedKeys }: { permissions: string; selectedKeys: readonly string[] }) {
  const tags = permissionTags(permissions, selectedKeys);
  if (tags.length === 0) return <span className="text-muted-foreground text-xs">なし</span>;
  const shown = tags.slice(0, MAX_PERMISSION_TAGS);
  const rest = tags.slice(MAX_PERMISSION_TAGS);
  return (
    <div className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap">
      {shown.map(({ key, label }) => {
        const Icon = permissionIcon(key);
        return (
          <span key={key} className="bg-muted flex max-w-56 shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs">
            <Icon className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{label}</span>
          </span>
        );
      })}
      {rest.length > 0 && (
        <ClickPopover
          label={`ほか${rest.length}件の権限を表示`}
          trigger={
            <span className="bg-muted text-muted-foreground hover:text-foreground block rounded-md px-1.5 py-0.5 text-xs">
              +{rest.length}
            </span>
          }
        >
          <ul className="flex flex-col gap-1.5">
            {rest.map(({ key, label }) => {
              const Icon = permissionIcon(key);
              return (
                <li key={key} className="flex items-center gap-2 text-xs">
                  <Icon className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
                  {label}
                </li>
              );
            })}
          </ul>
        </ClickPopover>
      )}
    </div>
  );
}

function RoleRow({ role, selectedKeys }: { role: RoleRowData; selectedKeys: readonly string[] }) {
  const locked = !role.botManageable && !role.botId && !role.isEveryone;
  return (
    <TableRow className="h-14">
      <TableCell>
        <div className="flex items-center gap-2">
          <span className="flex w-3.5 shrink-0 items-center">
            {locked && <Lock className="text-muted-foreground size-3.5" aria-label="Botからは操作できません" />}
          </span>
          <span
            className="bg-muted-foreground/40 size-3 shrink-0 rounded-full"
            style={{ backgroundColor: roleColor(role.color) }}
            aria-hidden="true"
          />
          <span className="max-w-64 truncate font-medium" title={role.name}>
            {role.name}
          </span>
          {role.botId ? (
            <span className={`${BADGE_BASE} border-violet-500/40 bg-violet-500/10 text-violet-600 ml-auto dark:text-violet-400`}>
              <Bot className="size-3" aria-hidden="true" />
              Bot
            </span>
          ) : (
            !role.botManageable &&
            !role.isEveryone && (
              <span className="ml-auto">
                <ClickPopover
                  label="操作不可の理由を表示"
                  trigger={
                    <span className={`${BADGE_BASE} border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20`}>
                      <TriangleAlert className="size-3" aria-hidden="true" />
                      操作不可
                    </span>
                  }
                >
                  <p className="font-medium">Botからは操作できません</p>
                  <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{lockedReason(role)}</p>
                </ClickPopover>
              </span>
            )
          )}
        </div>
      </TableCell>
      <TableCell className="text-right whitespace-nowrap tabular-nums">
        {role.isEveryone ? (
          "全員"
        ) : role.memberCount === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          NUMBER_FORMAT.format(role.memberCount)
        )}
      </TableCell>
      <TableCell className="max-w-0 w-full">
        <PermissionCell permissions={role.permissions} selectedKeys={selectedKeys} />
      </TableCell>
    </TableRow>
  );
}

export function RolesPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const [nameQuery, setNameQuery] = useState("");
  const [filter, setFilter] = useState<RoleFilterValue>(EMPTY_ROLE_FILTER);
  const query = useQuery({
    ...trpc.roleManagement.list.queryOptions({ guildId: guildId ?? "" }),
    enabled: Boolean(guildId),
  });

  if (!guildId) {
    return (
      <Alert variant="destructive">
        <AlertDescription>サーバーが指定されていません。</AlertDescription>
      </Alert>
    );
  }

  if (isForbiddenError(query.error)) {
    return <ForbiddenState pageName="ロール管理" capabilities={["VIEW_ROLES"]} />;
  }
  if (query.isError) {
    return <ErrorState subject="ロール" onRetry={() => void query.refetch()} />;
  }

  const roles = query.data?.roles ?? [];
  const visibleRoles = filterRoles(roles, nameQuery, filter);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">ロール管理</h1>
        <p className="text-muted-foreground mt-1 text-sm">サーバーのロールを名前・権限・メンバー数で検索・絞り込みできます。</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-64">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden="true" />
          <Input
            type="search"
            className="pl-8"
            placeholder="ロール名で検索"
            aria-label="ロール名で検索"
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
          />
        </div>
        <RoleFilter value={filter} onChange={setFilter} memberCountsAvailable={query.data?.memberCountsAvailable ?? false} />
      </div>

      {query.isPending ? (
        <Loading />
      ) : (
        <>
          <div className="text-muted-foreground text-xs">
            {NUMBER_FORMAT.format(visibleRoles.length)} / {NUMBER_FORMAT.format(roles.length)} ロール
          </div>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ロール</TableHead>
                  <TableHead className="text-right">メンバー</TableHead>
                  <TableHead>主な権限</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRoles.length === 0 ? (
                  <TableRow className="h-14">
                    <TableCell colSpan={3} className="text-muted-foreground text-center text-sm">
                      条件に一致するロールはありません。
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleRoles.map((role) => <RoleRow key={role.id} role={role} selectedKeys={filter.permissionKeys} />)
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
