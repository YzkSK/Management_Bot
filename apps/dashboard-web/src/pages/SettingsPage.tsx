import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import type { LogCategory } from "@management-bot/shared";
import { trpc } from "../trpc.js";
import { CATEGORY_LABELS } from "./category-labels.js";
import {
  buildLogSettingsDraft,
  diffLogSettings,
  hasLogSettingsChanges,
  planBulk,
  type LogSettingsDraft,
  type LogSettingsServerState,
} from "./log-settings-draft.js";
import { MAX_RETENTION_DAYS, parseRetentionDaysInput } from "./parse-retention-days.js";
import { uniformValue } from "./uniform-value.js";
import { SaveBar } from "@/components/save-bar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loading } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const NO_CHANNEL = "__none__";
/** 一括設定チャンネルSelectの初期状態(カテゴリごとに設定がバラバラで、まだ明示選択されていない)。 */
const UNCHOSEN = "";

interface ChannelOption {
  id: string;
  name: string;
}

function ChannelSelect({
  value,
  onChange,
  options,
  label,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly ChannelOption[];
  label: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn("w-full", className)} aria-label={label}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_CHANNEL}>未設定</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            #{option.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** 一括設定。ここで入れた値は下書きの全カテゴリへ反映するだけで、保存は保存バーから行う。 */
function BulkControl({
  draft,
  categories,
  options,
  onApply,
}: {
  draft: LogSettingsDraft;
  categories: readonly LogCategory[];
  options: readonly ChannelOption[];
  onApply: (next: { retention?: string; channel?: string | null }) => void;
}) {
  const uniformRetention = uniformValue(categories.map((c) => draft.retention[c] ?? ""));
  const uniformChannel = uniformValue(categories.map((c) => draft.channel[c] ?? null));
  const [retention, setRetention] = useState(uniformRetention ?? "");
  const [channel, setChannel] = useState(uniformChannel === undefined ? UNCHOSEN : (uniformChannel ?? NO_CHANNEL));
  const retentionInvalid = retention !== "" && parseRetentionDaysInput(retention) === null;
  const canApply = !retentionInvalid && (retention !== "" || channel !== UNCHOSEN);

  return (
    <section className="bg-card flex flex-col gap-3 rounded-xl border p-5">
      <h2 className="font-bold">一括設定(すべてのカテゴリへ同じ値を適用)</h2>
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <label className="text-muted-foreground flex flex-col gap-1.5 text-sm md:w-64">
          出力先チャンネル
          <ChannelSelect
            value={channel}
            onChange={setChannel}
            options={options}
            label="全カテゴリの出力先チャンネル"
            placeholder="カテゴリごとに異なる"
          />
        </label>
        <label className="text-muted-foreground flex flex-col gap-1.5 text-sm md:w-32" htmlFor="bulk-retention-days">
          保持期間(日)
          <Input
            id="bulk-retention-days"
            type="number"
            min={0}
            max={MAX_RETENTION_DAYS}
            placeholder={uniformRetention === undefined ? "カテゴリごとに異なる" : undefined}
            value={retention}
            aria-invalid={retentionInvalid}
            onChange={(e) => setRetention(e.target.value)}
          />
        </label>
        <Button
          type="button"
          disabled={!canApply}
          onClick={() =>
            onApply({
              retention: retention === "" ? undefined : retention,
              channel: channel === UNCHOSEN ? undefined : channel === NO_CHANNEL ? null : channel,
            })
          }
        >
          全カテゴリに反映
        </Button>
      </div>
      {retentionInvalid ? (
        <p className="text-destructive text-xs">0〜{MAX_RETENTION_DAYS}で入力してください</p>
      ) : (
        <p className="text-muted-foreground text-xs">保持期間を0にすると無期限で保持します。</p>
      )}
    </section>
  );
}

export function SettingsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();
  const [draftState, setDraftState] = useState<LogSettingsDraft | null>(null);
  const [perCategoryOpen, setPerCategoryOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const retentionQuery = useQuery({
    ...trpc.logging.listRetentionSettings.queryOptions({ guildId: guildId ?? "" }),
    enabled: Boolean(guildId),
  });
  const channelSettingsQuery = useQuery({
    ...trpc.logging.listChannelSettings.queryOptions({ guildId: guildId ?? "" }),
    enabled: Boolean(guildId),
  });
  const channelOptionsQuery = useQuery({
    ...trpc.logging.listChannelOptions.queryOptions({ guildId: guildId ?? "" }),
    enabled: Boolean(guildId),
  });
  const displaySettingsQuery = useQuery({
    ...trpc.logging.getDisplaySettings.queryOptions({ guildId: guildId ?? "" }),
    enabled: Boolean(guildId),
  });
  const setRetention = useMutation(trpc.logging.setRetentionSetting.mutationOptions());
  const setRetentionAll = useMutation(trpc.logging.setRetentionSettingForAllCategories.mutationOptions());
  const setChannel = useMutation(trpc.logging.setChannelSetting.mutationOptions());
  const setChannelAll = useMutation(trpc.logging.setChannelSettingForAllCategories.mutationOptions());
  const setDisplay = useMutation(trpc.logging.setDisplaySetting.mutationOptions());

  if (!guildId) {
    return (
      <Alert variant="destructive">
        <AlertDescription>サーバーが指定されていません。</AlertDescription>
      </Alert>
    );
  }

  const queries = [retentionQuery, channelSettingsQuery, channelOptionsQuery, displaySettingsQuery];
  const isForbidden = queries.some(
    (query) => query.error instanceof TRPCClientError && query.error.data?.code === "FORBIDDEN",
  );
  const isPending = queries.some((query) => query.isPending);
  const isError = queries.some((query) => query.isError);
  const isBotAccessForbidden = channelOptionsQuery.data?.accessStatus === "forbidden";

  const server: LogSettingsServerState | null =
    retentionQuery.data && channelSettingsQuery.data && displaySettingsQuery.data
      ? { retention: retentionQuery.data, channel: channelSettingsQuery.data, display: displaySettingsQuery.data }
      : null;
  const draft = server ? (draftState ?? buildLogSettingsDraft(server)) : null;
  const changes = server && draft ? diffLogSettings(server, draft) : null;
  const categories = retentionQuery.data?.map((s) => s.category) ?? [];

  const updateDraft = (update: (current: LogSettingsDraft) => LogSettingsDraft) => {
    if (draft) setDraftState(update(draft));
  };

  const save = async () => {
    if (!changes || !draft || changes.invalidRetention.length > 0) return;
    setSaving(true);
    try {
      const retentionPlan = planBulk(
        categories.length,
        changes.retention.map((c) => ({ value: c.retentionDays })),
        categories.map((c) => parseRetentionDaysInput(draft.retention[c] ?? "")),
      );
      const channelPlan = planBulk(
        categories.length,
        changes.channel.map((c) => ({ value: c.channelId })),
        categories.map((c) => draft.channel[c] ?? null),
      );
      await Promise.all([
        retentionPlan.all !== undefined && retentionPlan.all !== null
          ? setRetentionAll.mutateAsync({ guildId, retentionDays: retentionPlan.all })
          : Promise.all(changes.retention.map((c) => setRetention.mutateAsync({ guildId, ...c }))),
        channelPlan.all !== undefined
          ? setChannelAll.mutateAsync({ guildId, channelId: channelPlan.all })
          : Promise.all(changes.channel.map((c) => setChannel.mutateAsync({ guildId, ...c }))),
        changes.display ? setDisplay.mutateAsync({ guildId, ...changes.display }) : undefined,
      ]);
      toast.success("保存しました");
      setDraftState(null);
    } catch {
      toast.error("保存に失敗しました。時間をおいて再度お試しください。");
    } finally {
      setSaving(false);
      await Promise.all(
        [
          trpc.logging.listRetentionSettings.queryOptions({ guildId }).queryKey,
          trpc.logging.listChannelSettings.queryOptions({ guildId }).queryKey,
          trpc.logging.getDisplaySettings.queryOptions({ guildId }).queryKey,
        ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Link to={`/guilds/${guildId}/logs`} className="w-fit text-sm hover:underline">
        ← ログ一覧へ戻る
      </Link>
      <h1 className="text-2xl font-bold">ログ設定</h1>

      {isPending && <Loading />}
      {isForbidden && (
        <Alert variant="warning">
          <Lock />
          <AlertDescription>この操作を行う権限がありません。ログ設定の変更には「ログ設定の管理」権限が必要です。</AlertDescription>
        </Alert>
      )}
      {isError && !isForbidden && (
        <Alert variant="destructive">
          <AlertDescription>設定の取得に失敗しました。時間をおいて再度お試しください。</AlertDescription>
        </Alert>
      )}
      {isBotAccessForbidden && (
        <Alert variant="destructive">
          <AlertDescription>
            Botに権限がないため、チャンネル一覧を取得できません。サーバー設定でBotの権限を確認してください。
          </AlertDescription>
        </Alert>
      )}

      {draft && changes && channelOptionsQuery.data && (
        <>
          <BulkControl
            key={draftState === null ? "server" : "draft"}
            draft={draft}
            categories={categories}
            options={channelOptionsQuery.data.channels}
            onApply={({ retention, channel }) =>
              updateDraft((current) => ({
                ...current,
                retention:
                  retention === undefined ? current.retention : Object.fromEntries(categories.map((c) => [c, retention])),
                channel: channel === undefined ? current.channel : Object.fromEntries(categories.map((c) => [c, channel])),
              }))
            }
          />

          <section className="bg-card flex flex-col gap-3 rounded-xl border p-5">
              <h2 className="font-bold">ログ一覧の表示</h2>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={draft.showAuditLogCorrelation}
                  onCheckedChange={(checked) => updateDraft((current) => ({ ...current, showAuditLogCorrelation: checked }))}
                />
                ログ一覧に「監査ログ相関」カテゴリを表示する
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={draft.showBotEvents}
                  onCheckedChange={(checked) => updateDraft((current) => ({ ...current, showBotEvents: checked }))}
                />
                ログ一覧にBotによるイベントを表示する
              </label>
            </section>

          <section className="bg-card overflow-hidden rounded-xl border">
            <h2>
              <button
                type="button"
                aria-expanded={perCategoryOpen}
                aria-controls="per-category-settings"
                onClick={() => setPerCategoryOpen((open) => !open)}
                className="flex min-h-13 w-full flex-wrap items-center gap-x-2.5 gap-y-0.5 px-5 py-3 text-left font-bold"
              >
                {perCategoryOpen ? (
                  <ChevronDown className="text-muted-foreground size-4" aria-hidden="true" />
                ) : (
                  <ChevronRight className="text-muted-foreground size-4" aria-hidden="true" />
                )}
                <span className="whitespace-nowrap">カテゴリごとに設定する(任意)</span>
                <span className="text-muted-foreground ml-auto text-xs font-normal">{categories.length}カテゴリ</span>
              </button>
            </h2>
            <div id="per-category-settings" hidden={!perCategoryOpen} className="border-t">
              <div className="text-muted-foreground hidden grid-cols-[minmax(0,1fr)_16rem_8rem] gap-3 px-5 py-2 text-xs md:grid">
                <span>カテゴリ</span>
                <span>出力先チャンネル</span>
                <span>保持期間(日)</span>
              </div>
              {categories.map((category) => {
                const invalid = changes.invalidRetention.includes(category);
                return (
                  <div
                    key={category}
                    className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-2 border-t px-4 py-3 md:grid-cols-[minmax(0,1fr)_16rem_8rem] md:gap-3 md:px-5 md:py-2"
                  >
                    <span className="col-span-2 text-sm font-medium md:col-span-1 md:font-normal">
                      {CATEGORY_LABELS[category]}
                    </span>
                    <ChannelSelect
                      value={draft.channel[category] ?? NO_CHANNEL}
                      onChange={(value) =>
                        updateDraft((current) => ({
                          ...current,
                          channel: { ...current.channel, [category]: value === NO_CHANNEL ? null : value },
                        }))
                      }
                      options={channelOptionsQuery.data.channels}
                      label={`${CATEGORY_LABELS[category]}の出力先チャンネル`}
                    />
                    <Input
                      type="number"
                      min={0}
                      max={MAX_RETENTION_DAYS}
                      aria-label={`${CATEGORY_LABELS[category]}の保持期間(日)`}
                      aria-invalid={invalid}
                      value={draft.retention[category] ?? ""}
                      onChange={(e) =>
                        updateDraft((current) => ({ ...current, retention: { ...current.retention, [category]: e.target.value } }))
                      }
                    />
                  </div>
                );
              })}
            </div>
          </section>

          {changes.invalidRetention.length > 0 && (
            <p className="text-destructive text-sm">
              保持期間は0〜{MAX_RETENTION_DAYS}の整数で入力してください(
              {changes.invalidRetention.map((c) => CATEGORY_LABELS[c]).join("、")})。
            </p>
          )}

          <SaveBar
            dirty={hasLogSettingsChanges(changes)}
            saving={saving}
            onSave={() => void save()}
            onDiscard={() => setDraftState(null)}
          />
        </>
      )}
    </div>
  );
}
