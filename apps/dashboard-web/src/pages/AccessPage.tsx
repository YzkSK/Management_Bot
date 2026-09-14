import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CAPABILITIES, canGrantCapabilities, type CapabilityName } from "@management-bot/shared";
import { trpc } from "../trpc.js";
import { CAPABILITY_GROUPS, CAPABILITY_OPTIONS, CAPABILITY_PRESETS } from "./capability-labels.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type TargetType = "user" | "role";

interface CapabilityGrantData {
  targetType: TargetType;
  targetId: string;
  capabilities: number;
}

function capabilitiesToNames(capabilities: number): CapabilityName[] {
  return CAPABILITY_OPTIONS.filter((option) => (capabilities & option.bit) === option.bit).map(
    (option) => option.value,
  );
}

function namesToCapabilities(names: readonly CapabilityName[]): number {
  return names.reduce((acc, name) => acc | CAPABILITIES[name], 0);
}

interface TargetOption {
  id: string;
  name: string;
}

const FIRST_PAGE_KEY = "__first__";

/**
 * メンバー一覧はページング API(listMemberOptions)なので、取得済みページをカーソル単位で
 * 保持して選択肢にする。キャッシュ済みの先頭ページに戻った場合(react-queryのcacheヒットで
 * query.dataの参照が変わらない場合)でも表示が空にならないよう、単純な「配列に追記」ではなく
 * カーソルをキーにしたmapで各ページの内容を保持・置換する(codexレビュー対応)。
 */
function useMemberOptions(guildId: string, enabled: boolean) {
  const [after, setAfter] = useState<string | undefined>(undefined);
  const [pages, setPages] = useState<Record<string, readonly TargetOption[]>>({});

  useEffect(() => {
    setAfter(undefined);
    setPages({});
  }, [guildId, enabled]);

  const query = useQuery({
    ...trpc.access.listMemberOptions.queryOptions({ guildId, after }),
    enabled,
  });

  useEffect(() => {
    if (!enabled || !query.data) {
      return;
    }
    const pageKey = after ?? FIRST_PAGE_KEY;
    setPages((prev) => ({ ...prev, [pageKey]: query.data.members }));
  }, [enabled, after, query.data]);

  const options = Object.values(pages).flat();

  return {
    options,
    isPending: enabled && options.length === 0 && query.isPending,
    isError: query.isError,
    nextAfter: query.data?.nextAfter,
    isFetchingNextPage: query.isFetching,
    loadNextPage: () => setAfter(query.data?.nextAfter),
    retry: () => query.refetch(),
  };
}

interface SidebarTarget {
  readonly targetType: TargetType;
  readonly targetId: string;
  readonly name: string;
}

function targetKey(target: { targetType: TargetType; targetId: string }): string {
  return `${target.targetType}-${target.targetId}`;
}

/**
 * grant一覧に加え、自分自身の実効capabilitiesも再取得する。@everyone・自分が所属するロール・
 * 自分自身への直接付与を編集した場合、getMyCapabilitiesの値も変化するため、grant一覧だけを
 * invalidateすると保存/剥奪ボタンのdisabled判定が古いままになる(codexレビュー対応)。
 */
function refreshAccessQueries(queryClient: ReturnType<typeof useQueryClient>, guildId: string): Promise<void[]> {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: trpc.access.listCapabilityGrants.queryOptions({ guildId }).queryKey,
    }),
    queryClient.invalidateQueries({
      queryKey: trpc.access.getMyCapabilities.queryOptions({ guildId }).queryKey,
    }),
  ]);
}

/** 新規ユーザーへの初回付与用の対象選択(既存GrantFormのセレクターを踏襲)。 */
function AddUserSelect({
  guildId,
  onSelect,
}: {
  guildId: string;
  onSelect: (target: SidebarTarget) => void;
}) {
  const [open, setOpen] = useState(false);
  const memberOptions = useMemberOptions(guildId, open);

  if (!open) {
    return (
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground flex items-center gap-2 px-2 py-1.5 text-xs font-semibold"
        onClick={() => setOpen(true)}
      >
        + ユーザーを個別に追加
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1 px-2 py-1">
      <Select
        onValueChange={(id) => {
          const option = memberOptions.options.find((o) => o.id === id);
          if (option) {
            onSelect({ targetType: "user", targetId: option.id, name: option.name });
            setOpen(false);
          }
        }}
        disabled={memberOptions.isPending || memberOptions.isError}
      >
        <SelectTrigger className="w-full" aria-label="追加するユーザー">
          <SelectValue placeholder="ユーザーを選択" />
        </SelectTrigger>
        <SelectContent>
          {memberOptions.options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {memberOptions.isError && (
        <div className="flex items-center gap-2">
          <p className="text-destructive text-xs">候補の取得に失敗しました。</p>
          <Button type="button" variant="outline" size="sm" onClick={memberOptions.retry}>
            再試行
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            閉じる
          </Button>
        </div>
      )}
      {memberOptions.nextAfter && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={memberOptions.isFetchingNextPage}
          onClick={memberOptions.loadNextPage}
        >
          さらに読み込む
        </Button>
      )}
    </div>
  );
}

function TargetSidebar({
  guildId,
  roles,
  grantedUsers,
  selected,
  onSelect,
}: {
  guildId: string;
  roles: readonly SidebarTarget[];
  grantedUsers: readonly SidebarTarget[];
  selected: SidebarTarget | undefined;
  onSelect: (target: SidebarTarget) => void;
}) {
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLowerCase();
  const filterByName = (target: SidebarTarget) => target.name.toLowerCase().includes(normalizedSearch);
  const visibleRoles = normalizedSearch === "" ? roles : roles.filter(filterByName);
  const visibleUsers = normalizedSearch === "" ? grantedUsers : grantedUsers.filter(filterByName);

  return (
    <div className="flex w-full flex-col gap-2 sm:w-60 sm:shrink-0">
      <Input
        type="text"
        placeholder="ロール・ユーザーを検索"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="ロール・ユーザーを検索"
      />

      <div className="flex flex-col gap-2 overflow-y-auto">
        <div>
          <div className="text-muted-foreground px-2 py-1 text-xs font-bold">ロール</div>
          <div className="flex flex-col gap-0.5">
            {visibleRoles.map((role) => (
              <button
                key={targetKey(role)}
                type="button"
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                  selected && targetKey(selected) === targetKey(role) ? "bg-accent font-semibold" : ""
                }`}
                onClick={() => onSelect(role)}
              >
                {role.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-muted-foreground px-2 py-1 text-xs font-bold">個別ユーザー</div>
          <div className="flex flex-col gap-0.5">
            {visibleUsers.map((user) => (
              <button
                key={targetKey(user)}
                type="button"
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                  selected && targetKey(selected) === targetKey(user) ? "bg-accent font-semibold" : ""
                }`}
                onClick={() => onSelect(user)}
              >
                {user.name}
              </button>
            ))}
          </div>
          <AddUserSelect guildId={guildId} onSelect={onSelect} />
        </div>
      </div>
    </div>
  );
}

function TargetEditor({
  guildId,
  target,
  existingCapabilities,
  granterCapabilities,
  onSaved,
}: {
  guildId: string;
  target: SidebarTarget;
  existingCapabilities: number;
  granterCapabilities: number;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [selectedCapabilities, setSelectedCapabilities] = useState<readonly CapabilityName[]>(
    capabilitiesToNames(existingCapabilities),
  );

  // 選択対象が切り替わったら、その対象の既存付与状態にトグルをリセットする。
  useEffect(() => {
    setSelectedCapabilities(capabilitiesToNames(existingCapabilities));
  }, [target.targetType, target.targetId, existingCapabilities]);

  const grantMutation = useMutation({
    ...trpc.access.grantCapabilities.mutationOptions(),
    onSuccess: async () => {
      await refreshAccessQueries(queryClient, guildId);
      onSaved();
    },
  });
  const revokeMutation = useMutation({
    ...trpc.access.revokeCapabilityGrant.mutationOptions(),
    onSuccess: async () => {
      await refreshAccessQueries(queryClient, guildId);
      onSaved();
    },
  });

  const capabilities = namesToCapabilities(selectedCapabilities);
  const canSave = capabilities !== 0 && canGrantCapabilities(granterCapabilities, capabilities);
  const canRevokeExisting = existingCapabilities !== 0 && canGrantCapabilities(granterCapabilities, existingCapabilities);
  const isPending = grantMutation.isPending || revokeMutation.isPending;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <h1 className="text-lg font-semibold">{target.name} を編集</h1>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">プリセットから選択</span>
        <div className="flex flex-wrap gap-2">
          {CAPABILITY_PRESETS.map((preset) => (
            <Button
              key={preset.label}
              type="button"
              variant="outline"
              size="sm"
              disabled={!canGrantCapabilities(granterCapabilities, preset.capabilities)}
              onClick={() => setSelectedCapabilities(capabilitiesToNames(preset.capabilities))}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </div>

      {CAPABILITY_GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col gap-2 border-b pb-4">
          <h2 className="text-sm font-semibold">{group.title}</h2>
          {group.items.map((name) => {
            const option = CAPABILITY_OPTIONS.find((o) => o.value === name);
            if (!option) {
              return null;
            }
            const grantable = (granterCapabilities & option.bit) === option.bit;
            return (
              <label key={option.value} className="flex items-center justify-between gap-4 py-1 text-sm">
                <span>{option.label}</span>
                <Switch
                  checked={selectedCapabilities.includes(option.value)}
                  disabled={!grantable}
                  onCheckedChange={(checked) =>
                    setSelectedCapabilities((prev) =>
                      checked ? [...prev, option.value] : prev.filter((n) => n !== option.value),
                    )
                  }
                />
              </label>
            );
          })}
        </div>
      ))}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          disabled={!canSave || isPending}
          onClick={() =>
            grantMutation.mutate({ guildId, targetType: target.targetType, targetId: target.targetId, capabilities })
          }
        >
          保存する
        </Button>
        {existingCapabilities !== 0 && (
          <Button
            type="button"
            variant="outline"
            disabled={!canRevokeExisting || isPending}
            onClick={() =>
              revokeMutation.mutate({ guildId, targetType: target.targetType, targetId: target.targetId })
            }
          >
            剥奪
          </Button>
        )}
      </div>
      {(grantMutation.isError || revokeMutation.isError) && (
        <p className="text-destructive text-xs">
          {grantMutation.error instanceof TRPCClientError && grantMutation.error.data?.code === "BAD_REQUEST"
            ? "対象がこのサーバーに存在しません。"
            : "保存に失敗しました。"}
        </p>
      )}
    </div>
  );
}

function AllGrantsSection({
  guildId,
  grantsWithName,
  granterCapabilities,
}: {
  guildId: string;
  grantsWithName: readonly { grant: CapabilityGrantData; targetName: string }[];
  granterCapabilities: number;
}) {
  const queryClient = useQueryClient();
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(new Set());

  const bulkRevokeMutation = useMutation({
    ...trpc.access.bulkRevokeCapabilityGrants.mutationOptions(),
    onSuccess: async () => {
      await refreshAccessQueries(queryClient, guildId);
      setSelectedKeys(new Set());
    },
  });

  const selectedTargets = grantsWithName
    .map(({ grant }) => grant)
    .filter((grant) => selectedKeys.has(targetKey(grant)));

  return (
    <details className="flex flex-col gap-3 rounded-lg border p-4" open>
      <summary className="cursor-pointer text-sm font-semibold">
        すべての付与状況({grantsWithName.length}件)
      </summary>

      {selectedTargets.length > 0 && (
        <div className="bg-muted flex items-center justify-between gap-2 rounded-lg border px-4 py-2">
          <span className="text-sm font-medium">{selectedTargets.length}件選択中</span>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={bulkRevokeMutation.isPending}
            onClick={() =>
              bulkRevokeMutation.mutate({
                guildId,
                targets: selectedTargets.map(({ targetType, targetId }) => ({ targetType, targetId })),
              })
            }
          >
            選択した権限をまとめて剥奪
          </Button>
        </div>
      )}
      {bulkRevokeMutation.isError && <p className="text-destructive text-xs">剥奪に失敗しました。</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead />
            <TableHead>種類</TableHead>
            <TableHead>対象</TableHead>
            <TableHead>権限</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {grantsWithName.map(({ grant, targetName }) => {
            const key = targetKey(grant);
            const canRevoke = canGrantCapabilities(granterCapabilities, grant.capabilities);
            const names = capabilitiesToNames(grant.capabilities);
            return (
              <TableRow key={key}>
                <TableCell>
                  <Checkbox
                    checked={selectedKeys.has(key)}
                    disabled={!canRevoke}
                    onCheckedChange={(checked) =>
                      setSelectedKeys((prev) => {
                        const next = new Set(prev);
                        if (checked === true) {
                          next.add(key);
                        } else {
                          next.delete(key);
                        }
                        return next;
                      })
                    }
                    aria-label={`${targetName}を選択`}
                  />
                </TableCell>
                <TableCell>{grant.targetType === "role" ? "ロール" : "ユーザー"}</TableCell>
                <TableCell>{targetName}</TableCell>
                <TableCell>
                  {names.map((name) => CAPABILITY_OPTIONS.find((o) => o.value === name)?.label).join(", ")}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </details>
  );
}

export function AccessPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const [selectedTarget, setSelectedTarget] = useState<SidebarTarget | undefined>(undefined);

  const grantsQuery = useQuery({
    ...trpc.access.listCapabilityGrants.queryOptions({ guildId: guildId ?? "" }),
    enabled: Boolean(guildId),
  });
  const myCapabilitiesQuery = useQuery({
    ...trpc.access.getMyCapabilities.queryOptions({ guildId: guildId ?? "" }),
    enabled: Boolean(guildId),
  });
  // grantsQuery/myCapabilitiesQueryがFORBIDDENの場合、この画面自体を使用できないユーザーなので
  // 権限確認前にroleOptions/resolveTargetUserNamesまで発火させない(不要なprocedure呼び出し・
  // consoleのForbiddenログを避ける)。表示専用(対象名の解決)なので、取得に失敗してもgrant一覧・
  // 付与操作自体は継続できるよう、ページ全体のエラー判定には含めない(codexレビュー対応)。
  const hasAccess = Boolean(guildId) && grantsQuery.isSuccess && myCapabilitiesQuery.isSuccess;
  const roleOptionsQuery = useQuery({
    ...trpc.access.listRoleOptions.queryOptions({ guildId: guildId ?? "" }),
    enabled: hasAccess,
  });
  const userTargetIds = (grantsQuery.data ?? [])
    .filter((grant) => grant.targetType === "user")
    .map((grant) => grant.targetId);
  const targetUserNamesQuery = useQuery({
    ...trpc.access.resolveTargetUserNames.queryOptions({ guildId: guildId ?? "", userIds: userTargetIds }),
    enabled: hasAccess && userTargetIds.length > 0,
  });

  if (!guildId) {
    return (
      <Alert variant="destructive">
        <AlertDescription>サーバーが指定されていません。</AlertDescription>
      </Alert>
    );
  }

  const requiredQueries = [grantsQuery, myCapabilitiesQuery];
  const isForbidden = requiredQueries.some(
    (query) => query.error instanceof TRPCClientError && query.error.data?.code === "FORBIDDEN",
  );
  const isPending = requiredQueries.some((query) => query.isPending);
  const isError = requiredQueries.some((query) => query.isError);

  if (isForbidden) {
    return (
      <Alert variant="destructive">
        <AlertDescription>この操作を行う権限がありません。</AlertDescription>
      </Alert>
    );
  }

  if (isPending) {
    return <div className="text-sm">読み込み中...</div>;
  }

  if (isError || !grantsQuery.data || !myCapabilitiesQuery.data) {
    return (
      <Alert variant="destructive">
        <AlertDescription>権限情報の取得に失敗しました。時間をおいて再度お試しください。</AlertDescription>
      </Alert>
    );
  }

  const granterCapabilities = myCapabilitiesQuery.data.capabilities;
  const grants: readonly CapabilityGrantData[] = grantsQuery.data;
  const grantByKey = new Map(grants.map((grant) => [targetKey(grant), grant.capabilities]));
  const roleNameById = new Map((roleOptionsQuery.data?.roles ?? []).map((role) => [role.id, role.name]));

  // ロールはサーバーに実在する全件(未付与も含む)を、ユーザーは既に付与済みのものだけを一覧に出す
  // (全メンバー一覧はlistMemberOptionsのページングAPIしかなく、サイドバー常設には重いため)。
  const roles: readonly SidebarTarget[] = (roleOptionsQuery.data?.roles ?? []).map((role) => ({
    targetType: "role",
    targetId: role.id,
    name: role.id === guildId ? "@everyone" : role.name,
  }));
  const grantedUsers: readonly SidebarTarget[] = grants
    .filter((grant) => grant.targetType === "user")
    .map((grant) => ({
      targetType: "user",
      targetId: grant.targetId,
      name: targetUserNamesQuery.data?.[grant.targetId] ?? grant.targetId,
    }));

  const activeTarget = selectedTarget ?? roles[0] ?? grantedUsers[0];

  const grantsWithName = grants.map((grant) => ({
    grant,
    targetName:
      grant.targetType === "role"
        ? (roleNameById.get(grant.targetId) ?? (grant.targetId === guildId ? "@everyone" : grant.targetId))
        : (targetUserNamesQuery.data?.[grant.targetId] ?? grant.targetId),
  }));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="sr-only">アクセス権限</h1>
      <div className="flex flex-col gap-4 sm:flex-row">
        <TargetSidebar
          guildId={guildId}
          roles={roles}
          grantedUsers={grantedUsers}
          selected={activeTarget}
          onSelect={setSelectedTarget}
        />
        {activeTarget ? (
          <TargetEditor
            guildId={guildId}
            target={activeTarget}
            existingCapabilities={grantByKey.get(targetKey(activeTarget)) ?? 0}
            granterCapabilities={granterCapabilities}
            onSaved={() => {
              /* listCapabilityGrantsの再取得で最新状態に追従するため、選択状態はそのまま維持する。 */
            }}
          />
        ) : (
          <p className="text-muted-foreground text-sm">対象を選択してください。</p>
        )}
      </div>

      <AllGrantsSection guildId={guildId} grantsWithName={grantsWithName} granterCapabilities={granterCapabilities} />
    </div>
  );
}
