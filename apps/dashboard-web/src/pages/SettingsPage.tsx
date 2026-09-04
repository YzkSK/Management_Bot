import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { LogCategory } from "@management-bot/shared";
import { trpc } from "../trpc.js";
import { CATEGORY_LABELS } from "./category-labels.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const NO_CHANNEL = "__none__";
const MAX_RETENTION_DAYS = 36_500;

interface ChannelOption {
  id: string;
  name: string;
}

function RetentionInput({
  guildId,
  category,
  retentionDays,
}: {
  guildId: string;
  category: LogCategory;
  retentionDays: number;
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(String(retentionDays));

  useEffect(() => setValue(String(retentionDays)), [retentionDays]);

  const mutation = useMutation({
    ...trpc.logging.setRetentionSetting.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: trpc.logging.listRetentionSettings.queryOptions({ guildId }).queryKey }),
  });

  return (
    <Input
      type="number"
      min={0}
      max={MAX_RETENTION_DAYS}
      className="w-28"
      aria-label={`${CATEGORY_LABELS[category]}の保持期間(日)`}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const parsed = Number(value);
        const isValid = Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_RETENTION_DAYS;
        if (isValid && parsed !== retentionDays) {
          mutation.mutate({ guildId, category, retentionDays: parsed });
        } else {
          setValue(String(retentionDays));
        }
      }}
    />
  );
}

function ChannelSelect({
  guildId,
  category,
  channelId,
  options,
}: {
  guildId: string;
  category: LogCategory;
  channelId: string | null;
  options: readonly ChannelOption[];
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    ...trpc.logging.setChannelSetting.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: trpc.logging.listChannelSettings.queryOptions({ guildId }).queryKey }),
  });

  return (
    <Select
      value={channelId ?? NO_CHANNEL}
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
  );
}

export function SettingsPage() {
  const { guildId } = useParams<{ guildId: string }>();

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

  if (!guildId) {
    return (
      <Alert variant="destructive">
        <AlertDescription>サーバーが指定されていません。</AlertDescription>
      </Alert>
    );
  }

  const queries = [retentionQuery, channelSettingsQuery, channelOptionsQuery];
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
        <Table>
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
                    <RetentionInput guildId={guildId} category={setting.category} retentionDays={setting.retentionDays} />
                  </TableCell>
                  <TableCell>
                    <ChannelSelect
                      guildId={guildId}
                      category={setting.category}
                      channelId={channelSetting?.channelId ?? null}
                      options={channelOptionsQuery.data}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
