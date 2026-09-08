import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CAPABILITIES, canGrantCapabilities, type CapabilityName } from "@management-bot/shared";
import { trpc } from "../trpc.js";
import { CAPABILITY_OPTIONS } from "./capability-labels.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
  };
}

function TargetSelect({
  guildId,
  targetType,
  value,
  onChange,
}: {
  guildId: string;
  targetType: TargetType;
  value: string;
  onChange: (value: string) => void;
}) {
  const roleOptionsQuery = useQuery({
    ...trpc.access.listRoleOptions.queryOptions({ guildId }),
    enabled: targetType === "role",
  });
  const memberOptions = useMemberOptions(guildId, targetType === "user");

  const options: readonly TargetOption[] = targetType === "role" ? (roleOptionsQuery.data ?? []) : memberOptions.options;
  const isLoading = targetType === "role" ? roleOptionsQuery.isPending : memberOptions.isPending;
  const isError = targetType === "role" ? roleOptionsQuery.isError : memberOptions.isError;

  return (
    <div className="flex flex-col gap-1">
      <Select value={value} onValueChange={onChange} disabled={isLoading || isError}>
        <SelectTrigger className="w-56" aria-label={targetType === "role" ? "付与先ロール" : "付与先ユーザー"}>
          <SelectValue placeholder={targetType === "role" ? "ロールを選択" : "ユーザーを選択"} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isError && <p className="text-destructive text-xs">候補の取得に失敗しました。</p>}
      {targetType === "user" && memberOptions.nextAfter && (
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

function GrantForm({
  guildId,
  grants,
  granterCapabilities,
}: {
  guildId: string;
  grants: readonly CapabilityGrantData[];
  granterCapabilities: number;
}) {
  const queryClient = useQueryClient();
  const [targetType, setTargetType] = useState<TargetType>("user");
  const [targetId, setTargetId] = useState("");
  const [selectedCapabilities, setSelectedCapabilities] = useState<readonly CapabilityName[]>([]);

  const existingGrant = grants.find((g) => g.targetType === targetType && g.targetId === targetId);

  const mutation = useMutation({
    ...trpc.access.grantCapabilities.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: trpc.access.listCapabilityGrants.queryOptions({ guildId }).queryKey,
      });
      setTargetId("");
      setSelectedCapabilities([]);
    },
  });

  function selectTarget(id: string) {
    setTargetId(id);
    const existing = grants.find((g) => g.targetType === targetType && g.targetId === id);
    setSelectedCapabilities(capabilitiesToNames(existing?.capabilities ?? 0));
  }

  const capabilities = namesToCapabilities(selectedCapabilities);
  const canSubmit = targetId !== "" && capabilities !== 0 && canGrantCapabilities(granterCapabilities, capabilities);

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <h2 className="text-sm font-semibold">権限の付与・更新</h2>
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">付与先の種類</label>
          <Select
            value={targetType}
            onValueChange={(value) => {
              setTargetType(value as TargetType);
              setTargetId("");
              setSelectedCapabilities([]);
            }}
          >
            <SelectTrigger className="w-32" aria-label="付与先の種類">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">ユーザー</SelectItem>
              <SelectItem value="role">ロール</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <TargetSelect guildId={guildId} targetType={targetType} value={targetId} onChange={selectTarget} />
      </div>

      {existingGrant && (
        <p className="text-muted-foreground text-xs">
          既にこの対象へ付与済みの権限が反映されています。保存すると、選択を外した権限は剥奪されます。
        </p>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">権限</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {CAPABILITY_OPTIONS.map((option) => {
            const grantable = (granterCapabilities & option.bit) === option.bit;
            return (
              <label key={option.value} className="flex items-center gap-2 text-sm">
                <Switch
                  checked={selectedCapabilities.includes(option.value)}
                  disabled={!grantable}
                  onCheckedChange={(checked) =>
                    setSelectedCapabilities((prev) =>
                      checked ? [...prev, option.value] : prev.filter((name) => name !== option.value),
                    )
                  }
                />
                {option.label}
              </label>
            );
          })}
        </div>
      </div>

      <Button
        type="button"
        className="w-fit"
        disabled={!canSubmit || mutation.isPending}
        onClick={() => mutation.mutate({ guildId, targetType, targetId, capabilities })}
      >
        {existingGrant ? "更新する" : "付与する"}
      </Button>
      {mutation.isError && (
        <p className="text-destructive text-xs">
          {mutation.error instanceof TRPCClientError && mutation.error.data?.code === "BAD_REQUEST"
            ? "対象がこのサーバーに存在しません。"
            : "保存に失敗しました。"}
        </p>
      )}
    </div>
  );
}

function GrantRow({
  guildId,
  grant,
  targetName,
  granterCapabilities,
}: {
  guildId: string;
  grant: CapabilityGrantData;
  targetName: string;
  granterCapabilities: number;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    ...trpc.access.revokeCapabilityGrant.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: trpc.access.listCapabilityGrants.queryOptions({ guildId }).queryKey,
      }),
  });

  const canRevoke = canGrantCapabilities(granterCapabilities, grant.capabilities);
  const names = capabilitiesToNames(grant.capabilities);

  return (
    <TableRow>
      <TableCell>{grant.targetType === "role" ? "ロール" : "ユーザー"}</TableCell>
      <TableCell>{targetName}</TableCell>
      <TableCell>{names.map((name) => CAPABILITY_OPTIONS.find((o) => o.value === name)?.label).join(", ")}</TableCell>
      <TableCell>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canRevoke || mutation.isPending}
          onClick={() => mutation.mutate({ guildId, targetType: grant.targetType, targetId: grant.targetId })}
        >
          剥奪
        </Button>
        {mutation.isError && <p className="text-destructive text-xs">失敗しました</p>}
      </TableCell>
    </TableRow>
  );
}

export function AccessPage() {
  const { guildId } = useParams<{ guildId: string }>();

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

  const roleNameById = new Map((roleOptionsQuery.data ?? []).map((role) => [role.id, role.name]));
  const granterCapabilities = myCapabilitiesQuery.data.capabilities;
  const grants: readonly CapabilityGrantData[] = grantsQuery.data;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">アクセス権限</h1>

      <GrantForm guildId={guildId} grants={grants} granterCapabilities={granterCapabilities} />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>種類</TableHead>
            <TableHead>対象</TableHead>
            <TableHead>権限</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {grants.map((grant) => (
            <GrantRow
              key={`${grant.targetType}-${grant.targetId}`}
              guildId={guildId}
              grant={grant}
              targetName={
                grant.targetType === "role"
                  ? (roleNameById.get(grant.targetId) ?? (grant.targetId === guildId ? "@everyone" : grant.targetId))
                  : (targetUserNamesQuery.data?.[grant.targetId] ?? grant.targetId)
              }
              granterCapabilities={granterCapabilities}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
