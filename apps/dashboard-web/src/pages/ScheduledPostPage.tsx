import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { CAPABILITIES, hasCapability } from "@management-bot/shared";
import { useGuildCapabilities } from "../guild-pages.js";
import { trpc } from "../trpc.js";
import { SCHEDULED_POST_TABS, describeOutcome, tabOfStatus, type ScheduledPostTab } from "./scheduled-post-view.js";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loading } from "@/components/ui/skeleton";

type PageTab = ScheduledPostTab | "settings";

const CONTENT_PREVIEW_MAX = 80;

function preview(content: string): string {
  const text = content.replace(/\s+/g, " ").trim();
  return text.length > CONTENT_PREVIEW_MAX ? `${text.slice(0, CONTENT_PREVIEW_MAX)}…` : text;
}

const formatDateTime = (value: string | Date): string => new Date(value).toLocaleString("ja-JP");

function CancelButton({ onConfirm, disabled }: { onConfirm: () => void; disabled: boolean }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-destructive border-destructive/40" disabled={disabled}>
          取り消し
        </Button>
      </DialogTrigger>
      <DialogContent className="top-1/2 left-1/2 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border p-6">
        <DialogHeader>
          <DialogTitle>予約を取り消しますか?</DialogTitle>
          <DialogDescription>予約者にDMで通知されます。この操作は元に戻せません。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">やめる</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="destructive" onClick={onConfirm}>
              取り消す
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PostsTab({ guildId, tab, canManage }: { guildId: string; tab: ScheduledPostTab; canManage: boolean }) {
  const queryClient = useQueryClient();
  const listQuery = useQuery({ ...trpc.scheduledPost.list.queryOptions({ guildId }), refetchInterval: 15_000 });
  const cancelMutation = useMutation({
    ...trpc.scheduledPost.cancel.mutationOptions(),
    onSuccess: () => toast.success("予約を取り消しました。"),
    onError: () => toast.error("取り消しに失敗しました。すでに投稿処理が始まった可能性があります。"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: trpc.scheduledPost.list.queryOptions({ guildId }).queryKey }),
  });

  if (listQuery.isPending) return <Loading />;
  if (listQuery.isError || !listQuery.data) {
    return (
      <Alert variant="destructive">
        <AlertDescription>予約一覧の取得に失敗しました。</AlertDescription>
      </Alert>
    );
  }

  const rows = listQuery.data.filter((row) => tabOfStatus(row.status) === tab);
  if (rows.length === 0) {
    return <p className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">該当する予約はありません。</p>;
  }

  const showCancel = canManage && tab === "pending";
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">投稿済み・失敗・取り消しの予約は30日後に自動で削除されます。</p>
      <div className="bg-card overflow-hidden rounded-xl border">
        <ul className="divide-y">
          {rows.map((row) => {
            const outcome = describeOutcome(row);
            return (
              <li key={row.id} className="flex items-start gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium">
                    {formatDateTime(row.scheduledAt)} ・ #{row.channelName ?? row.channelId}
                  </span>
                  <span className="text-muted-foreground text-xs">予約者 {row.authorName ?? row.authorId}</span>
                  <span className="text-sm break-words">{preview(row.content)}</span>
                  {outcome && <span className="text-muted-foreground text-xs">{outcome}</span>}
                </div>
                {showCancel && row.status === "pending" && (
                  <CancelButton disabled={cancelMutation.isPending} onConfirm={() => cancelMutation.mutate({ guildId, id: row.id })} />
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** 「使えるロール」。空ならメンバー全員が使える。ロールはセレクターから選ぶ(ID直接入力は不可)。 */
function AllowedRolesSection({ guildId }: { guildId: string }) {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery(trpc.scheduledPost.getSettings.queryOptions({ guildId }));
  const roleOptionsQuery = useQuery(trpc.scheduledPost.listRoleOptions.queryOptions({ guildId }));
  const [selected, setSelected] = useState("");
  const mutation = useMutation({
    ...trpc.scheduledPost.updateSettings.mutationOptions(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.scheduledPost.getSettings.queryOptions({ guildId }).queryKey }),
    onError: () => toast.error("使えるロールの更新に失敗しました。"),
  });

  if (settingsQuery.isPending || roleOptionsQuery.isPending) return <Loading />;
  if (settingsQuery.isError || !settingsQuery.data || roleOptionsQuery.isError || !roleOptionsQuery.data) {
    return (
      <Alert variant="destructive">
        <AlertDescription>使えるロールの取得に失敗しました。</AlertDescription>
      </Alert>
    );
  }

  const allowedRoleIds = settingsQuery.data.allowedRoleIds;
  const roleNameById = new Map(roleOptionsQuery.data.map((role) => [role.id, role.name]));
  const availableOptions = roleOptionsQuery.data.filter((role) => !allowedRoleIds.includes(role.id));

  return (
    <section className="bg-card flex flex-col gap-3 rounded-xl border p-5">
      <h2 className="font-bold">使えるロール</h2>
      <p className="text-muted-foreground text-sm">
        ロールを追加すると、そのロールを持つメンバーだけが予約投稿を使えます。1つも追加しない場合はメンバー全員が使えます。
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
            mutation.mutate({ guildId, roleIds: [...allowedRoleIds, selected] });
            setSelected("");
          }}
        >
          追加
        </Button>
      </div>
      {allowedRoleIds.length === 0 ? (
        <p className="text-muted-foreground text-sm">現在はメンバー全員が使えます。</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {allowedRoleIds.map((roleId) => (
            <li key={roleId} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1 truncate">{roleNameById.get(roleId) ?? roleId}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`${roleNameById.get(roleId) ?? roleId}を削除`}
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ guildId, roleIds: allowedRoleIds.filter((id) => id !== roleId) })}
              >
                削除
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ScheduledPostPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const [tab, setTab] = useState<PageTab>("pending");
  const capabilities = useGuildCapabilities(guildId);
  const canManage = capabilities !== undefined && hasCapability(capabilities, CAPABILITIES.MANAGE_SCHEDULED_POSTS);

  const statusQuery = useQuery({
    ...trpc.scheduledPost.getRequiredPermissionStatus.queryOptions({ guildId: guildId ?? "" }),
    enabled: Boolean(guildId),
  });

  if (!guildId) {
    return (
      <Alert variant="destructive">
        <AlertDescription>サーバーが指定されていません。</AlertDescription>
      </Alert>
    );
  }
  if (capabilities === undefined) return <Loading />;

  const status = statusQuery.data;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">予約投稿</h1>

      {status?.accessStatus === "not_found" && (
        <Alert variant="destructive">
          <AlertDescription>このサーバーにBotが参加していません。</AlertDescription>
        </Alert>
      )}
      {status && !status.hasRequiredPermissions && (
        <Alert variant="destructive">
          <AlertDescription>
            Botの権限(チャンネルを見る・メッセージを送信・スレッドでメッセージを送信)が不足しています。
            {status.reauthorizeUrl && (
              <>
                {" "}
                <a href={status.reauthorizeUrl} className="underline" target="_blank" rel="noreferrer">
                  必要な権限を付与してBotを再認可する
                </a>
              </>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={(value) => setTab(value as PageTab)}>
        <TabsList aria-label="予約投稿" className="grid w-full grid-cols-3 sm:inline-flex sm:w-fit">
          {SCHEDULED_POST_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
          {canManage && <TabsTrigger value="settings">設定</TabsTrigger>}
        </TabsList>
        {SCHEDULED_POST_TABS.map((t) => (
          <TabsContent key={t.value} value={t.value}>
            <PostsTab guildId={guildId} tab={t.value} canManage={canManage} />
          </TabsContent>
        ))}
        {canManage && (
          <TabsContent value="settings">
            <AllowedRolesSection guildId={guildId} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
