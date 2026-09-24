import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { trpc } from "../trpc.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
    <Alert>
      <AlertDescription>
        一時VCがまだ設定されていません。
        <button type="button" className="ml-1 font-medium underline" onClick={onGoSettings}>
          設定タブ
        </button>
        から作成用チャンネルを設定してください。
      </AlertDescription>
    </Alert>
  );
}

function ActiveChannelsTab({ guildId, isConfigured }: { guildId: string; isConfigured: boolean }) {
  const queryClient = useQueryClient();
  const listQuery = useQuery(trpc.tempVoice.listActiveChannels.queryOptions({ guildId }));
  const forceDeleteMutation = useMutation({
    ...trpc.tempVoice.forceDelete.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: trpc.tempVoice.listActiveChannels.queryOptions({ guildId }).queryKey }),
  });

  if (listQuery.isPending) return <div className="text-sm">読み込み中...</div>;
  if (listQuery.isError || !listQuery.data) {
    return <div className="text-destructive text-sm">一時VC一覧の取得に失敗しました。</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold">一時VC一覧</h2>
        <p className="text-muted-foreground text-xs">現在Discord上に存在する一時VCです。</p>
      </div>
      {listQuery.data.length === 0 ? (
        <p className="text-muted-foreground rounded-md border p-8 text-center text-sm">
          現在アクティブな一時VCはありません。
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>チャンネル</TableHead>
              <TableHead>オーナー</TableHead>
              <TableHead>作成日時</TableHead>
              <TableHead>在室人数</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.data.map((channel) => (
              <TableRow key={channel.channelId}>
                <TableCell>{channel.channelId}</TableCell>
                <TableCell>{channel.ownerId}</TableCell>
                <TableCell>{new Date(channel.createdAt).toLocaleString("ja-JP")}</TableCell>
                <TableCell>{channel.memberCount}人</TableCell>
                <TableCell className="text-right">
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="destructive" size="sm" disabled={!isConfigured}>
                        強制削除
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="top-1/2 left-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border p-6">
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
                            onClick={() => forceDeleteMutation.mutate({ guildId, channelId: channel.channelId })}
                          >
                            削除する
                          </Button>
                        </DialogClose>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {forceDeleteMutation.isError && (
        <p className="text-destructive text-sm">強制削除リクエストの送信に失敗しました。</p>
      )}
      {forceDeleteMutation.isSuccess && (
        <p className="text-muted-foreground text-sm">削除リクエストを送信しました。数秒後に一覧から消えます。</p>
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
  });

  if (rolesQuery.isPending || roleOptionsQuery.isPending) return <div className="text-sm">読み込み中...</div>;
  if (rolesQuery.isError || !rolesQuery.data || roleOptionsQuery.isError || !roleOptionsQuery.data) {
    return <div className="text-destructive text-sm">拒否禁止ロールの取得に失敗しました。</div>;
  }

  const roleNameById = new Map(roleOptionsQuery.data.map((r) => [r.id, r.name]));
  const availableOptions = roleOptionsQuery.data.filter(
    (r) => r.id !== guildId && !rolesQuery.data.includes(r.id),
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold">拒否禁止ロール</h2>
        <p className="text-muted-foreground text-xs">
          選択したロールは、一時VCオーナーが個別に拒否できなくなります。@everyone は常に保護されます。
        </p>
      </div>
      <div className="flex gap-2">
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger className="w-64" aria-label="追加するロール">
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
        <Button
          type="button"
          disabled={selected === "" || mutation.isPending}
          onClick={() => {
            mutation.mutate({ guildId, roleIds: [...rolesQuery.data, selected] });
            setSelected("");
          }}
        >
          追加
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {rolesQuery.data.map((roleId) => (
          <span key={roleId} className="bg-muted flex items-center gap-1 rounded-full py-1 pr-1 pl-3 text-sm">
            {roleNameById.get(roleId) ?? roleId}
            <button
              type="button"
              aria-label={`${roleNameById.get(roleId) ?? roleId}を削除`}
              className="hover:bg-accent rounded-full p-1"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ guildId, roleIds: rolesQuery.data.filter((id) => id !== roleId) })}
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

function ManualConfigForm({
  guildId,
  config,
  onCancel,
}: {
  guildId: string;
  config: { createChannelId: string | null; categoryId: string | null };
  onCancel?: () => void;
}) {
  const queryClient = useQueryClient();
  const voiceOptionsQuery = useQuery(trpc.tempVoice.listVoiceChannelOptions.queryOptions({ guildId }));
  const categoryOptionsQuery = useQuery(trpc.tempVoice.listCategoryOptions.queryOptions({ guildId }));
  const [createChannelId, setCreateChannelId] = useState(config.createChannelId ?? "");
  const [categoryId, setCategoryId] = useState(config.categoryId ?? "");
  const mutation = useMutation({
    ...trpc.tempVoice.setConfig.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: trpc.tempVoice.getConfig.queryOptions({ guildId }).queryKey }),
  });

  if (voiceOptionsQuery.isPending || categoryOptionsQuery.isPending) return <div className="text-sm">読み込み中...</div>;
  if (voiceOptionsQuery.isError || !voiceOptionsQuery.data || categoryOptionsQuery.isError || !categoryOptionsQuery.data) {
    return <div className="text-destructive text-sm">チャンネル一覧の取得に失敗しました。</div>;
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">手動で設定する</p>
        {onCancel && (
          <button type="button" className="text-muted-foreground text-xs underline" onClick={onCancel}>
            自動セットアップに戻る
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">作成用ボイスチャンネル</label>
          <Select value={createChannelId} onValueChange={setCreateChannelId}>
            <SelectTrigger className="w-56" aria-label="作成用ボイスチャンネル">
              <SelectValue placeholder="選択してください" />
            </SelectTrigger>
            <SelectContent>
              {voiceOptionsQuery.data.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">カテゴリ</label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger className="w-56" aria-label="カテゴリ">
              <SelectValue placeholder="選択してください" />
            </SelectTrigger>
            <SelectContent>
              {categoryOptionsQuery.data.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        セレクターに表示されるのはこのサーバーに実在するチャンネルのみです。IDを直接入力することはできません。
      </p>
      <Button
        type="button"
        className="w-fit"
        disabled={createChannelId === "" || categoryId === "" || mutation.isPending}
        onClick={() => mutation.mutate({ guildId, createChannelId, categoryId })}
      >
        この設定を保存
      </Button>
      {mutation.isError && <p className="text-destructive text-xs">保存に失敗しました。</p>}
    </div>
  );
}

function CommonConfigForm({ guildId, config }: { guildId: string; config: TempVoiceConfigData }) {
  const queryClient = useQueryClient();
  const [nameTemplate, setNameTemplate] = useState(config.nameTemplate);
  const [userLimit, setUserLimit] = useState(String(config.defaultUserLimit));
  const [bitrateKbps, setBitrateKbps] = useState(
    config.defaultBitrate ? String(Math.floor(config.defaultBitrate / 1000)) : "",
  );
  const mutation = useMutation({
    ...trpc.tempVoice.setConfig.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: trpc.tempVoice.getConfig.queryOptions({ guildId }).queryKey }),
  });

  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <p className="text-muted-foreground text-sm font-medium">共通設定(自動・手動どちらで設定した後でも変更できます)</p>
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="temp-voice-name-template">
            名前テンプレート
          </label>
          <Input
            id="temp-voice-name-template"
            className="w-56"
            value={nameTemplate}
            onChange={(e) => setNameTemplate(e.target.value)}
            onBlur={() => {
              if (nameTemplate !== config.nameTemplate) mutation.mutate({ guildId, nameTemplate });
            }}
          />
          <p className="text-muted-foreground text-xs">{"{username} が入室者の名前に置き換わります"}</p>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="temp-voice-user-limit">
            デフォルト人数制限
          </label>
          <Input
            id="temp-voice-user-limit"
            type="number"
            min={0}
            max={99}
            className="w-24"
            value={userLimit}
            onChange={(e) => setUserLimit(e.target.value)}
            onBlur={() => {
              const parsed = Number(userLimit);
              if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 99 && parsed !== config.defaultUserLimit) {
                mutation.mutate({ guildId, defaultUserLimit: parsed });
              } else {
                setUserLimit(String(config.defaultUserLimit));
              }
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="temp-voice-bitrate">
            デフォルト音質(kbps)
          </label>
          <Input
            id="temp-voice-bitrate"
            className="w-32"
            placeholder="未設定(サーバー既定)"
            value={bitrateKbps}
            onChange={(e) => setBitrateKbps(e.target.value)}
            onBlur={() => {
              if (bitrateKbps.trim() === "") {
                if (config.defaultBitrate !== null) mutation.mutate({ guildId, defaultBitrate: null });
                return;
              }
              const parsed = Number(bitrateKbps);
              if (Number.isInteger(parsed) && parsed > 0) {
                mutation.mutate({ guildId, defaultBitrate: parsed * 1000 });
              } else {
                setBitrateKbps(config.defaultBitrate ? String(Math.floor(config.defaultBitrate / 1000)) : "");
              }
            }}
          />
        </div>
      </div>
      {mutation.isError && <p className="text-destructive text-xs">保存に失敗しました。</p>}
    </div>
  );
}

function SettingsTab({ guildId, config }: { guildId: string; config: TempVoiceConfigData }) {
  const queryClient = useQueryClient();
  const [manualMode, setManualMode] = useState(false);
  const isConfigured = Boolean(config.createChannelId || config.categoryId);
  const autoSetupMutation = useMutation({
    ...trpc.tempVoice.autoSetupConfig.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: trpc.tempVoice.getConfig.queryOptions({ guildId }).queryKey }),
  });

  const showAutoSetup = !isConfigured && !manualMode;

  return (
    <div className="flex flex-col gap-6 rounded-lg border p-4">
      <div>
        <h2 className="text-sm font-semibold">設定</h2>
        <p className="text-muted-foreground text-xs">
          {isConfigured ? "作成用チャンネルとカテゴリを手動で変更できます。" : "作成用ボイスチャンネルとカテゴリがまだ設定されていません。"}
        </p>
      </div>

      {showAutoSetup ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed p-6 text-center">
          <p className="text-sm font-medium">まだ一時VCが設定されていません</p>
          <p className="text-muted-foreground max-w-sm text-xs">
            ボタン1つでカテゴリと作成用ボイスチャンネルをDiscord上に自動生成します。
          </p>
          <Button type="button" disabled={autoSetupMutation.isPending} onClick={() => autoSetupMutation.mutate({ guildId })}>
            自動でセットアップ
          </Button>
          <button type="button" className="text-muted-foreground text-xs underline" onClick={() => setManualMode(true)}>
            すでにチャンネルがある場合は手動で設定する
          </button>
          {autoSetupMutation.isError && <p className="text-destructive text-xs">自動セットアップに失敗しました。</p>}
          {autoSetupMutation.isSuccess && (
            <p className="text-muted-foreground text-xs">設定中です。数秒後に反映されない場合はBotの権限を確認してください。</p>
          )}
        </div>
      ) : (
        <ManualConfigForm
          guildId={guildId}
          config={{ createChannelId: config.createChannelId, categoryId: config.categoryId }}
          onCancel={isConfigured ? undefined : () => setManualMode(false)}
        />
      )}

      <CommonConfigForm guildId={guildId} config={config} />
    </div>
  );
}

export function TempVoicePage() {
  const { guildId } = useParams<{ guildId: string }>();
  const [tab, setTab] = useState<TempVoiceTab>("list");

  const configQuery = useQuery({
    ...trpc.tempVoice.getConfig.queryOptions({ guildId: guildId ?? "" }),
    enabled: Boolean(guildId),
  });

  if (!guildId) {
    return (
      <Alert variant="destructive">
        <AlertDescription>サーバーが指定されていません。</AlertDescription>
      </Alert>
    );
  }

  if (configQuery.isPending) return <div className="text-sm">読み込み中...</div>;
  // configQuery.dataは未設定ギルドでnullを返す(エラーではない)ため、isErrorのみで判定する。
  if (configQuery.isError) {
    return <div className="text-destructive text-sm">設定の取得に失敗しました。</div>;
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
      <h1 className="text-lg font-semibold">一時VC</h1>

      <Tabs value={tab} onValueChange={(value) => setTab(value as TempVoiceTab)}>
        <TabsList aria-label="一時VCの設定">
          <TabsTrigger value="list">一時VC一覧</TabsTrigger>
          <TabsTrigger value="roles">拒否禁止ロール</TabsTrigger>
          <TabsTrigger value="settings">設定</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="flex flex-col gap-4">
          {!isConfigured && <NotConfiguredBanner onGoSettings={() => setTab("settings")} />}
          <ActiveChannelsTab guildId={guildId} isConfigured={isConfigured} />
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
