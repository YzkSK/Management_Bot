import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  MODERATION_PRESETS,
  MODERATION_VIOLATION_TYPES,
  type ModerationEscalationViolationType,
  type ModerationPreset,
  type ModerationViolationType,
} from "@management-bot/shared";
import { trpc } from "../trpc.js";
import {
  describePreset,
  ESCALATION_DESCRIPTIONS,
  NGWORD_MATCH_TYPE_LABELS,
  PRESET_LABELS,
  VIOLATION_TYPE_LABELS,
  type NgwordMatchType,
} from "./moderation-labels.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type TargetType = "user" | "role";

interface ThresholdSetting {
  violationType: ModerationViolationType;
  preset: ModerationPreset;
  enabled: boolean;
}

interface WhitelistEntry {
  targetType: TargetType;
  targetId: string;
}

/** DBに未設定のviolationTypeはenabled=false/preset=mediumとして表示する(デフォルト行の補完)。 */
function withDefaults(settings: readonly ThresholdSetting[]): ThresholdSetting[] {
  const byType = new Map(settings.map((s) => [s.violationType, s]));
  return MODERATION_VIOLATION_TYPES.map(
    (violationType) => byType.get(violationType) ?? { violationType, preset: "medium", enabled: false },
  );
}

function ThresholdTableRow({ guildId, row }: { guildId: string; row: ThresholdSetting }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    ...trpc.moderation.setThreshold.mutationOptions(),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: trpc.moderation.listThresholds.queryOptions({ guildId }).queryKey }),
  });

  return (
    <TableRow>
      <TableCell>{VIOLATION_TYPE_LABELS[row.violationType]}</TableCell>
      <TableCell>
        <Switch
          checked={row.enabled}
          disabled={mutation.isPending}
          aria-label={`${VIOLATION_TYPE_LABELS[row.violationType]}の検知を有効化`}
          onCheckedChange={(checked) =>
            mutation.mutate({ guildId, violationType: row.violationType, preset: row.preset, enabled: checked })
          }
        />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Select
            value={row.preset}
            disabled={mutation.isPending}
            onValueChange={(value) =>
              mutation.mutate({
                guildId,
                violationType: row.violationType,
                preset: value as ModerationPreset,
                enabled: row.enabled,
              })
            }
          >
            <SelectTrigger className="w-24" aria-label={`${VIOLATION_TYPE_LABELS[row.violationType]}の強度`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODERATION_PRESETS.map((preset) => (
                <SelectItem key={preset} value={preset}>
                  {PRESET_LABELS[preset]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground text-xs underline decoration-dotted"
                aria-label={`${PRESET_LABELS[row.preset]}の検知条件を表示`}
              >
                詳細
              </button>
            </TooltipTrigger>
            <TooltipContent>{describePreset(row.violationType, row.preset)}</TooltipContent>
          </Tooltip>
        </div>
      </TableCell>
      <TableCell className="text-destructive text-xs">{mutation.isError ? "保存に失敗しました" : null}</TableCell>
    </TableRow>
  );
}

function EscalationPresetSelector({ guildId }: { guildId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery(trpc.moderation.getEscalationPreset.queryOptions({ guildId }));
  const mutation = useMutation({
    ...trpc.moderation.setEscalationPreset.mutationOptions(),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: trpc.moderation.getEscalationPreset.queryOptions({ guildId }).queryKey,
      }),
  });

  if (query.isPending) return <div className="text-sm">読み込み中...</div>;

  return (
    <div className="flex items-center gap-2 rounded-lg border p-4">
      <label className="text-sm font-medium">エスカレーション強度(何回目の違反で警告/削除/タイムアウト等になるか)</label>
      <Select
        value={query.data}
        disabled={mutation.isPending}
        onValueChange={(value) => mutation.mutate({ guildId, preset: value as ModerationPreset })}
      >
        <SelectTrigger className="w-24" aria-label="エスカレーション強度">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MODERATION_PRESETS.map((preset) => (
            <SelectItem key={preset} value={preset}>
              {PRESET_LABELS[preset]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {query.data && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground text-xs underline decoration-dotted"
              aria-label={`${PRESET_LABELS[query.data]}のエスカレーション段階を表示`}
            >
              詳細
            </button>
          </TooltipTrigger>
          <TooltipContent>{ESCALATION_DESCRIPTIONS[query.data]}</TooltipContent>
        </Tooltip>
      )}
      {mutation.isError && <p className="text-destructive text-xs">保存に失敗しました</p>}
    </div>
  );
}

interface TargetOption {
  id: string;
  name: string;
}

const FIRST_PAGE_KEY = "__first__";

/** AccessPageのuseMemberOptionsと同様、ページング結果をカーソル単位で保持する。 */
function useMemberOptions(guildId: string, enabled: boolean) {
  const [after, setAfter] = useState<string | undefined>(undefined);
  const [pages, setPages] = useState<Record<string, readonly TargetOption[]>>({});

  useEffect(() => {
    setAfter(undefined);
    setPages({});
  }, [guildId, enabled]);

  const query = useQuery({
    ...trpc.moderation.listMemberOptions.queryOptions({ guildId, after }),
    enabled,
  });

  useEffect(() => {
    if (!enabled || !query.data) return;
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
    ...trpc.moderation.listRoleOptions.queryOptions({ guildId }),
    enabled: targetType === "role",
  });
  const memberOptions = useMemberOptions(guildId, targetType === "user");

  const options: readonly TargetOption[] =
    targetType === "role" ? (roleOptionsQuery.data?.roles ?? []) : memberOptions.options;
  const isLoading = targetType === "role" ? roleOptionsQuery.isPending : memberOptions.isPending;
  const isError = targetType === "role" ? roleOptionsQuery.isError : memberOptions.isError;

  return (
    <div className="flex flex-col gap-1">
      <Select value={value} onValueChange={onChange} disabled={isLoading || isError}>
        <SelectTrigger className="w-56" aria-label={targetType === "role" ? "ホワイトリスト対象ロール" : "ホワイトリスト対象ユーザー"}>
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

function WhitelistForm({ guildId }: { guildId: string }) {
  const queryClient = useQueryClient();
  const [targetType, setTargetType] = useState<TargetType>("user");
  const [targetId, setTargetId] = useState("");

  const mutation = useMutation({
    ...trpc.moderation.addToWhitelist.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: trpc.moderation.listWhitelist.queryOptions({ guildId }).queryKey,
      });
      setTargetId("");
    },
  });

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <h2 className="text-sm font-semibold">ホワイトリストへの追加</h2>
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">種類</label>
          <Select
            value={targetType}
            onValueChange={(value) => {
              setTargetType(value as TargetType);
              setTargetId("");
            }}
          >
            <SelectTrigger className="w-32" aria-label="ホワイトリスト対象の種類">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">ユーザー</SelectItem>
              <SelectItem value="role">ロール</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <TargetSelect guildId={guildId} targetType={targetType} value={targetId} onChange={setTargetId} />
        <Button
          type="button"
          disabled={targetId === "" || mutation.isPending}
          onClick={() => mutation.mutate({ guildId, targetType, targetId })}
        >
          追加
        </Button>
      </div>
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

function WhitelistTableRow({
  guildId,
  entry,
  targetName,
}: {
  guildId: string;
  entry: WhitelistEntry;
  targetName: string;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    ...trpc.moderation.removeFromWhitelist.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: trpc.moderation.listWhitelist.queryOptions({ guildId }).queryKey,
      }),
  });

  return (
    <TableRow>
      <TableCell>{entry.targetType === "role" ? "ロール" : "ユーザー"}</TableCell>
      <TableCell>{targetName}</TableCell>
      <TableCell>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({ guildId, targetType: entry.targetType, targetId: entry.targetId })}
        >
          削除
        </Button>
        {mutation.isError && <p className="text-destructive text-xs">失敗しました</p>}
      </TableCell>
    </TableRow>
  );
}

interface NgwordEntry {
  id: string;
  matchType: NgwordMatchType;
  pattern: string;
}

function NgwordForm({ guildId }: { guildId: string }) {
  const queryClient = useQueryClient();
  const [matchType, setMatchType] = useState<NgwordMatchType>("exact");
  const [pattern, setPattern] = useState("");

  const mutation = useMutation({
    ...trpc.moderation.addNgword.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: trpc.moderation.listNgwords.queryOptions({ guildId }).queryKey });
      setPattern("");
    },
  });

  const isUnsafeRegexError =
    mutation.error instanceof TRPCClientError && mutation.error.data?.code === "BAD_REQUEST";

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <h2 className="text-sm font-semibold">NGワードの追加</h2>
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">種類</label>
          <Select value={matchType} onValueChange={(value) => setMatchType(value as NgwordMatchType)}>
            <SelectTrigger className="w-32" aria-label="NGワードの一致方式">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(NGWORD_MATCH_TYPE_LABELS) as NgwordMatchType[]).map((type) => (
                <SelectItem key={type} value={type}>
                  {NGWORD_MATCH_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">パターン</label>
          <Input
            className="w-64"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder={matchType === "regex" ? "^ng-word\\d*$" : "NGワード"}
            aria-label="NGワードのパターン"
          />
        </div>
        <Button
          type="button"
          disabled={pattern === "" || mutation.isPending}
          onClick={() => mutation.mutate({ guildId, matchType, pattern })}
        >
          追加
        </Button>
      </div>
      {mutation.isError && (
        <p className="text-destructive text-xs">
          {isUnsafeRegexError
            ? "安全性が確認できない正規表現のため登録できません(ネストした量指定子等)。パターンを見直してください。"
            : "保存に失敗しました。"}
        </p>
      )}
    </div>
  );
}

function NgwordTableRow({ guildId, entry }: { guildId: string; entry: NgwordEntry }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    ...trpc.moderation.removeNgword.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: trpc.moderation.listNgwords.queryOptions({ guildId }).queryKey }),
  });

  return (
    <TableRow>
      <TableCell>{NGWORD_MATCH_TYPE_LABELS[entry.matchType]}</TableCell>
      <TableCell className="font-mono text-sm">{entry.pattern}</TableCell>
      <TableCell>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({ guildId, id: entry.id })}
        >
          削除
        </Button>
        {mutation.isError && <p className="text-destructive text-xs">失敗しました</p>}
      </TableCell>
    </TableRow>
  );
}

function NgwordTab({ guildId }: { guildId: string }) {
  const query = useQuery(trpc.moderation.listNgwords.queryOptions({ guildId }));

  return (
    <div className="flex flex-col gap-3">
      <NgwordForm guildId={guildId} />
      {query.isPending && <div className="text-sm">読み込み中...</div>}
      {query.isError && (
        <Alert variant="destructive">
          <AlertDescription>NGワード一覧の取得に失敗しました。時間をおいて再度お試しください。</AlertDescription>
        </Alert>
      )}
      {query.data && query.data.length === 0 && (
        <p className="text-muted-foreground text-sm">登録されたNGワードはありません。</p>
      )}
      {query.data && query.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>種類</TableHead>
              <TableHead>パターン</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data.map((entry) => (
              <NgwordTableRow key={entry.id} guildId={guildId} entry={entry} />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

interface StrikeEntry {
  userId: string;
  violationType: ModerationEscalationViolationType;
  strikeCount: number;
  lastViolationAt: string | Date;
}

function groupStrikesByUser(
  rows: readonly StrikeEntry[],
): { userId: string; total: number; entries: StrikeEntry[] }[] {
  const byUser = new Map<string, StrikeEntry[]>();
  for (const row of rows) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }
  return [...byUser.entries()].map(([userId, entries]) => ({
    userId,
    total: entries.reduce((sum, e) => sum + e.strikeCount, 0),
    entries,
  }));
}

function UserStrikeGroup({
  guildId,
  after,
  group,
  userName,
}: {
  guildId: string;
  after: string | undefined;
  group: { userId: string; total: number; entries: StrikeEntry[] };
  userName: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();
  const resetAllMutation = useMutation({
    ...trpc.moderation.resetAllStrikes.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: trpc.moderation.listStrikes.queryOptions({ guildId, after }).queryKey,
      }),
  });

  return (
    <>
      <TableRow>
        <TableCell>
          <button type="button" className="underline decoration-dotted" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "▾" : "▸"} {userName}
          </button>
        </TableCell>
        <TableCell>{group.total}</TableCell>
        <TableCell>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={resetAllMutation.isPending}
            onClick={() => resetAllMutation.mutate({ guildId, userId: group.userId })}
          >
            全種別リセット
          </Button>
          {resetAllMutation.isError && <p className="text-destructive text-xs">失敗しました</p>}
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={3} className="bg-muted/30 p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">種別</TableHead>
                  <TableHead>警告回数</TableHead>
                  <TableHead>最終違反日時</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.entries.map((entry) => (
                  <StrikeDetailRow key={`${entry.userId}-${entry.violationType}`} guildId={guildId} after={after} entry={entry} />
                ))}
              </TableBody>
            </Table>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function StrikeDetailRow({
  guildId,
  after,
  entry,
}: {
  guildId: string;
  after: string | undefined;
  entry: StrikeEntry;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    ...trpc.moderation.resetStrike.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: trpc.moderation.listStrikes.queryOptions({ guildId, after }).queryKey,
      }),
  });

  return (
    <TableRow>
      <TableCell className="pl-6">{VIOLATION_TYPE_LABELS[entry.violationType]}</TableCell>
      <TableCell>{entry.strikeCount}</TableCell>
      <TableCell>{new Date(entry.lastViolationAt).toLocaleString("ja-JP")}</TableCell>
      <TableCell>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({ guildId, userId: entry.userId, violationType: entry.violationType })}
        >
          リセット
        </Button>
        {mutation.isError && <p className="text-destructive text-xs">失敗しました</p>}
      </TableCell>
    </TableRow>
  );
}

/** AccessPageのuseMemberOptions/useMemberOptions(本ファイル)と同様、ページング結果をカーソル単位で保持する。 */
function useStrikePages(guildId: string) {
  const [after, setAfter] = useState<string | undefined>(undefined);
  const [pages, setPages] = useState<Record<string, { rows: StrikeEntry[]; userNames: Record<string, string> }>>({});

  useEffect(() => {
    setAfter(undefined);
    setPages({});
  }, [guildId]);

  const query = useQuery(trpc.moderation.listStrikes.queryOptions({ guildId, after }));

  useEffect(() => {
    if (!query.data) return;
    const pageKey = after ?? FIRST_PAGE_KEY;
    setPages((prev) => ({ ...prev, [pageKey]: { rows: query.data.rows, userNames: query.data.userNames } }));
  }, [after, query.data]);

  const rows = Object.values(pages).flatMap((p) => p.rows);
  const userNames = Object.assign({}, ...Object.values(pages).map((p) => p.userNames)) as Record<string, string>;

  return {
    rows,
    userNames,
    after,
    isPending: rows.length === 0 && query.isPending,
    isError: query.isError,
    nextAfter: query.data?.nextAfter,
    isFetchingNextPage: query.isFetching,
    loadNextPage: () => setAfter(query.data?.nextAfter),
  };
}

function StrikeTab({ guildId }: { guildId: string }) {
  const { rows, userNames, after, isPending, isError, nextAfter, isFetchingNextPage, loadNextPage } =
    useStrikePages(guildId);

  if (isPending) {
    return <div className="text-sm">読み込み中...</div>;
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>警告回数の取得に失敗しました。時間をおいて再度お試しください。</AlertDescription>
      </Alert>
    );
  }

  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">警告履歴はありません。</p>;
  }

  const groups = groupStrikesByUser(rows);

  return (
    <div className="flex flex-col gap-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ユーザー</TableHead>
            <TableHead>合計警告回数</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => (
            <UserStrikeGroup
              key={group.userId}
              guildId={guildId}
              after={after}
              group={group}
              userName={userNames[group.userId] ?? group.userId}
            />
          ))}
        </TableBody>
      </Table>
      {nextAfter && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={isFetchingNextPage}
          onClick={loadNextPage}
        >
          さらに読み込む
        </Button>
      )}
    </div>
  );
}

type ModerationTab = "thresholds" | "ngwords" | "whitelist" | "strikes";

export function ModerationPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const [tab, setTab] = useState<ModerationTab>("thresholds");
  const isWhitelistTab = tab === "whitelist";

  const thresholdsQuery = useQuery({
    ...trpc.moderation.listThresholds.queryOptions({ guildId: guildId ?? "" }),
    enabled: Boolean(guildId),
  });
  const whitelistQuery = useQuery({
    ...trpc.moderation.listWhitelist.queryOptions({ guildId: guildId ?? "" }),
    enabled: Boolean(guildId) && isWhitelistTab,
  });
  const permissionStatusQuery = useQuery({
    ...trpc.moderation.getRequiredPermissionStatus.queryOptions({ guildId: guildId ?? "" }),
    enabled: Boolean(guildId),
  });
  const roleOptionsQuery = useQuery({
    ...trpc.moderation.listRoleOptions.queryOptions({ guildId: guildId ?? "" }),
    enabled: Boolean(guildId) && isWhitelistTab,
  });

  if (!guildId) {
    return (
      <Alert variant="destructive">
        <AlertDescription>サーバーが指定されていません。</AlertDescription>
      </Alert>
    );
  }

  const isForbidden = thresholdsQuery.error instanceof TRPCClientError && thresholdsQuery.error.data?.code === "FORBIDDEN";

  if (isForbidden) {
    return (
      <Alert variant="destructive">
        <AlertDescription>この操作を行う権限がありません。</AlertDescription>
      </Alert>
    );
  }

  if (thresholdsQuery.isPending) {
    return <div className="text-sm">読み込み中...</div>;
  }

  if (thresholdsQuery.isError || !thresholdsQuery.data) {
    return (
      <Alert variant="destructive">
        <AlertDescription>設定の取得に失敗しました。時間をおいて再度お試しください。</AlertDescription>
      </Alert>
    );
  }

  const roleNameById = new Map((roleOptionsQuery.data?.roles ?? []).map((role) => [role.id, role.name]));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">スパム対策</h1>

      {permissionStatusQuery.data?.accessStatus === "not_found" && (
        <Alert variant="destructive">
          <AlertDescription>このサーバーにBotが参加していません。</AlertDescription>
        </Alert>
      )}
      {permissionStatusQuery.data && !permissionStatusQuery.data.hasRequiredPermissions && (
        <Alert variant="destructive">
          <AlertDescription>
            Botの基本権限(メッセージ削除・タイムアウト・キック/BAN)が不足しています。
            対象のロール階層やチャンネル個別設定によっては、権限を満たしていても実行に失敗する場合があります。
            {permissionStatusQuery.data.reauthorizeUrl && (
              <>
                {" "}
                <a
                  href={permissionStatusQuery.data.reauthorizeUrl}
                  className="underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  必要な権限を付与してBotを再認可する
                </a>
              </>
            )}
          </AlertDescription>
        </Alert>
      )}
      {roleOptionsQuery.data?.accessStatus === "forbidden" && (
        <Alert variant="destructive">
          <AlertDescription>
            Botに権限がないため、ロール一覧を取得できません。サーバー設定でBotの権限を確認してください。
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={(value) => setTab(value as ModerationTab)}>
        <TabsList aria-label="スパム対策の設定">
          <TabsTrigger value="thresholds">検知設定</TabsTrigger>
          <TabsTrigger value="ngwords">NGワード</TabsTrigger>
          <TabsTrigger value="whitelist">ホワイトリスト</TabsTrigger>
          <TabsTrigger value="strikes">警告回数</TabsTrigger>
        </TabsList>

        <TabsContent value="thresholds">
          <EscalationPresetSelector guildId={guildId} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>種別</TableHead>
                <TableHead>有効化</TableHead>
                <TableHead>強度</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {withDefaults(thresholdsQuery.data).map((row) => (
                <ThresholdTableRow key={row.violationType} guildId={guildId} row={row} />
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="ngwords">
          <NgwordTab guildId={guildId} />
        </TabsContent>

        <TabsContent value="whitelist">
          <WhitelistForm guildId={guildId} />
          {whitelistQuery.isPending && <div className="text-sm">読み込み中...</div>}
          {whitelistQuery.isError && (
            <Alert variant="destructive">
              <AlertDescription>ホワイトリストの取得に失敗しました。時間をおいて再度お試しください。</AlertDescription>
            </Alert>
          )}
          {whitelistQuery.data && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>種類</TableHead>
                  <TableHead>対象</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {whitelistQuery.data.map((entry) => (
                  <WhitelistTableRow
                    key={`${entry.targetType}-${entry.targetId}`}
                    guildId={guildId}
                    entry={entry}
                    targetName={
                      entry.targetType === "role"
                        ? (roleNameById.get(entry.targetId) ?? (entry.targetId === guildId ? "@everyone" : entry.targetId))
                        : entry.targetId
                    }
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="strikes">
          <StrikeTab guildId={guildId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
