import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { toast } from "@/components/starwind/toast";
import { CAPABILITIES, hasCapability } from "@management-bot/shared";
import { useGuildCapabilities } from "../guild-pages.js";
import { trpc } from "../trpc.js";
import { formatTime, groupByDay } from "./day-groups.js";
import {
  SCHEDULED_POST_TABS,
  countByTab,
  describeOutcome,
  describeRelativeTime,
  tabOfStatus,
  type ScheduledPostTab,
} from "./scheduled-post-view.js";
import { BOT_PERMISSION_LABELS } from "./bot-permission-labels.js";
import { BotNotJoinedState, BotPermissionState, ErrorState } from "@/components/page-state";
import { InitialAvatar } from "@/components/initial-avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, ButtonVariants } from "@/components/starwind/button";
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
import { Loading } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface PostRow {
  id: string;
  channelId: string;
  channelName?: string | undefined;
  authorId: string;
  /** 操作者本人の予約か(APIが返す)。 */
  isMine: boolean;
  authorName?: string | undefined;
  authorAvatarUrl?: string | undefined;
  mentions?: readonly string[];
  content: string;
  scheduledAt: string;
  status: string;
  failureReason: string | null;
  cancelledBy: string | null;
}

/** 状態バッジ。投稿待ちは日時が主役のためバッジを出さない。 */
const STATUS_BADGES: Record<string, { label: string; tone: string }> = {
  posting: { label: "投稿処理中", tone: "bg-muted text-muted-foreground" },
  posted: { label: "投稿しました", tone: "bg-success/10 text-success" },
  failed: { label: "投稿できませんでした", tone: "bg-destructive/10 text-destructive" },
  cancelled: { label: "取り消し", tone: "bg-muted text-muted-foreground" },
};

function CancelButton({ onConfirm, disabled, notifiesAuthor }: { onConfirm: () => void; disabled: boolean; notifiesAuthor: boolean }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-destructive border-destructive/40" disabled={disabled}>
          取り消す
        </Button>
      </DialogTrigger>
      <DialogContent className="top-1/2 left-1/2 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border p-6">
        <DialogHeader>
          <DialogTitle>予約を取り消しますか?</DialogTitle>
          <DialogDescription>{notifiesAuthor ? "予約者にDMで通知されます。" : ""}この操作は元に戻せません。</DialogDescription>
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

function PostCard({
  row,
  canCancel,
  notifiesAuthor,
  cancelling,
  onCancel,
}: {
  row: PostRow;
  canCancel: boolean;
  notifiesAuthor: boolean;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const relative = describeRelativeTime(row.scheduledAt, row.status);
  const badge = STATUS_BADGES[row.status];
  const outcome = describeOutcome(row);
  const author = row.authorName ?? row.authorId;
  return (
    <article className="bg-card grid grid-cols-1 items-start gap-2 rounded-xl border px-4 py-3.5 sm:grid-cols-[6rem_minmax(0,1fr)_auto] sm:gap-4">
      <div className="flex items-baseline gap-2.5 sm:block sm:border-r sm:pr-3">
        <div className="text-[22px] leading-tight font-bold tabular-nums">{formatTime(row.scheduledAt)}</div>
        <div className={cn("text-xs sm:mt-1", relative.upcoming ? "font-medium text-sky-600 dark:text-sky-400" : "text-muted-foreground")}>
          {relative.text}
        </div>
      </div>
      <div className="min-w-0">
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
          <span className="text-foreground font-semibold">#{row.channelName ?? row.channelId}</span>
          <span className="inline-flex items-center gap-1.5">
            <InitialAvatar name={author} avatarUrl={row.authorAvatarUrl} className="size-5 text-[10px]" />
            {author}
          </span>
          {row.mentions?.map((mention) => (
            <span key={mention} className="rounded bg-sky-600/10 px-1.5 text-xs text-sky-600 dark:text-sky-400">
              {mention}
            </span>
          ))}
        </div>
        <p className="mt-1.5 line-clamp-3 text-sm break-words whitespace-pre-line [overflow-wrap:anywhere]">{row.content}</p>
        {badge && (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs whitespace-nowrap", badge.tone)}>
              <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
              {badge.label}
            </span>
            {outcome && row.status !== "posting" && <span className="text-muted-foreground">{outcome}</span>}
          </p>
        )}
      </div>
      {canCancel && <CancelButton disabled={cancelling} onConfirm={onCancel} notifiesAuthor={notifiesAuthor} />}
    </article>
  );
}

function PostsList({
  rows,
  tab,
  canManage,
  canView,
  cancelling,
  onCancel,
}: {
  rows: readonly PostRow[];
  tab: ScheduledPostTab;
  canManage: boolean;
  /** 全員の予約を閲覧できるか。falseのときrowsは自分の予約のみ(APIが絞る)。 */
  canView: boolean;
  cancelling: boolean;
  onCancel: (id: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
        {canView ? "該当する予約はありません。" : "あなたの予約はありません。"}
      </p>
    );
  }
  // 投稿待ちは近い順、それ以外は新しい順。
  const sorted = [...rows].sort((a, b) => {
    const diff = new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    return tab === "pending" ? diff : -diff;
  });
  return (
    <div className="flex flex-col gap-3">
      {tab !== "pending" && (
        <p className="text-muted-foreground text-[13px]">投稿済み・失敗・取り消しの予約は30日後に自動で削除されます。</p>
      )}
      {groupByDay(sorted, (row) => row.scheduledAt).map((group) => (
        <section key={group.key} className="flex flex-col gap-2.5">
          <h2 className="after:bg-border flex items-center gap-2.5 text-[13px] font-semibold after:h-px after:flex-1">
            {group.relative}
            <small className={cn("font-normal", group.relative ? "text-muted-foreground" : "text-foreground font-semibold")}>{group.date}</small>
          </h2>
          {group.items.map((row) => (
            <PostCard
              key={row.id}
              row={row}
              canCancel={(canManage || row.isMine) && tab === "pending" && row.status === "pending"}
              notifiesAuthor={canManage}
              cancelling={cancelling}
              onCancel={() => onCancel(row.id)}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

export function ScheduledPostPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const [tab, setTab] = useState<ScheduledPostTab>("pending");
  const queryClient = useQueryClient();
  const capabilities = useGuildCapabilities(guildId);
  const canManage = capabilities !== undefined && hasCapability(capabilities, CAPABILITIES.MANAGE_SCHEDULED_POSTS);

  const canView = capabilities !== undefined && hasCapability(capabilities, CAPABILITIES.VIEW_SCHEDULED_POSTS);

  // Bot権限の状態は閲覧権限が必要(なければFORBIDDENになるため呼ばない)。
  const statusQuery = useQuery({
    ...trpc.scheduledPost.getRequiredPermissionStatus.queryOptions({ guildId: guildId ?? "" }),
    enabled: Boolean(guildId) && canView,
  });
  const listQuery = useQuery({
    ...trpc.scheduledPost.list.queryOptions({ guildId: guildId ?? "" }),
    enabled: Boolean(guildId),
  });
  const cancelCallbacks = {
    onSuccess: () => toast.success("予約を取り消しました。"),
    onError: () => toast.error("取り消しに失敗しました。すでに投稿処理が始まった可能性があります。"),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: trpc.scheduledPost.list.queryOptions({ guildId: guildId ?? "" }).queryKey }),
  };
  const cancelAdminMutation = useMutation({ ...trpc.scheduledPost.cancel.mutationOptions(), ...cancelCallbacks });
  const cancelOwnMutation = useMutation({ ...trpc.scheduledPost.cancelOwn.mutationOptions(), ...cancelCallbacks });
  const cancelMutation = canManage ? cancelAdminMutation : cancelOwnMutation;

  if (!guildId) {
    return (
      <Alert variant="destructive">
        <AlertDescription>サーバーが指定されていません。</AlertDescription>
      </Alert>
    );
  }
  if (capabilities === undefined) return <Loading />;

  const status = statusQuery.data;
  const counts = listQuery.data ? countByTab(listQuery.data) : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">予約投稿</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {canView ? (
              <>
                メンバーが <code>/schedule</code> で予約した投稿の一覧です。
              </>
            ) : (
              <>
                あなたが <code>/schedule</code> で予約した投稿の一覧です。
              </>
            )}
          </p>
        </div>
        {canManage && (
          <Link
            to={`/guilds/${guildId}/scheduled-post/settings`}
            data-slot="button"
            className={ButtonVariants.button({ variant: "outline" })}
          >
            <Settings aria-hidden="true" />
            予約投稿の設定
          </Link>
        )}
      </div>

      {status?.accessStatus === "not_found" && <BotNotJoinedState />}
      {status && status.accessStatus !== "not_found" && !status.hasRequiredPermissions && (
        <BotPermissionState guildId={guildId} permissions={BOT_PERMISSION_LABELS.scheduledPost} reauthorizeUrl={status.reauthorizeUrl} />
      )}

      <Tabs value={tab} onValueChange={(value) => setTab(SCHEDULED_POST_TABS.find((t) => t.value === value)?.value ?? "pending")}>
        <TabsList aria-label="予約投稿" className="overflow-x-auto">
          {SCHEDULED_POST_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
              {counts && (
                <span className="bg-muted text-muted-foreground ml-1.5 rounded-full px-1.5 text-[11px] font-normal">{counts[t.value]}</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        {SCHEDULED_POST_TABS.map((t) => (
          <TabsContent key={t.value} value={t.value}>
            {listQuery.isPending && <Loading />}
            {listQuery.isError && <ErrorState subject="予約一覧" onRetry={() => void listQuery.refetch()} />}
            {listQuery.data && (
              <PostsList
                rows={listQuery.data.filter((row) => tabOfStatus(row.status) === t.value)}
                tab={t.value}
                canManage={canManage}
                canView={canView}
                cancelling={cancelMutation.isPending}
                onCancel={(id) => cancelMutation.mutate({ guildId, id })}
              />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
