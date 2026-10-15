import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { useParams } from "react-router-dom";
import { toast } from "@/components/starwind/toast";
import {
  addCapabilityPrerequisites,
  CAPABILITIES,
  canGrantCapabilities,
  OWNER_ONLY_CAPABILITIES,
  removeUnmetDependents,
  type CapabilityName,
} from "@management-bot/shared";
import { isForbiddenError } from "../dashboard-query-client.js";
import { trpc } from "../trpc.js";
import {
  CAPABILITY_GROUPS,
  CAPABILITY_OPTIONS,
  CAPABILITY_PRESETS,
  CUSTOM_PRESET_LABEL,
  NO_CAPABILITIES_LABEL,
  presetLabelFor,
} from "./capability-labels.js";
import { ErrorState, ForbiddenState, InlineError } from "@/components/page-state";
import { SaveBar } from "@/components/save-bar";
import { Alert, AlertDescription } from "@/components/starwind/alert";
import { Checkbox } from "@/components/starwind/checkbox";
import { Button } from "@/components/starwind/button";
import { Input } from "@/components/starwind/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/starwind/select";
import { Loading } from "@/components/loading";
import { Skeleton } from "@/components/starwind/skeleton";
import { cn } from "@/lib/utils";

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

/** オーナーはgrantに関係なく常に全権限を持つため、プリセット名の代わりにこのラベルを出す(issue #523)。 */
const OWNER_LABEL = "オーナー";

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
  /** 個別ユーザーの名前を解決中か。解決中はIDを見せずスケルトンを出す。 */
  readonly isNameLoading?: boolean;
}

/** 名前解決中はIDの代わりにスケルトンを出し、失敗・未解決のときだけIDにフォールバックする(#503と同じ方針)。 */
function TargetName({ target }: { target: SidebarTarget }) {
  if (target.isNameLoading) {
    return <Skeleton className="inline-block h-4 w-24 align-middle" aria-label="名前を読み込み中" />;
  }
  return <>{target.name}</>;
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
  presetOf,
}: {
  guildId: string;
  roles: readonly SidebarTarget[];
  grantedUsers: readonly SidebarTarget[];
  selected: SidebarTarget | undefined;
  onSelect: (target: SidebarTarget) => void;
  presetOf: (target: SidebarTarget) => string;
}) {
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLowerCase();
  const filterByName = (target: SidebarTarget) => target.name.toLowerCase().includes(normalizedSearch);
  const visibleRoles = normalizedSearch === "" ? roles : roles.filter(filterByName);
  const visibleUsers = normalizedSearch === "" ? grantedUsers : grantedUsers.filter(filterByName);

  return (
    <div className="bg-card flex max-h-[calc(100dvh-14rem)] w-72 shrink-0 flex-col gap-2 rounded-xl border p-3">
      <Input
        type="text"
        placeholder="ロール・ユーザーを検索"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="ロール・ユーザーを検索"
      />

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        <div>
          <div className="text-muted-foreground px-2 py-1 text-xs font-bold">ロール</div>
          <div className="flex flex-col gap-0.5">
            {visibleRoles.map((role) => (
              <button
                key={targetKey(role)}
                type="button"
                className={cn(
                  "flex min-h-10 items-center justify-between gap-2 rounded-md px-2 text-left text-sm hover:bg-accent/60",
                  selected && targetKey(selected) === targetKey(role) && "bg-accent font-semibold",
                )}
                onClick={() => onSelect(role)}
              >
                <span className="min-w-0 truncate">{role.name}</span>
                <span className="text-muted-foreground shrink-0 text-xs font-normal">{presetOf(role)}</span>
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
                className={cn(
                  "flex min-h-10 items-center justify-between gap-2 rounded-md px-2 text-left text-sm hover:bg-accent/60",
                  selected && targetKey(selected) === targetKey(user) && "bg-accent font-semibold",
                )}
                onClick={() => onSelect(user)}
              >
                <span className="min-w-0 truncate">
                  <TargetName target={user} />
                </span>
                <span className="text-muted-foreground shrink-0 text-xs font-normal">{presetOf(user)}</span>
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
  isOwner,
  lockReason,
}: {
  guildId: string;
  target: SidebarTarget;
  existingCapabilities: number;
  granterCapabilities: number;
  /** オーナー専用capability(OWNER_ONLY_CAPABILITIES)を変更できるのはサーバーオーナーのみ(issue #618)。 */
  isOwner: boolean;
  /**
   * 編集・剥奪させない理由。オーナーの実効権限はgrantで変わらないため編集させない(issue #523)。
   * オーナー判定が付かない間(取得中・失敗)も、オーナーの付与を誤って剥奪しないよう個別ユーザーは編集させない。
   */
  lockReason: string | undefined;
}) {
  const queryClient = useQueryClient();
  const [selectedCapabilities, setSelectedCapabilities] = useState<readonly CapabilityName[]>(
    capabilitiesToNames(existingCapabilities),
  );

  // 選択対象が切り替わったら、その対象の既存付与状態にトグルをリセットする。
  // 同じ対象で既存付与がサーバー側で変わった場合(他の管理者の変更・リアルタイム更新, #643)は、
  // 未保存の編集(既存付与と異なる選択)があるときはそれを消さず、編集前だったときだけ追従する。
  const previousRef = useRef({ key: `${target.targetType}-${target.targetId}`, existing: existingCapabilities });
  useEffect(() => {
    const previous = previousRef.current;
    const key = `${target.targetType}-${target.targetId}`;
    previousRef.current = { key, existing: existingCapabilities };
    setSelectedCapabilities((current) =>
      key !== previous.key || namesToCapabilities(current) === previous.existing
        ? capabilitiesToNames(existingCapabilities)
        : current,
    );
  }, [target.targetType, target.targetId, existingCapabilities]);

  const onError = (error: unknown) =>
    toast.error(
      error instanceof TRPCClientError && error.data?.code === "BAD_REQUEST"
        ? "対象がこのサーバーに存在しません。"
        : "保存に失敗しました。時間をおいて再度お試しください。",
    );
  const grantMutation = useMutation({
    ...trpc.access.grantCapabilities.mutationOptions(),
    onSuccess: async () => {
      toast.success("保存しました");
      await refreshAccessQueries(queryClient, guildId);
    },
    onError,
  });
  const revokeMutation = useMutation({
    ...trpc.access.revokeCapabilityGrant.mutationOptions(),
    onSuccess: async () => {
      toast.success("権限を剥奪しました");
      await refreshAccessQueries(queryClient, guildId);
    },
    onError,
  });

  const isLocked = lockReason !== undefined;
  const capabilities = namesToCapabilities(selectedCapabilities);
  const dirty = capabilities !== existingCapabilities;
  // 全て外して保存した場合は付与自体を剥奪する。既存付与・新しい付与のどちらも自分の権限の範囲内でなければ保存できない。
  // オーナー専用bitは非オーナーには委譲判定の対象外(変更不可。サーバー側のgrantCapabilitiesが最終判定)。
  const ownerOnlyLocked = isOwner ? 0 : OWNER_ONLY_CAPABILITIES;
  const canSave =
    canGrantCapabilities(granterCapabilities & ~ownerOnlyLocked, capabilities & ~ownerOnlyLocked) &&
    canGrantCapabilities(granterCapabilities & ~ownerOnlyLocked, existingCapabilities & ~ownerOnlyLocked);
  const isPending = grantMutation.isPending || revokeMutation.isPending;
  const currentPreset = presetLabelFor(capabilities);
  const isOffPreset = currentPreset === CUSTOM_PRESET_LABEL || currentPreset === NO_CAPABILITIES_LABEL;

  const save = () => {
    if (!canSave) {
      toast.error("自分が持っていない権限は付与・変更できません。");
      return;
    }
    if (capabilities === 0) {
      revokeMutation.mutate({ guildId, targetType: target.targetType, targetId: target.targetId });
    } else {
      grantMutation.mutate({ guildId, targetType: target.targetType, targetId: target.targetId, capabilities });
    }
  };

  return (
    <section className="bg-card flex min-w-0 flex-1 flex-col gap-4 rounded-xl border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">
          <TargetName target={target} /> を編集
        </h2>
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          プリセットから選択
          <Select
            value={currentPreset}
            disabled={isLocked}
            onValueChange={(label) => {
              const preset = CAPABILITY_PRESETS.find((p) => p.label === label);
              // 非オーナーはオーナー専用bitを変更できないため、既存の状態を保つ。
              if (preset) {
                setSelectedCapabilities(
                  capabilitiesToNames(
                    (preset.capabilities & ~ownerOnlyLocked) | (existingCapabilities & ownerOnlyLocked),
                  ),
                );
              }
            }}
          >
            <SelectTrigger className="w-36" aria-label="権限プリセット">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {isOffPreset && (
                <SelectItem value={currentPreset} disabled>
                  {currentPreset}
                </SelectItem>
              )}
              {CAPABILITY_PRESETS.map((preset) => (
                <SelectItem
                  key={preset.label}
                  value={preset.label}
                  disabled={
                    !canGrantCapabilities(granterCapabilities & ~ownerOnlyLocked, preset.capabilities & ~ownerOnlyLocked)
                  }
                >
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      {isLocked && (
        <Alert>
          <Lock />
          <AlertDescription>{lockReason}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
        {CAPABILITY_GROUPS.map((group) => (
          <div key={group.title} className="flex flex-col gap-1 border-b pb-3">
            <h3 className="text-sm font-semibold">{group.title}</h3>
            {group.items.map((name) => {
              const option = CAPABILITY_OPTIONS.find((o) => o.value === name);
              if (!option) {
                return null;
              }
              const ownerOnlyBlocked = (ownerOnlyLocked & option.bit) !== 0;
              const grantable = !isLocked && !ownerOnlyBlocked && (granterCapabilities & option.bit) === option.bit;
              return (
                <label
                  key={option.value}
                  className={cn("flex min-h-9 items-center gap-2.5 text-sm", grantable ? "cursor-pointer" : "text-muted-foreground")}
                >
                  <Checkbox
                    aria-label={option.label}
                    checked={selectedCapabilities.includes(option.value)}
                    disabled={!grantable}
                    onCheckedChange={(checked) =>
                      // 管理権限をONにすると前提の閲覧権限もONに、閲覧権限をOFFにすると依存する権限もOFFにする(issue #527)。
                      setSelectedCapabilities((prev) => {
                        const current = namesToCapabilities(prev);
                        return capabilitiesToNames(
                          checked
                            ? addCapabilityPrerequisites(current | option.bit)
                            : removeUnmetDependents(current & ~option.bit),
                        );
                      })
                    }
                  />
                  {option.label}
                  {ownerOnlyBlocked && <span className="text-xs">(サーバーオーナーのみ変更できます)</span>}
                </label>
              );
            })}
          </div>
        ))}
      </div>

      <SaveBar
        dirty={!isLocked && dirty}
        saving={isPending}
        onSave={save}
        onDiscard={() => setSelectedCapabilities(capabilitiesToNames(existingCapabilities))}
      />
    </section>
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

  const ownerQuery = useQuery({
    ...trpc.access.getGuildOwner.queryOptions({ guildId: guildId ?? "" }),
    enabled: hasAccess,
  });

  if (!guildId) {
    return (
      <Alert variant="error">
        <AlertDescription>サーバーが指定されていません。</AlertDescription>
      </Alert>
    );
  }

  const requiredQueries = [grantsQuery, myCapabilitiesQuery];
  const isPending = requiredQueries.some((query) => query.isPending);
  const isError = requiredQueries.some((query) => query.isError);

  if (requiredQueries.some((query) => isForbiddenError(query.error))) {
    return <ForbiddenState pageName="アクセス権限" capabilities={["MANAGE_ACCESS"]} />;
  }

  if (isPending) {
    return <Loading />;
  }

  if (isError || !grantsQuery.data || !myCapabilitiesQuery.data) {
    return (
      <ErrorState
        subject="アクセス権限"
        onRetry={() => requiredQueries.filter((query) => query.isError).forEach((query) => void query.refetch())}
      />
    );
  }

  const granterCapabilities = myCapabilitiesQuery.data.capabilities;
  const grants: readonly CapabilityGrantData[] = grantsQuery.data;
  const grantByKey = new Map(grants.map((grant) => [targetKey(grant), grant.capabilities]));

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
      isNameLoading: targetUserNamesQuery.isPending,
    }));

  // selectedTargetは選択時点のコピーのため、名前解決後の表示に追従するよう最新の一覧から引き直す。
  const activeTarget =
    (selectedTarget && [...roles, ...grantedUsers].find((t) => targetKey(t) === targetKey(selectedTarget))) ??
    selectedTarget ??
    roles[0] ??
    grantedUsers[0];
  const ownerId = ownerQuery.data?.ownerId;
  const isOwnerTarget = (target: SidebarTarget) => target.targetType === "user" && target.targetId === ownerId;
  const lockReasonOf = (target: SidebarTarget): string | undefined => {
    if (target.targetType !== "user") return undefined;
    if (ownerQuery.isPending) return "オーナー情報を確認中です。";
    if (ownerQuery.isError) return "オーナー情報の取得に失敗したため、個別ユーザーの権限は編集できません。";
    return isOwnerTarget(target) ? "サーバーオーナーは常にすべての権限を持つため、編集・剥奪できません。" : undefined;
  };
  const presetOf = (target: SidebarTarget) =>
    isOwnerTarget(target) ? OWNER_LABEL : presetLabelFor(grantByKey.get(targetKey(target)) ?? 0);
  const allTargets = [...roles, ...grantedUsers];
  // 追加直後で一覧(付与済み)にまだ無い個別ユーザーも選択欄に出す
  const selectableTargets =
    activeTarget && !allTargets.some((t) => targetKey(t) === targetKey(activeTarget)) ? [...allTargets, activeTarget] : allTargets;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">アクセス権限</h1>
      {roleOptionsQuery.isError && (
        <InlineError summary="ロール一覧を読み込めませんでした。" onRetry={() => void roleOptionsQuery.refetch()} />
      )}
      {targetUserNamesQuery.isError && (
        <InlineError
          summary="ユーザー名を読み込めませんでした。"
          detail="一部の名前がIDで表示されています。"
          onRetry={() => void targetUserNamesQuery.refetch()}
        />
      )}
      {/* 狭い画面では一覧と編集欄を縦に積むとスクロールが増えるため、対象は選択欄で選ぶ */}
      <div className="flex flex-col gap-2 lg:hidden">
        <label className="text-muted-foreground flex flex-col gap-1.5 text-sm">
          編集する対象
          <Select
            value={activeTarget ? targetKey(activeTarget) : undefined}
            onValueChange={(key) => setSelectedTarget(selectableTargets.find((t) => targetKey(t) === key))}
          >
            <SelectTrigger className="w-full" aria-label="編集する対象">
              {/* Starwindのトリガー表示は文字列のみのため、選択中の項目と同じ内容を明示する */}
              <SelectValue placeholder="対象を選択">
                {activeTarget && (
                  <>
                    <TargetName target={activeTarget} />({presetOf(activeTarget)})
                  </>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {selectableTargets.map((target) => (
                <SelectItem key={targetKey(target)} value={targetKey(target)}>
                  <TargetName target={target} />({presetOf(target)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <AddUserSelect guildId={guildId} onSelect={setSelectedTarget} />
      </div>
      <div className="flex items-start gap-4">
        {/* 一覧は画面に収まる高さに抑え、ロール・ユーザーの部分だけをスクロールさせる(ヘッダー・フッター・見出し分を差し引く) */}
        <div className="sticky top-0 hidden lg:flex">
          <TargetSidebar
            guildId={guildId}
            roles={roles}
            grantedUsers={grantedUsers}
            selected={activeTarget}
            onSelect={setSelectedTarget}
            presetOf={presetOf}
          />
        </div>
        {activeTarget ? (
          <TargetEditor
            guildId={guildId}
            target={activeTarget}
            existingCapabilities={grantByKey.get(targetKey(activeTarget)) ?? 0}
            granterCapabilities={granterCapabilities}
            isOwner={myCapabilitiesQuery.data.isOwner}
            lockReason={lockReasonOf(activeTarget)}
          />
        ) : (
          <p className="text-muted-foreground text-sm">対象を選択してください。</p>
        )}
      </div>
    </div>
  );
}
