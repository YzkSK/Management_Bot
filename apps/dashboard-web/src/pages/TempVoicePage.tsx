import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconEyeOff, IconLock, IconUsers, IconVolume, IconWaveSine } from "@tabler/icons-react";
import { useParams } from "react-router-dom";
import { toast } from "@/components/starwind/toast";
import { CAPABILITIES, hasCapability } from "@management-bot/shared";
import { isForbiddenError } from "../dashboard-query-client.js";
import { useGuildCapabilities } from "../guild-pages.js";
import { trpc } from "../trpc.js";
import { formatDuration } from "./activity-range.js";
import { VoiceMemberRow } from "./ActiveVoiceTab.js";
import { EditChannelButton } from "./TempVoiceEditDialog.js";
import { buildTempVoiceDraft, diffTempVoiceConfig, hasTempVoiceChanges, type TempVoiceDraft } from "./temp-voice-draft.js";
import { ErrorState, ForbiddenState, InlineError } from "@/components/page-state";
import { SaveBar } from "@/components/save-bar";
import { Alert, AlertDescription } from "@/components/starwind/alert";
import { Button } from "@/components/starwind/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/starwind/dialog";
import { Input } from "@/components/starwind/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/starwind/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/starwind/tabs";
import { Loading } from "@/components/loading";

type TempVoiceTab = "list" | "roles" | "settings";

interface TempVoiceConfigData {
  createChannelId: string | null;
  categoryId: string | null;
  nameTemplate: string;
  defaultUserLimit: number;
  defaultBitrate: number | null;
}

/** 未設定(createChannelId/categoryIdが両方null)ギルド向けの案内バナー。設定タブへのリンクを兼ねる。 */
function NotConfiguredBanner({ onGoSettings }: { onGoSettings: () => void }) {
  return (
    <Alert variant="info" className="py-2">
      <AlertDescription className="block text-sm">
        一時VCがまだ設定されていません。
        <button type="button" className="font-medium underline" onClick={onGoSettings}>
          設定タブ
        </button>
        から作成用チャンネルを設定してください。
      </AlertDescription>
    </Alert>
  );
}

function ForceDeleteButton({
  guildId,
  channel,
  disabled,
  onConfirm,
}: {
  guildId: string;
  channel: { channelId: string; memberCount: number };
  disabled: boolean;
  onConfirm: (input: { guildId: string; channelId: string }) => void;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-destructive border-destructive/40" disabled={disabled}>
          強制削除
        </Button>
      </DialogTrigger>
      <DialogContent className="top-1/2 left-1/2 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border p-6">
        <DialogHeader>
          <DialogTitle>このチャンネルを強制削除しますか?</DialogTitle>
          <DialogDescription>
            現在{channel.memberCount}人が通話中です。削除するとチャンネルと在室者は即座に切断されます。この操作は取り消せません。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">キャンセル</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button
              variant="destructive"
              onClick={() => onConfirm({ guildId, channelId: channel.channelId })}
            >
              削除する
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** canForceDeleteがfalse(VIEW_TEMP_VOICEのみ)の場合は強制削除ボタンを出さない(issue #527)。 */
function ActiveChannelsTab({
  guildId,
  isConfigured,
  canForceDelete,
}: {
  guildId: string;
  isConfigured: boolean;
  canForceDelete: boolean;
}) {
  const queryClient = useQueryClient();
  const listQuery = useQuery({
    ...trpc.tempVoice.listActiveChannels.queryOptions({ guildId }),
    refetchInterval: 10_000,
  });
  const forceDeleteMutation = useMutation({
    ...trpc.tempVoice.forceDelete.mutationOptions(),
    onSuccess: () => {
      toast.success("削除リクエストを送信しました。数秒後に一覧から消えます。");
      void queryClient.invalidateQueries({ queryKey: trpc.tempVoice.listActiveChannels.queryOptions({ guildId }).queryKey });
    },
    onError: () => toast.error("強制削除リクエストの送信に失敗しました。"),
  });

  // 継続時間の基準時刻。一覧は10秒ごとに再取得されるため、そのたびに更新される。
  const now = new Date();
  // VIEW_TEMP_VOICEが無ければAPIは自分がオーナーのVCだけを返す。
  const capabilities = useGuildCapabilities(guildId);
  const ownOnly = capabilities !== undefined && !hasCapability(capabilities, CAPABILITIES.VIEW_TEMP_VOICE);

  if (listQuery.isPending) return <Loading />;
  if (isForbiddenError(listQuery.error)) {
    return <ForbiddenState pageName="一時VC一覧" capabilities={["VIEW_TEMP_VOICE"]} />;
  }
  if (listQuery.isError || !listQuery.data) {
    return <ErrorState subject="一時VC一覧" onRetry={() => void listQuery.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        {ownOnly ? "あなたがオーナーの一時VCです。" : "現在Discord上に存在する一時VCです。"}
      </p>
      {listQuery.data.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
          {ownOnly ? "あなたがオーナーの一時VCはありません。" : "現在アクティブな一時VCはありません。"}
          作成用チャンネルに入室すると自動で作成されます。
        </p>
      ) : (
        <div className="grid items-start gap-3 md:grid-cols-2">
          {listQuery.data.map((channel) => {
            const ChannelIcon = channel.isLocked ? IconLock : IconVolume;
            return (
              <section
                key={channel.channelId}
                className={`flex flex-col gap-3 rounded-lg border p-4${channel.isMine ? " border-primary" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <ChannelIcon
                      aria-label={channel.isLocked ? "ロック中" : undefined}
                      aria-hidden={channel.isLocked ? undefined : true}
                      className="text-muted-foreground size-4 shrink-0"
                    />
                    <span className="truncate text-sm font-semibold">{channel.channelName ?? channel.channelId}</span>
                    {channel.isMine && (
                      <span className="bg-primary text-primary-foreground shrink-0 rounded-full px-2 py-0.5 text-xs">あなたのVC</span>
                    )}
                  </div>
                  <span className="text-muted-foreground text-xs whitespace-nowrap">
                    継続{" "}
                    <b className="text-foreground text-sm">
                      {formatDuration(Math.max(0, (now.getTime() - new Date(channel.createdAt).getTime()) / 1000))}
                    </b>
                  </span>
                </div>
                {channel.members.length === 0 ? (
                  // 状態未同期(bot停止中・作成直後)はAPIがuserLimit: nullで返すので、無人(削除待ち、#411)と区別する。
                  <p className="text-muted-foreground px-2 py-1.5 text-sm">
                    {channel.userLimit === null ? "在室状況を取得できません。" : "誰もいません。まもなく自動で削除されます。"}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {channel.members.map((m) => (
                      <VoiceMemberRow key={m.userId} member={m} badge={m.userId === channel.ownerId ? "オーナー" : undefined} />
                    ))}
                  </ul>
                )}
                <div className="flex items-center justify-between gap-2">
                  <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
                    {channel.userLimit !== null && (
                      <span className="bg-muted inline-flex items-center gap-1 rounded-full px-2 py-0.5">
                        <IconUsers className="size-3" aria-hidden />
                        {channel.userLimit === 0 ? "無制限" : `上限 ${channel.userLimit}人`}
                      </span>
                    )}
                    {channel.bitrate !== null && (
                      <span className="bg-muted inline-flex items-center gap-1 rounded-full px-2 py-0.5">
                        <IconWaveSine className="size-3" aria-hidden />
                        {Math.round(channel.bitrate / 1000)} kbps
                      </span>
                    )}
                    {channel.isHidden && (
                      <span className="bg-muted inline-flex items-center gap-1 rounded-full px-2 py-0.5">
                        <IconEyeOff className="size-3" aria-hidden />
                        非表示
                      </span>
                    )}
                  </div>
                </div>
                {(channel.isMine || canForceDelete) && (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {/* 設定変更はそのVCのオーナー本人のみ(管理者・サーバーオーナーでも不可)。 */}
                  {channel.isMine && (
                    <EditChannelButton
                      guildId={guildId}
                      channel={{
                        channelId: channel.channelId,
                        ownerId: channel.ownerId,
                        name: channel.channelName ?? "",
                        userLimit: channel.userLimit,
                        bitrate: channel.bitrate,
                        isLocked: channel.isLocked,
                        isHidden: channel.isHidden,
                        members: channel.members,
                      }}
                    />
                  )}
                  {canForceDelete && (
                    <ForceDeleteButton
                      guildId={guildId}
                      channel={{ channelId: channel.channelId, memberCount: channel.members.length }}
                      disabled={!isConfigured}
                      onConfirm={forceDeleteMutation.mutate}
                    />
                  )}
                </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DenyProtectedRolesTab({ guildId }: { guildId: string }) {
  const queryClient = useQueryClient();
  const rolesQuery = useQuery(trpc.tempVoice.getDenyProtectedRoles.queryOptions({ guildId }));
  const roleOptionsQuery = useQuery(trpc.tempVoice.listRoleOptions.queryOptions({ guildId }));
  const [selected, setSelected] = useState("");
  const mutation = useMutation({
    ...trpc.tempVoice.setDenyProtectedRoles.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: trpc.tempVoice.getDenyProtectedRoles.queryOptions({ guildId }).queryKey }),
    onError: () => toast.error("拒否禁止ロールの更新に失敗しました。"),
  });

  if (rolesQuery.isPending || roleOptionsQuery.isPending) return <Loading />;
  if (isForbiddenError(rolesQuery.error) || isForbiddenError(roleOptionsQuery.error)) {
    return <ForbiddenState pageName="拒否禁止ロール" capabilities={["MANAGE_TEMP_VOICE"]} />;
  }
  if (rolesQuery.isError || !rolesQuery.data || roleOptionsQuery.isError || !roleOptionsQuery.data) {
    return (
      <ErrorState
        subject="拒否禁止ロール"
        onRetry={() => [rolesQuery, roleOptionsQuery].forEach((query) => void query.refetch())}
      />
    );
  }

  const roleNameById = new Map(roleOptionsQuery.data.map((r) => [r.id, r.name]));
  const availableOptions = roleOptionsQuery.data.filter(
    (r) => r.id !== guildId && !rolesQuery.data.includes(r.id),
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        選択したロールは、一時VCオーナーが個別に拒否できなくなります。@everyone は常に保護されます。
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="text-muted-foreground flex flex-col gap-1.5 text-sm">
          追加するロール
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="w-full sm:w-64" aria-label="追加するロール">
              <SelectValue placeholder="ロールを選択..." />
            </SelectTrigger>
            <SelectContent>
              {availableOptions.map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <Button
          type="button"
          className="w-full sm:w-auto"
          disabled={selected === "" || mutation.isPending}
          onClick={() => {
            mutation.mutate({ guildId, roleIds: [...rolesQuery.data, selected] });
            setSelected("");
          }}
        >
          追加
        </Button>
      </div>
      {rolesQuery.data.length > 0 && (
        <ul className="bg-card divide-y rounded-xl border">
          {rolesQuery.data.map((roleId) => (
            <li key={roleId} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1 truncate">{roleNameById.get(roleId) ?? roleId}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`${roleNameById.get(roleId) ?? roleId}を削除`}
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ guildId, roleIds: rolesQuery.data.filter((id) => id !== roleId) })}
              >
                削除
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ClearConfigButton({ guildId, disabled, onCleared }: { guildId: string; disabled: boolean; onCleared: () => void }) {
  const queryClient = useQueryClient();
  const clearMutation = useMutation({
    ...trpc.tempVoice.clearConfig.mutationOptions(),
    onSuccess: () => {
      toast.success("一時VCの設定を解除しました");
      void queryClient.invalidateQueries({ queryKey: trpc.tempVoice.getConfig.queryOptions({ guildId }).queryKey });
      onCleared();
    },
    onError: () => toast.error("解除に失敗しました。"),
  });

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="text-destructive border-destructive/40 w-fit"
          disabled={disabled || clearMutation.isPending}
        >
          一時VCの設定を解除
        </Button>
      </DialogTrigger>
      <DialogContent className="top-1/2 left-1/2 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border p-6">
        <DialogHeader>
          <DialogTitle>一時VCの設定を解除しますか?</DialogTitle>
          <DialogDescription>
            作成用ボイスチャンネルとカテゴリの設定が未設定に戻り、自動セットアップ画面から再設定できるようになります。名前テンプレート等の共通設定は保持されます。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">キャンセル</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="destructive" onClick={() => clearMutation.mutate({ guildId })}>
              解除する
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const FIELD_LABEL = "text-muted-foreground flex min-w-0 flex-col gap-1.5 text-sm";

/**
 * 作成用チャンネル・カテゴリと共通設定を1つの下書きとして編集し、保存バーからまとめて保存する。
 * 未設定かつ手動設定を選んでいない間は、作成用チャンネル・カテゴリの欄を出さない。
 */
function ConfigForm({
  guildId,
  config,
  showChannelFields,
  isConfigured,
  onCleared,
}: {
  guildId: string;
  config: TempVoiceConfigData;
  showChannelFields: boolean;
  isConfigured: boolean;
  onCleared: () => void;
}) {
  const queryClient = useQueryClient();
  const voiceOptionsQuery = useQuery({
    ...trpc.tempVoice.listVoiceChannelOptions.queryOptions({ guildId }),
    enabled: showChannelFields,
  });
  const categoryOptionsQuery = useQuery({
    ...trpc.tempVoice.listCategoryOptions.queryOptions({ guildId }),
    enabled: showChannelFields,
  });
  const setConfig = useMutation(trpc.tempVoice.setConfig.mutationOptions());
  const [draftState, setDraftState] = useState<TempVoiceDraft | null>(null);

  const draft = draftState ?? buildTempVoiceDraft(config);
  const changes = diffTempVoiceConfig(config, draft);
  const update = (patch: Partial<TempVoiceDraft>) => setDraftState({ ...draft, ...patch });

  const save = async () => {
    if (changes.errors.length > 0) return;
    try {
      await setConfig.mutateAsync({ guildId, ...changes.input });
      toast.success("保存しました");
      setDraftState(null);
    } catch {
      toast.error("保存に失敗しました。時間をおいて再度お試しください。");
    } finally {
      await queryClient.invalidateQueries({ queryKey: trpc.tempVoice.getConfig.queryOptions({ guildId }).queryKey });
    }
  };

  const channelOptionsFailed = voiceOptionsQuery.isError || categoryOptionsQuery.isError;

  return (
    <div className="flex flex-col gap-4">
      {showChannelFields && (
        <section className="bg-card flex flex-col gap-3 rounded-xl border p-5">
          <h2 className="font-bold">作成用ボイスチャンネル</h2>
          {channelOptionsFailed ? (
            <InlineError
              summary="チャンネル一覧を読み込めませんでした。"
              onRetry={() => [voiceOptionsQuery, categoryOptionsQuery].forEach((query) => void query.refetch())}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={FIELD_LABEL}>
                作成用ボイスチャンネル
                <Select
                  value={draft.createChannelId}
                  onValueChange={(value) => update({ createChannelId: value })}
                  disabled={voiceOptionsQuery.isPending}
                >
                  <SelectTrigger className="w-full" aria-label="作成用ボイスチャンネル">
                    <SelectValue placeholder="選択してください" />
                  </SelectTrigger>
                  <SelectContent>
                    {(voiceOptionsQuery.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className={FIELD_LABEL}>
                カテゴリ
                <Select
                  value={draft.categoryId}
                  onValueChange={(value) => update({ categoryId: value })}
                  disabled={categoryOptionsQuery.isPending}
                >
                  <SelectTrigger className="w-full" aria-label="カテゴリ">
                    <SelectValue placeholder="選択してください" />
                  </SelectTrigger>
                  <SelectContent>
                    {(categoryOptionsQuery.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
          )}
          <p className="text-muted-foreground text-xs">
            セレクターに表示されるのはこのサーバーに実在するチャンネルのみです。IDを直接入力することはできません。
          </p>
        </section>
      )}

      <section className="bg-card flex flex-col gap-3 rounded-xl border p-5">
        <h2 className="font-bold">共通設定</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={FIELD_LABEL} htmlFor="temp-voice-name-template">
            名前テンプレート
            <Input id="temp-voice-name-template" value={draft.nameTemplate} onChange={(e) => update({ nameTemplate: e.target.value })} />
            <span className="text-xs">{"{username} が入室者の名前に置き換わります"}</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={FIELD_LABEL} htmlFor="temp-voice-user-limit">
              デフォルト人数制限
              <Input
                id="temp-voice-user-limit"
                type="number"
                min={0}
                max={99}
                value={draft.userLimit}
                onChange={(e) => update({ userLimit: e.target.value })}
              />
            </label>
            <label className={FIELD_LABEL} htmlFor="temp-voice-bitrate">
              デフォルト音質(kbps)
              <Input
                id="temp-voice-bitrate"
                placeholder="サーバー既定"
                value={draft.bitrateKbps}
                onChange={(e) => update({ bitrateKbps: e.target.value })}
              />
            </label>
          </div>
        </div>
      </section>

      {changes.errors.length > 0 && (
        <ul className="text-destructive flex flex-col gap-1 text-sm">
          {changes.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      {isConfigured && <ClearConfigButton guildId={guildId} disabled={setConfig.isPending} onCleared={onCleared} />}

      <SaveBar
        dirty={hasTempVoiceChanges(changes)}
        saving={setConfig.isPending}
        onSave={() => void save()}
        onDiscard={() => setDraftState(null)}
      />
    </div>
  );
}

function SettingsTab({ guildId, config }: { guildId: string; config: TempVoiceConfigData }) {
  const queryClient = useQueryClient();
  const [manualMode, setManualMode] = useState(false);
  const isConfigured = Boolean(config.createChannelId || config.categoryId);
  // 自動セットアップはbot側がpg_notify経由で非同期にDB更新するため、ミューテーション成功時点では
  // まだ未反映のことがある。isConfiguredになるまで数秒間ポーリングしてUIを追従させる(#441関連の手動リロード回避)。
  const [isPollingAfterAutoSetup, setIsPollingAfterAutoSetup] = useState(false);
  useQuery({
    ...trpc.tempVoice.getConfig.queryOptions({ guildId }),
    enabled: isPollingAfterAutoSetup,
    refetchInterval: isPollingAfterAutoSetup ? 1500 : false,
  });
  useEffect(() => {
    if (isPollingAfterAutoSetup && isConfigured) setIsPollingAfterAutoSetup(false);
  }, [isPollingAfterAutoSetup, isConfigured]);
  const autoSetupMutation = useMutation({
    ...trpc.tempVoice.autoSetupConfig.mutationOptions(),
    onSuccess: () => {
      toast.success("設定中です。数秒後に反映されない場合はBotの権限を確認してください。");
      setIsPollingAfterAutoSetup(true);
      void queryClient.invalidateQueries({ queryKey: trpc.tempVoice.getConfig.queryOptions({ guildId }).queryKey });
    },
    onError: () => toast.error("自動セットアップに失敗しました。"),
  });

  const showAutoSetup = !isConfigured && !manualMode;

  return (
    <div className="flex flex-col gap-4">
      {showAutoSetup && (
        <section className="bg-card flex flex-col items-center gap-3 rounded-xl border p-8 text-center">
          <h2 className="text-lg font-bold">まだ一時VCが設定されていません</h2>
          <p className="text-muted-foreground max-w-md text-sm">
            自動セットアップを押すと、Botがカテゴリと作成用ボイスチャンネルをDiscord上に作成します。既存のチャンネルを使う場合は手動で設定してください。
          </p>
          <div className="grid w-full max-w-md grid-cols-1 gap-2.5 sm:grid-cols-2">
            <Button type="button" size="lg" disabled={autoSetupMutation.isPending} onClick={() => autoSetupMutation.mutate({ guildId })}>
              自動セットアップ
            </Button>
            <Button type="button" size="lg" variant="outline" onClick={() => setManualMode(true)}>
              手動で設定する
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">自動セットアップにはBotの「チャンネルの管理」権限が必要です。</p>
        </section>
      )}
      {!isConfigured && manualMode && (
        <button type="button" className="text-muted-foreground w-fit text-sm underline" onClick={() => setManualMode(false)}>
          自動セットアップに戻る
        </button>
      )}
      <ConfigForm
        guildId={guildId}
        config={config}
        showChannelFields={!showAutoSetup}
        isConfigured={isConfigured}
        onCleared={() => setManualMode(false)}
      />
    </div>
  );
}

export function TempVoicePage() {
  const { guildId } = useParams<{ guildId: string }>();
  const [tab, setTab] = useState<TempVoiceTab>("list");
  const capabilities = useGuildCapabilities(guildId);
  const canManage = capabilities !== undefined && hasCapability(capabilities, CAPABILITIES.MANAGE_TEMP_VOICE);

  // 設定・拒否禁止ロールはMANAGE_TEMP_VOICE必須(issue #527)。VIEWのみのユーザーには取得しない。
  const configQuery = useQuery({
    ...trpc.tempVoice.getConfig.queryOptions({ guildId: guildId ?? "" }),
    enabled: Boolean(guildId) && canManage,
  });

  if (!guildId) {
    return (
      <Alert variant="error">
        <AlertDescription>サーバーが指定されていません。</AlertDescription>
      </Alert>
    );
  }

  if (capabilities === undefined) return <Loading />;

  if (!canManage) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">一時VC</h1>
        <ActiveChannelsTab guildId={guildId} isConfigured={false} canForceDelete={false} />
      </div>
    );
  }

  if (configQuery.isPending) return <Loading />;
  // configQuery.dataは未設定ギルドでnullを返す(エラーではない)ため、isErrorのみで判定する。
  if (isForbiddenError(configQuery.error)) {
    return <ForbiddenState pageName="一時VC" capabilities={["MANAGE_TEMP_VOICE"]} />;
  }
  if (configQuery.isError) {
    return <ErrorState subject="一時VCの設定" onRetry={() => void configQuery.refetch()} />;
  }

  const config: TempVoiceConfigData = configQuery.data ?? {
    createChannelId: null,
    categoryId: null,
    nameTemplate: "{username}のVC",
    defaultUserLimit: 0,
    defaultBitrate: null,
  };
  const isConfigured = Boolean(config.createChannelId || config.categoryId);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">一時VC</h1>

      <Tabs value={tab} onValueChange={(value) => setTab(value as TempVoiceTab)}>
        <TabsList aria-label="一時VCの設定" className="grid w-full grid-cols-3 sm:inline-flex sm:w-fit">
          <TabsTrigger value="list">一時VC一覧</TabsTrigger>
          <TabsTrigger value="roles">拒否禁止ロール</TabsTrigger>
          <TabsTrigger value="settings">設定</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="flex flex-col gap-4">
          {!isConfigured && <NotConfiguredBanner onGoSettings={() => setTab("settings")} />}
          <ActiveChannelsTab guildId={guildId} isConfigured={isConfigured} canForceDelete />
        </TabsContent>

        <TabsContent value="roles" className="flex flex-col gap-4">
          {!isConfigured && <NotConfiguredBanner onGoSettings={() => setTab("settings")} />}
          <DenyProtectedRolesTab guildId={guildId} />
        </TabsContent>

        <TabsContent value="settings">
          <SettingsTab guildId={guildId} config={config} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
