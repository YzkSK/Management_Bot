import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
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
  isPresetIndependentViolationType,
  NGWORD_MATCH_TYPE_LABELS,
  PRESET_LABELS,
  VIOLATION_TYPE_LABELS,
  type NgwordMatchType,
} from "./moderation-labels.js";
import { formatCreatedAt } from "./format-created-at.js";
import { SaveBar } from "@/components/save-bar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loading, Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

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

/**
 * tRPC+TanStack QueryのqueryKeyは[path, {input, type}]の形で、inputはunknown型のため
 * 安全に絞り込む。listStrikesはafterでページングされ複数のqueryKeyに分かれるため、
 * 特定のguildId向けの全ページをまとめて無効化する際に使う(#368)。
 */
function matchesGuildId(query: { queryKey: readonly unknown[] }, guildId: string): boolean {
  const opts = query.queryKey[1];
  if (typeof opts !== "object" || opts === null || !("input" in opts)) return false;
  const input = opts.input;
  if (typeof input !== "object" || input === null || !("guildId" in input)) return false;
  return input.guildId === guildId;
}

const SAVE_FAILED_MESSAGE = "保存に失敗しました。時間をおいて再度お試しください。";

interface ThresholdsDraft {
  rows: ThresholdSetting[];
  /** エスカレーション強度は別クエリのため、未取得の間はundefined(変更対象にしない)。 */
  escalation: ModerationPreset | undefined;
}

/** 検知設定。即時保存せず下書きとして編集し、保存バーからまとめて保存する。 */
function ThresholdsTab({ guildId, thresholds }: { guildId: string; thresholds: readonly ThresholdSetting[] }) {
  const queryClient = useQueryClient();
  const escalationQuery = useQuery(trpc.moderation.getEscalationPreset.queryOptions({ guildId }));
  const setThreshold = useMutation(trpc.moderation.setThreshold.mutationOptions());
  const setEscalation = useMutation(trpc.moderation.setEscalationPreset.mutationOptions());
  const [draftState, setDraftState] = useState<ThresholdsDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const serverRows = withDefaults(thresholds);
  // 強度の取得前に行を編集した下書きは escalation が undefined のままなので、取得後の値で補う(codexレビュー対応)。
  const draft = draftState
    ? { ...draftState, escalation: draftState.escalation ?? escalationQuery.data }
    : { rows: serverRows, escalation: escalationQuery.data };
  const changedRows = draft.rows.filter((row, i) => row.enabled !== serverRows[i]?.enabled || row.preset !== serverRows[i]?.preset);
  const escalationChanged = draft.escalation !== undefined && draft.escalation !== escalationQuery.data;
  const updateRow = (violationType: ModerationViolationType, patch: Partial<ThresholdSetting>) =>
    setDraftState({ ...draft, rows: draft.rows.map((r) => (r.violationType === violationType ? { ...r, ...patch } : r)) });

  const save = async () => {
    setSaving(true);
    try {
      await Promise.all([
        ...changedRows.map((row) => setThreshold.mutateAsync({ guildId, ...row })),
        escalationChanged && draft.escalation ? setEscalation.mutateAsync({ guildId, preset: draft.escalation }) : undefined,
      ]);
      toast.success("保存しました");
      setDraftState(null);
    } catch {
      toast.error(SAVE_FAILED_MESSAGE);
    } finally {
      setSaving(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.moderation.listThresholds.queryOptions({ guildId }).queryKey }),
        queryClient.invalidateQueries({ queryKey: trpc.moderation.getEscalationPreset.queryOptions({ guildId }).queryKey }),
      ]);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {escalationQuery.isError && (
        <Alert variant="destructive">
          <AlertDescription>エスカレーション強度の取得に失敗しました。時間をおいて再度お試しください。</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <label className="flex items-center gap-2">
          エスカレーション強度
          <Select
            value={draft.escalation}
            disabled={draft.escalation === undefined}
            onValueChange={(value) => setDraftState({ ...draft, escalation: value as ModerationPreset })}
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
        </label>
        {draft.escalation && <span className="text-muted-foreground">{ESCALATION_DESCRIPTIONS[draft.escalation]}</span>}
      </div>
      <ul className="bg-card divide-y rounded-xl border">
        {draft.rows.map((row) => (
          <li key={row.violationType} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3">
            <Switch
              checked={row.enabled}
              aria-label={`${VIOLATION_TYPE_LABELS[row.violationType]}の検知を有効化`}
              onCheckedChange={(checked) => updateRow(row.violationType, { enabled: checked })}
            />
            <span className="w-36 text-sm font-medium">{VIOLATION_TYPE_LABELS[row.violationType]}</span>
            {!isPresetIndependentViolationType(row.violationType) && (
              <div
                role="radiogroup"
                aria-label={`${VIOLATION_TYPE_LABELS[row.violationType]}の強度`}
                className="bg-muted flex gap-0.5 rounded-lg p-0.5"
              >
                {MODERATION_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    role="radio"
                    aria-checked={row.preset === preset}
                    onClick={() => updateRow(row.violationType, { preset })}
                    className={cn(
                      "h-8 rounded-md px-3 text-xs",
                      row.preset === preset ? "bg-background font-bold shadow-xs" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {PRESET_LABELS[preset]}
                  </button>
                ))}
              </div>
            )}
            {!isPresetIndependentViolationType(row.violationType) && (
              <span className="text-muted-foreground min-w-0 basis-full text-xs md:flex-1 md:basis-auto">
                {describePreset(row.violationType, row.preset)}
              </span>
            )}
          </li>
        ))}
      </ul>
      <SaveBar
        dirty={changedRows.length > 0 || escalationChanged}
        saving={saving}
        onSave={() => void save()}
        onDiscard={() => setDraftState(null)}
      />
    </div>
  );
}

function LockdownPanel({ guildId }: { guildId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery(trpc.moderation.getLockdownSettings.queryOptions({ guildId }));
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.moderation.getLockdownSettings.queryOptions({ guildId }).queryKey });
  const autoLockdownMutation = useMutation({
    ...trpc.moderation.setAutoLockdownOnRaid.mutationOptions(),
    onSuccess: () => toast.success("保存しました"),
    onError: () => toast.error("ロックダウン設定の更新に失敗しました。"),
    onSettled: invalidate,
  });
  const requestedLockMutation = useMutation({
    ...trpc.moderation.setLockdownRequested.mutationOptions(),
    onSuccess: (_data, { requestedLocked }) => toast.success(requestedLocked ? "ロックダウンを開始しました" : "ロックダウンを解除しました"),
    onError: () => toast.error("ロックダウン設定の更新に失敗しました。"),
    onSettled: invalidate,
  });

  if (query.isPending) return <Loading />;
  if (query.isError || !query.data) {
    return <div className="text-destructive text-sm">ロックダウン設定の取得に失敗しました。</div>;
  }

  const isPending = autoLockdownMutation.isPending || requestedLockMutation.isPending;
  const locked = query.data.isLocked;

  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-4 md:flex-row md:items-center md:gap-4",
        locked ? "border-destructive/30 bg-destructive/10" : "bg-card",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-bold", locked && "text-destructive")}>現在の状態: {locked ? "ロック中" : "解除中"}</p>
        <p className="text-muted-foreground text-xs">
          ロック中は新規参加ユーザーを退出させ、@everyone のメッセージ送信を停止します。
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        レイド時に自動でロックダウン
        <Switch
          checked={query.data.autoLockdownOnRaid}
          disabled={isPending}
          aria-label="レイド時に自動でロックダウン"
          onCheckedChange={(enabled) => autoLockdownMutation.mutate({ guildId, enabled })}
        />
      </label>
      <Button
        type="button"
        variant={query.data.requestedLocked ? "outline" : "destructive"}
        className="w-full md:w-auto"
        disabled={isPending}
        onClick={() => requestedLockMutation.mutate({ guildId, requestedLocked: !query.data.requestedLocked })}
      >
        {query.data.requestedLocked ? "ロックダウンを解除" : "ロックダウンを開始"}
      </Button>
    </section>
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
    <div className="flex flex-col gap-1.5">
      <label className="text-muted-foreground text-sm">対象</label>
      <Select value={value} onValueChange={onChange} disabled={isLoading || isError}>
        <SelectTrigger className="w-full sm:w-56" aria-label={targetType === "role" ? "ホワイトリスト対象ロール" : "ホワイトリスト対象ユーザー"}>
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
      toast.success("追加しました");
    },
  });

  return (
    <div className="bg-card flex flex-col gap-3 rounded-xl border p-4">
      <h2 className="text-sm font-bold">ホワイトリストへの追加</h2>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1.5">
          <label className="text-muted-foreground text-sm">種類</label>
          <Select
            value={targetType}
            onValueChange={(value) => {
              setTargetType(value as TargetType);
              setTargetId("");
            }}
          >
            <SelectTrigger className="w-full sm:w-32" aria-label="ホワイトリスト対象の種類">
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
          className="w-full sm:w-auto"
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

function WhitelistRow({
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
    onError: () => toast.error("削除に失敗しました。"),
  });

  return (
    <li className="flex items-center gap-3 px-4 py-3 text-sm">
      <span className="bg-muted shrink-0 rounded-full px-2 py-0.5 text-xs whitespace-nowrap">
        {entry.targetType === "role" ? "ロール" : "ユーザー"}
      </span>
      <span className="min-w-0 flex-1 truncate">{targetName}</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate({ guildId, targetType: entry.targetType, targetId: entry.targetId })}
      >
        削除
      </Button>
    </li>
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
      toast.success("追加しました");
    },
  });

  const isUnsafeRegexError =
    mutation.error instanceof TRPCClientError && mutation.error.data?.code === "BAD_REQUEST";

  return (
    <div className="bg-card flex flex-col gap-3 rounded-xl border p-4">
      <h2 className="text-sm font-bold">NGワードの追加</h2>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1.5">
          <label className="text-muted-foreground text-sm">一致方式</label>
          <Select value={matchType} onValueChange={(value) => setMatchType(value as NgwordMatchType)}>
            <SelectTrigger className="w-full sm:w-32" aria-label="NGワードの一致方式">
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
        <div className="flex flex-col gap-1.5">
          <label className="text-muted-foreground text-sm">パターン</label>
          <Input
            className="w-full sm:w-64"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder={matchType === "regex" ? "^ng-word\\d*$" : "NGワード"}
            aria-label="NGワードのパターン"
          />
        </div>
        <Button
          type="button"
          className="w-full sm:w-auto"
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

function NgwordRow({ guildId, entry }: { guildId: string; entry: NgwordEntry }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    ...trpc.moderation.removeNgword.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: trpc.moderation.listNgwords.queryOptions({ guildId }).queryKey }),
    onError: () => toast.error("削除に失敗しました。"),
  });

  return (
    <li className="flex items-center gap-3 px-4 py-3 text-sm">
      <code className="min-w-0 flex-1 truncate font-mono">{entry.pattern}</code>
      <span className="bg-muted shrink-0 rounded-full px-2 py-0.5 text-xs whitespace-nowrap">
        {NGWORD_MATCH_TYPE_LABELS[entry.matchType]}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate({ guildId, id: entry.id })}
      >
        削除
      </Button>
    </li>
  );
}

function NgwordTab({ guildId }: { guildId: string }) {
  const query = useQuery(trpc.moderation.listNgwords.queryOptions({ guildId }));

  return (
    <div className="flex flex-col gap-3">
      <NgwordForm guildId={guildId} />
      {query.isPending && <Loading />}
      {query.isError && (
        <Alert variant="destructive">
          <AlertDescription>NGワード一覧の取得に失敗しました。時間をおいて再度お試しください。</AlertDescription>
        </Alert>
      )}
      {query.data && query.data.length === 0 && (
        <p className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">登録されたNGワードはありません。</p>
      )}
      {query.data && query.data.length > 0 && (
        <ul className="bg-card divide-y rounded-xl border">
          {query.data.map((entry) => (
            <NgwordRow key={entry.id} guildId={guildId} entry={entry} />
          ))}
        </ul>
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
  group,
  userName,
  onReset,
}: {
  guildId: string;
  group: { userId: string; total: number; entries: StrikeEntry[] };
  userName: string;
  /** ページング結果を保持するstate(useStrikePagesのpages)をクリアし、先頭ページから読み直させる(#368)。 */
  onReset: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();
  const resetAllMutation = useMutation({
    ...trpc.moderation.resetAllStrikes.mutationOptions(),
    // listStrikesはafterでページングされ複数のqueryKeyに分かれるため、現在ページ({guildId, after})
    // のみのinvalidateだと、リセット対象のユーザーの行が他ページのキャッシュに残ってしまう
    // (#367の複合カーソル化で同一userIdの行が複数ページに跨るケースが生じ得る、#368)。
    // pathFilter+predicateでguildId一致の全ページのキャッシュを無効化しつつ、既に画面側に
    // コピー済みのpages stateはinvalidateQueriesでは更新されないためonResetで別途クリアする
    // (Codexレビュー指摘)。
    onSuccess: () => {
      queryClient.invalidateQueries(
        trpc.moderation.listStrikes.pathFilter({ predicate: (query) => matchesGuildId(query, guildId) }),
      );
      onReset();
    },
    onError: () => toast.error("リセットに失敗しました。"),
  });

  return (
    <li className="flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <ChevronDown className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
          )}
          <span className="truncate">{userName}</span>
        </button>
        <span className="shrink-0 text-sm font-bold whitespace-nowrap">合計 {group.total}回</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={resetAllMutation.isPending}
          onClick={() => resetAllMutation.mutate({ guildId, userId: group.userId })}
        >
          全種別リセット
        </Button>
      </div>
      {expanded && (
        <ul className="bg-muted/40 divide-y border-t">
          {group.entries.map((entry) => (
            <StrikeDetailRow key={`${entry.userId}-${entry.violationType}`} guildId={guildId} entry={entry} onReset={onReset} />
          ))}
        </ul>
      )}
    </li>
  );
}

function StrikeDetailRow({
  guildId,
  entry,
  onReset,
}: {
  guildId: string;
  entry: StrikeEntry;
  onReset: () => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    ...trpc.moderation.resetStrike.mutationOptions(),
    // resetAllMutation(UserStrikeGroup)と同様、guildId一致の全ページのキャッシュを無効化しつつ、
    // pages state自体はonResetでクリアする(Codexレビュー指摘、#368)。
    onSuccess: () => {
      queryClient.invalidateQueries(
        trpc.moderation.listStrikes.pathFilter({ predicate: (query) => matchesGuildId(query, guildId) }),
      );
      onReset();
    },
    onError: () => toast.error("リセットに失敗しました。"),
  });

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 pr-4 pl-10 text-sm">
      <span className="min-w-0 flex-1">{VIOLATION_TYPE_LABELS[entry.violationType]}</span>
      <span className="shrink-0 whitespace-nowrap">{entry.strikeCount}回</span>
      <span className="text-muted-foreground basis-full text-xs sm:basis-auto">
        最終違反 {new Date(entry.lastViolationAt).toLocaleString("ja-JP")}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate({ guildId, userId: entry.userId, violationType: entry.violationType })}
      >
        リセット
      </Button>
    </li>
  );
}

export interface StrikePageData {
  rows: StrikeEntry[];
  userNames: Record<string, string>;
}

/**
 * 取得中(isFetching)はquery.dataがまだ古い(invalidate前の)値を保持していることがあり、
 * resetPages直後にここでコピーするとpagesへ古いデータが再コピーされ、一瞬「履歴なし」に
 * なった後古い行・合計が再表示されてしまう(Codexレビュー指摘)。再取得完了後の新しい
 * query.dataでのみコピーする。
 */
export function canUpdateStrikePages(data: StrikePageData | undefined, isFetching: boolean): data is StrikePageData {
  return data !== undefined && !isFetching;
}

/**
 * rows.length===0の間にisFetchingがtrueなら、resetPages直後で再取得中の可能性がある
 * (isPendingはキャッシュされたデータが全くない場合のみtrueになり、invalidateQueries
 * 直後のように古いキャッシュがまだ残っている間はfalseのまま、Codexレビュー指摘)。
 * isFetchingも見ることで「履歴なし」の誤表示を防ぐ。
 */
export function isStrikePagesPending(rowCount: number, isPending: boolean, isFetching: boolean): boolean {
  return rowCount === 0 && (isPending || isFetching);
}

/**
 * AccessPageのuseMemberOptions/useMemberOptions(本ファイル)と同様、ページング結果を
 * カーソル単位で保持する。invalidateQueriesはTanStack Queryのキャッシュを無効化する
 * だけで、既にこのpages stateへコピー済みのデータや非アクティブ(現在表示されていない)
 * ページの再取得までは行わない。そのためストライクリセット成功時は、単なる
 * invalidateQueriesに加えてresetPagesでpages自体をクリアし、先頭ページから
 * 読み直させる必要がある(Codexレビュー指摘、#368)。
 */
function useStrikePages(guildId: string) {
  const [after, setAfter] = useState<string | undefined>(undefined);
  const [pages, setPages] = useState<Record<string, StrikePageData>>({});

  const resetPages = () => {
    setAfter(undefined);
    setPages({});
  };

  useEffect(resetPages, [guildId]);

  const query = useQuery(trpc.moderation.listStrikes.queryOptions({ guildId, after }));

  useEffect(() => {
    const data = query.data;
    if (!canUpdateStrikePages(data, query.isFetching)) return;
    const pageKey = after ?? FIRST_PAGE_KEY;
    setPages((prev) => ({ ...prev, [pageKey]: { rows: data.rows, userNames: data.userNames } }));
  }, [after, query.data, query.isFetching]);

  const rows = Object.values(pages).flatMap((p) => p.rows);
  const userNames = Object.assign({}, ...Object.values(pages).map((p) => p.userNames)) as Record<string, string>;

  return {
    rows,
    userNames,
    isPending: isStrikePagesPending(rows.length, query.isPending, query.isFetching),
    isError: query.isError,
    nextAfter: query.data?.nextAfter,
    isFetchingNextPage: query.isFetching,
    loadNextPage: () => setAfter(query.data?.nextAfter),
    resetPages,
  };
}

function StrikeTab({ guildId }: { guildId: string }) {
  const { rows, userNames, isPending, isError, nextAfter, isFetchingNextPage, loadNextPage, resetPages } =
    useStrikePages(guildId);

  if (isPending) {
    return <Loading />;
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>警告回数の取得に失敗しました。時間をおいて再度お試しください。</AlertDescription>
      </Alert>
    );
  }

  if (rows.length === 0) {
    return <p className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">警告履歴はありません。</p>;
  }

  const groups = groupStrikesByUser(rows);

  return (
    <div className="flex flex-col gap-2">
      <ul className="bg-card divide-y rounded-xl border">
        {groups.map((group) => (
          <UserStrikeGroup
            key={group.userId}
            guildId={guildId}
            group={group}
            userName={userNames[group.userId] ?? group.userId}
            onReset={resetPages}
          />
        ))}
      </ul>
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

export function ModerationHistoryTab({ guildId }: { guildId: string }) {
  const query = useQuery(trpc.logging.listLogEntries.queryOptions({ guildId, categories: ["moderationCase"], limit: 50 }));
  const targetUserIds = useMemo(
    () =>
      query.data
        ? Array.from(
            new Set(
              query.data.entries.flatMap(({ entry }) => (entry.category === "moderationCase" ? [entry.targetUserId] : [])),
            ),
          ).sort()
        : [],
    [query.data],
  );
  const namesQuery = useQuery({
    ...trpc.logging.resolveDisplayNames.queryOptions({ guildId, userIds: targetUserIds, channelIds: [] }),
    enabled: targetUserIds.length > 0,
  });
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (query.isPending) return <Loading />;
  if (query.isError || !query.data) {
    return (
      <Alert variant="destructive">
        <AlertDescription>検知履歴の取得に失敗しました。時間をおいて再度お試しください。</AlertDescription>
      </Alert>
    );
  }
  if (query.data.entries.length === 0) return <div className="text-sm">検知履歴はありません。</div>;

  return (
    <div className="flex flex-col gap-2">
      {query.data.entries.map(({ id, entry }) => {
        if (entry.category !== "moderationCase") return null;
        const { incident } = entry;
        const violation = incident
          ? incident.violationType === "raid"
            ? "レイド"
            : VIOLATION_TYPE_LABELS[incident.violationType]
          : "旧ログ";
        const result = entry.action === "resolve" ? entry.result : "実行中";
        const actionResult = `${entry.actionType} / ${result}${entry.action === "resolve" && entry.failureCode ? ` (${entry.failureCode})` : ""}`;
        const details = incident
          ? incident.violationType === "raid"
            ? `${incident.raidSeverity === "high" ? "高危険度" : "通常"} / 対象 ${incident.raidTargetCount}件 / 削除 ${incident.deletedMessageCount}件`
            : `一致 ${incident.matchedMessageCount}件 / 削除 ${incident.deletedMessageCount}件`
          : "旧ログ（詳細なし）";
        const detailId = `moderation-history-detail-${id}`;
        const isExpanded = expandedIds.has(id);
        // 名前解決中はIDを見せずスケルトンにし、失敗・未解決のときだけIDにフォールバックする
        const userName = namesQuery.isLoading ? (
          <Skeleton className="inline-block h-4 w-24 align-middle" aria-label="名前を読み込み中" />
        ) : (
          (namesQuery.data?.users[entry.targetUserId] ?? entry.targetUserId)
        );
        return (
          <div key={id} className="rounded-lg border">
            <button
              type="button"
              onClick={() => toggleExpanded(id)}
              aria-expanded={isExpanded}
              aria-controls={detailId}
              className="flex w-full items-center gap-3 p-3 text-left hover:bg-accent/50"
            >
              <span className="flex-1 text-sm">
                {userName} / {violation}
              </span>
              <time dateTime={entry.createdAt} className="text-muted-foreground shrink-0 text-xs">
                {formatCreatedAt(entry.createdAt)}
              </time>
            </button>
            {isExpanded && (
              <div id={detailId} className="grid grid-cols-2 gap-3 border-t bg-muted/40 p-3 text-xs">
                <div className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground font-semibold tracking-wide uppercase">ケース ID</span>
                  <span className="font-mono">{entry.caseId}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground font-semibold tracking-wide uppercase">対象</span>
                  <span>{userName}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground font-semibold tracking-wide uppercase">ストライク</span>
                  <span>{incident?.strikeCount ?? "—"}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground font-semibold tracking-wide uppercase">処分 / 結果</span>
                  <span>{actionResult}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground font-semibold tracking-wide uppercase">検知詳細</span>
                  <span>{details}</span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

type ModerationTab = "thresholds" | "ngwords" | "whitelist" | "strikes" | "history";

const MODERATION_TABS: readonly { value: ModerationTab; label: string }[] = [
  { value: "thresholds", label: "検知設定" },
  { value: "ngwords", label: "NGワード" },
  { value: "whitelist", label: "ホワイトリスト" },
  { value: "strikes", label: "警告回数" },
  { value: "history", label: "検知履歴" },
];

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
      <Alert variant="warning">
        <Lock />
        <AlertDescription>この操作を行う権限がありません。スパム対策の閲覧には「モデレーションの閲覧」権限が必要です。</AlertDescription>
      </Alert>
    );
  }

  if (thresholdsQuery.isPending) {
    return <Loading />;
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
      <h1 className="text-2xl font-bold">スパム対策</h1>

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

      <LockdownPanel guildId={guildId} />

      <Tabs value={tab} onValueChange={(value) => setTab(value as ModerationTab)}>
        {/* タブが5つあり狭い画面では1行に収まらないため、モバイルでは選択欄に切り替える */}
        <label className="text-muted-foreground flex flex-col gap-1.5 text-sm sm:hidden">
          表示する項目
          <Select value={tab} onValueChange={(value) => setTab(value as ModerationTab)}>
            <SelectTrigger className="w-full" aria-label="表示する項目">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODERATION_TABS.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <TabsList aria-label="スパム対策の設定" className="hidden sm:inline-flex">
          {MODERATION_TABS.map(({ value, label }) => (
            <TabsTrigger key={value} value={value}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="thresholds">
          <ThresholdsTab guildId={guildId} thresholds={thresholdsQuery.data} />
        </TabsContent>

        <TabsContent value="ngwords">
          <NgwordTab guildId={guildId} />
        </TabsContent>

        <TabsContent value="whitelist" className="flex flex-col gap-3">
          <WhitelistForm guildId={guildId} />
          {whitelistQuery.isPending && <Loading />}
          {whitelistQuery.isError && (
            <Alert variant="destructive">
              <AlertDescription>ホワイトリストの取得に失敗しました。時間をおいて再度お試しください。</AlertDescription>
            </Alert>
          )}
          {whitelistQuery.data && whitelistQuery.data.length > 0 && (
            <ul className="bg-card divide-y rounded-xl border">
                {whitelistQuery.data.map((entry) => (
                  <WhitelistRow
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
            </ul>
          )}
        </TabsContent>

        <TabsContent value="strikes">
          <StrikeTab guildId={guildId} />
        </TabsContent>

        <TabsContent value="history">
          <ModerationHistoryTab guildId={guildId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
