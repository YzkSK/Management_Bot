import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { LogCategory } from "@management-bot/shared";
import { trpc } from "../trpc.js";
import { CATEGORY_LABELS } from "./category-labels.js";
import { MAX_RETENTION_DAYS, parseRetentionDaysInput } from "./parse-retention-days.js";
import { uniformValue } from "./uniform-value.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const NO_CHANNEL = "__none__";
/** 一括設定チャンネルSelectの初期状態(カテゴリごとに設定がバラバラで、まだ明示選択されていない)。 */
const UNCHOSEN = "";

interface ChannelOption {
  id: string;
  name: string;
}

function RetentionInput({
  guildId,
  category,
  retentionDays,
  disabled,
}: {
  guildId: string;
  category: LogCategory;
  retentionDays: number;
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(String(retentionDays));

  useEffect(() => setValue(String(retentionDays)), [retentionDays]);

  const mutation = useMutation({
    ...trpc.logging.setRetentionSetting.mutationOptions(),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: trpc.logging.listRetentionSettings.queryOptions({ guildId }).queryKey }),
  });

  return (
    <div className="flex flex-col gap-1">
      <Input
        type="number"
        min={0}
        max={MAX_RETENTION_DAYS}
        className="w-28"
        aria-label={`${CATEGORY_LABELS[category]}の保持期間(日)`}
        value={value}
        disabled={disabled || mutation.isPending}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const parsed = parseRetentionDaysInput(value);
          if (parsed === null) {
            setValue(String(retentionDays));
            return;
          }
          if (parsed !== retentionDays) {
            mutation.mutate({ guildId, category, retentionDays: parsed });
          }
        }}
      />
      {mutation.isError && <p className="text-destructive text-xs">保存に失敗しました</p>}
    </div>
  );
}

function BulkRetentionControl({
  guildId,
  retentionDaysList,
  onPendingChange,
}: {
  guildId: string;
  retentionDaysList: readonly number[];
  onPendingChange: (pending: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const uniform = uniformValue(retentionDaysList);
  const [value, setValue] = useState(uniform !== undefined ? String(uniform) : "");

  useEffect(() => setValue(uniform !== undefined ? String(uniform) : ""), [uniform]);

  const mutation = useMutation({
    ...trpc.logging.setRetentionSettingForAllCategories.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: trpc.logging.listRetentionSettings.queryOptions({ guildId }).queryKey }),
  });

  useEffect(() => onPendingChange(mutation.isPending), [mutation.isPending, onPendingChange]);

  const parsed = parseRetentionDaysInput(value);

  return (
    <div className="flex items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="bulk-retention-days" className="text-sm font-medium">
          保持期間(日、0=無期限)
        </label>
        <Input
          id="bulk-retention-days"
          type="number"
          min={0}
          max={MAX_RETENTION_DAYS}
          className="w-28"
          placeholder={uniform === undefined ? "カテゴリごとに異なる" : undefined}
          value={value}
          disabled={mutation.isPending}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      <Button
        type="button"
        disabled={parsed === null || mutation.isPending}
        onClick={() => {
          if (parsed !== null) {
            mutation.mutate({ guildId, retentionDays: parsed });
          }
        }}
      >
        全カテゴリに適用
      </Button>
      {value !== "" && parsed === null && <p className="text-destructive text-xs self-center">0〜{MAX_RETENTION_DAYS}で入力してください</p>}
      {mutation.isError && <p className="text-destructive text-xs self-center">保存に失敗しました</p>}
      {mutation.isSuccess && <p className="text-muted-foreground text-xs self-center">適用しました</p>}
    </div>
  );
}

function BulkChannelControl({
  guildId,
  channelIdList,
  options,
  onPendingChange,
}: {
  guildId: string;
  channelIdList: readonly (string | null)[];
  options: readonly ChannelOption[];
  onPendingChange: (pending: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const uniform = uniformValue(channelIdList);
  const initialValue = uniform === undefined ? UNCHOSEN : (uniform ?? NO_CHANNEL);
  const [value, setValue] = useState(initialValue);

  useEffect(() => setValue(initialValue), [initialValue]);

  const mutation = useMutation({
    ...trpc.logging.setChannelSettingForAllCategories.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: trpc.logging.listChannelSettings.queryOptions({ guildId }).queryKey }),
  });

  useEffect(() => onPendingChange(mutation.isPending), [mutation.isPending, onPendingChange]);

  return (
    <div className="flex items-end gap-2">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium">出力先チャンネル</label>
        <Select value={value} onValueChange={setValue} disabled={mutation.isPending}>
          <SelectTrigger className="w-48" aria-label="全カテゴリの出力先チャンネル">
            <SelectValue placeholder="カテゴリごとに異なる" />
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
      </div>
      <Button
        type="button"
        disabled={value === UNCHOSEN || mutation.isPending}
        onClick={() => mutation.mutate({ guildId, channelId: value === NO_CHANNEL ? null : value })}
      >
        全カテゴリに適用
      </Button>
      {mutation.isError && <p className="text-destructive text-xs self-center">保存に失敗しました</p>}
      {mutation.isSuccess && <p className="text-muted-foreground text-xs self-center">適用しました</p>}
    </div>
  );
}

function ChannelSelect({
  guildId,
  category,
  channelId,
  options,
  disabled,
}: {
  guildId: string;
  category: LogCategory;
  channelId: string | null;
  options: readonly ChannelOption[];
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    ...trpc.logging.setChannelSetting.mutationOptions(),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: trpc.logging.listChannelSettings.queryOptions({ guildId }).queryKey }),
  });

  return (
    <div className="flex flex-col gap-1">
      <Select
        value={channelId ?? NO_CHANNEL}
        disabled={disabled || mutation.isPending}
        onValueChange={(value) => mutation.mutate({ guildId, category, channelId: value === NO_CHANNEL ? null : value })}
      >
        <SelectTrigger className="w-48" aria-label={`${CATEGORY_LABELS[category]}の出力先チャンネル`}>
          <SelectValue />
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
      {mutation.isError && <p className="text-destructive text-xs">保存に失敗しました</p>}
    </div>
  );
}

export function SettingsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const [bulkRetentionPending, setBulkRetentionPending] = useState(false);
  const [bulkChannelPending, setBulkChannelPending] = useState(false);

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
  const queryClient = useQueryClient();
  const displaySettingsMutation = useMutation({
    ...trpc.logging.setDisplaySetting.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: trpc.logging.getDisplaySettings.queryOptions({ guildId: guildId ?? "" }).queryKey,
      }),
  });

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">ログ設定</h1>
        <Button asChild variant="outline">
          <Link to={`/guilds/${guildId}/logs`}>ログ一覧へ戻る</Link>
        </Button>
      </div>

      {isPending && <div className="text-sm">読み込み中...</div>}
      {isForbidden && (
        <Alert variant="destructive">
          <AlertDescription>この操作を行う権限がありません。</AlertDescription>
        </Alert>
      )}
      {isError && !isForbidden && (
        <Alert variant="destructive">
          <AlertDescription>設定の取得に失敗しました。時間をおいて再度お試しください。</AlertDescription>
        </Alert>
      )}

      {retentionQuery.data && channelSettingsQuery.data && channelOptionsQuery.data && (
        <>
          <div className="flex flex-col gap-4 rounded-lg border p-4">
            <h2 className="text-sm font-semibold">一括設定(すべてのカテゴリへ同じ値を適用)</h2>
            <BulkRetentionControl
              guildId={guildId}
              retentionDaysList={retentionQuery.data.map((s) => s.retentionDays)}
              onPendingChange={setBulkRetentionPending}
            />
            <BulkChannelControl
              guildId={guildId}
              channelIdList={channelSettingsQuery.data.map((s) => s.channelId)}
              options={channelOptionsQuery.data}
              onPendingChange={setBulkChannelPending}
            />
            {displaySettingsQuery.data && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!displaySettingsQuery.data.hideAuditLogCorrelation}
                  disabled={displaySettingsMutation.isPending}
                  onChange={(e) =>
                    displaySettingsMutation.mutate({
                      guildId,
                      hideAuditLogCorrelation: !e.target.checked,
                    })
                  }
                />
                ログ一覧に「監査ログ相関」カテゴリを表示する
              </label>
            )}
          </div>

          <details>
            <summary className="cursor-pointer text-sm font-medium">カテゴリごとに設定する(任意)</summary>
            <Table className="mt-2">
              <TableHeader>
                <TableRow>
                  <TableHead>カテゴリ</TableHead>
                  <TableHead>保持期間(日、0=無期限)</TableHead>
                  <TableHead>出力先チャンネル</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {retentionQuery.data.map((setting) => {
                  const channelSetting = channelSettingsQuery.data.find((c) => c.category === setting.category);
                  return (
                    <TableRow key={setting.category}>
                      <TableCell>{CATEGORY_LABELS[setting.category]}</TableCell>
                      <TableCell>
                        <RetentionInput
                          guildId={guildId}
                          category={setting.category}
                          retentionDays={setting.retentionDays}
                          disabled={bulkRetentionPending}
                        />
                      </TableCell>
                      <TableCell>
                        <ChannelSelect
                          guildId={guildId}
                          category={setting.category}
                          channelId={channelSetting?.channelId ?? null}
                          options={channelOptionsQuery.data}
                          disabled={bulkChannelPending}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </details>
        </>
      )}
    </div>
  );
}
