import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  MODERATION_PRESETS,
  MODERATION_VIOLATION_TYPES,
  type ModerationPreset,
  type ModerationViolationType,
} from "@management-bot/shared";
import { trpc } from "../trpc.js";
import { PRESET_LABELS, VIOLATION_TYPE_LABELS } from "./moderation-labels.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
      </TableCell>
      <TableCell className="text-destructive text-xs">{mutation.isError ? "保存に失敗しました" : null}</TableCell>
    </TableRow>
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

export function ModerationPage() {
  const { guildId } = useParams<{ guildId: string }>();

  const thresholdsQuery = useQuery({
    ...trpc.moderation.listThresholds.queryOptions({ guildId: guildId ?? "" }),
    enabled: Boolean(guildId),
  });
  const whitelistQuery = useQuery({
    ...trpc.moderation.listWhitelist.queryOptions({ guildId: guildId ?? "" }),
    enabled: Boolean(guildId),
  });
  const permissionStatusQuery = useQuery({
    ...trpc.moderation.getRequiredPermissionStatus.queryOptions({ guildId: guildId ?? "" }),
    enabled: Boolean(guildId),
  });
  const roleOptionsQuery = useQuery({
    ...trpc.moderation.listRoleOptions.queryOptions({ guildId: guildId ?? "" }),
    enabled: Boolean(guildId),
  });

  if (!guildId) {
    return (
      <Alert variant="destructive">
        <AlertDescription>サーバーが指定されていません。</AlertDescription>
      </Alert>
    );
  }

  const requiredQueries = [thresholdsQuery, whitelistQuery];
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

  if (isError || !thresholdsQuery.data || !whitelistQuery.data) {
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

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">検知種別</h2>
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
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">ホワイトリスト</h2>
        <WhitelistForm guildId={guildId} />
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
      </div>
    </div>
  );
}
