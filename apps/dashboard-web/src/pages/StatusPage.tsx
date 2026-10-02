import { INFRA_LOG_SERVICES, type InfraLogService } from "@management-bot/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { trpc } from "../trpc.js";
import {
  describeItem,
  filterLogs,
  formatDateTime,
  ITEM_META,
  LEVEL_STYLE,
  SERVICE_META,
  STATE_META,
  type LevelFilter,
  type StatusItem,
} from "./status-labels.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loading } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/** ヘッダーの状態ランプと同じクエリ・同じ間隔で更新する(キャッシュを共有する)。 */
export const STATUS_REFETCH_MS = 30_000;
const LOG_REFETCH_MS = 5_000;

const isNotFoundError = (error: unknown) => error instanceof TRPCClientError && error.data?.code === "NOT_FOUND";

/** 閲覧権限のない人には画面の存在自体を隠す(APIもNOT_FOUNDを返す)。 */
export function NotFoundPage() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-3 py-16 text-center">
      <span className="text-6xl font-bold tracking-wide">404</span>
      <p className="text-muted-foreground">ページが見つかりません。</p>
      <Button asChild className="mt-2 h-11 px-5">
        <Link to="/">サーバー一覧へ戻る</Link>
      </Button>
    </div>
  );
}

type StatusTab = "status" | "logs" | "access";
type ServiceFilter = InfraLogService | "all";

const parseTab = (value: string | null, isOwner: boolean): StatusTab =>
  value === "logs" || (value === "access" && isOwner) ? value : "status";
const parseService = (value: string | null): ServiceFilter =>
  INFRA_LOG_SERVICES.find((service) => service === value) ?? "all";

export function StatusPage({ isOwner }: { isOwner: boolean }) {
  const [params, setParams] = useSearchParams();
  const tab = parseTab(params.get("tab"), isOwner);
  const service = parseService(params.get("service"));
  const overview = useQuery({ ...trpc.status.overview.queryOptions(), refetchInterval: STATUS_REFETCH_MS });

  if (isNotFoundError(overview.error)) return <NotFoundPage />;

  const go = (next: StatusTab, nextService?: ServiceFilter) =>
    setParams(next === "status" ? {} : { tab: next, ...(nextService && nextService !== "all" ? { service: nextService } : {}) });

  return (
    <div className="mx-auto flex w-full max-w-[65rem] flex-col gap-4">
      <Tabs value={tab} onValueChange={(value) => go(parseTab(value, isOwner))} className="gap-4">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="flex flex-col gap-1.5">
            {/* サイドバーを出さない画面なので、サーバー一覧へ戻る導線を置く。 */}
            <Link to="/" className="text-muted-foreground hover:text-foreground -ml-1 flex w-fit items-center gap-0.5 text-sm">
              <ChevronLeft className="size-4" aria-hidden="true" />
              サーバー一覧へ戻る
            </Link>
            <h1 className="text-2xl font-bold">ステータス</h1>
            <p className="text-muted-foreground text-sm">
              Bot全体の各機能の稼働状況です。
              {overview.data && `最終更新: ${formatDateTime(overview.data.checkedAt)}(30秒ごとに自動更新)`}
            </p>
          </div>
          <TabsList
            aria-label="ステータスの表示"
            className={cn("grid w-full md:inline-flex md:w-fit", isOwner ? "grid-cols-3" : "grid-cols-2")}
          >
            <TabsTrigger value="status">ステータス</TabsTrigger>
            <TabsTrigger value="logs">ログ</TabsTrigger>
            {isOwner && <TabsTrigger value="access">閲覧権限</TabsTrigger>}
          </TabsList>
        </div>

        <TabsContent value="status" className="flex flex-col gap-4">
          {overview.data ? (
            <>
              <section className={cn("flex items-center gap-3 rounded-xl border px-5 py-4", STATE_META[overview.data.summary].box)}>
                <span className={cn("size-3 shrink-0 rounded-full", STATE_META[overview.data.summary].dot)} aria-hidden="true" />
                <span className="font-bold">{STATE_META[overview.data.summary].summary}</span>
              </section>
              <div className="grid gap-4 lg:grid-cols-2">
                <StatusGroup title="基盤" items={overview.data.items.filter((i) => ITEM_META[i.key].group === "infra")} onOpenLogs={(s) => go("logs", s)} />
                <StatusGroup title="機能" items={overview.data.items.filter((i) => ITEM_META[i.key].group === "feature")} />
              </div>
            </>
          ) : overview.isError ? (
            <Alert variant="destructive">
              <AlertDescription>ステータスの取得に失敗しました。</AlertDescription>
            </Alert>
          ) : (
            <Loading />
          )}
        </TabsContent>

        <TabsContent value="logs" className="flex flex-col gap-3">
          <LogsTab service={service} onServiceChange={(s) => go("logs", s)} />
        </TabsContent>

        {isOwner && (
          <TabsContent value="access">
            <AccessTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function StatusGroup({
  title,
  items,
  onOpenLogs,
}: {
  title: string;
  items: StatusItem[];
  onOpenLogs?: (service: InfraLogService) => void;
}) {
  return (
    <section className="bg-card overflow-hidden rounded-xl border">
      <h2 className="text-muted-foreground border-b px-4 py-3 text-sm font-bold">{title}</h2>
      <ul>
        {items.map((item) => {
          const meta = ITEM_META[item.key];
          const state = STATE_META[item.state];
          const body = (
            <>
              <span className={cn("size-2.5 shrink-0 rounded-full", state.dot)} aria-hidden="true" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium">{meta.name}</span>
                <span className="text-muted-foreground text-xs">{describeItem(item)}</span>
              </span>
              <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap", state.badge)}>{state.label}</span>
            </>
          );
          const logService = meta.logService;
          return (
            <li key={item.key} className="border-t first:border-t-0">
              {onOpenLogs && logService ? (
                <button
                  type="button"
                  onClick={() => onOpenLogs(logService)}
                  aria-label={`${meta.name}のログを見る`}
                  className="hover:bg-accent flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  {body}
                  <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                </button>
              ) : (
                <div className="flex items-center gap-3 px-4 py-3">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const timeFormat = new Intl.DateTimeFormat("ja-JP", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function LogsTab({ service, onServiceChange }: { service: ServiceFilter; onServiceChange: (service: ServiceFilter) => void }) {
  const [level, setLevel] = useState<LevelFilter>("all");
  const [search, setSearch] = useState("");
  const [live, setLive] = useState(true);
  const logs = useQuery({
    ...trpc.status.logs.queryOptions({ service: service === "all" ? undefined : service }),
    refetchInterval: live ? LOG_REFETCH_MS : false,
  });
  const entries = logs.data ? filterLogs(logs.data.entries, level, search) : [];

  return (
    <>
      <div className="grid grid-cols-2 items-center gap-2.5 md:grid-cols-[auto_minmax(0,1fr)_auto_auto] xl:grid-cols-[auto_auto_13rem_minmax(0,1fr)_auto]">
        <div
          role="radiogroup"
          aria-label="サービス"
          className="bg-muted col-span-2 grid grid-cols-3 gap-0.5 rounded-lg p-0.5 md:col-span-4 md:flex md:w-fit xl:col-span-1"
        >
          {(["all", ...INFRA_LOG_SERVICES] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={service === key}
              onClick={() => onServiceChange(key)}
              className={cn(
                "flex h-[34px] items-center justify-center gap-1.5 rounded-md px-3 text-[13px] whitespace-nowrap",
                service === key && "bg-background shadow-xs",
              )}
            >
              <span className={cn("size-2 rounded-full", key === "all" ? "bg-foreground" : SERVICE_META[key].bar)} aria-hidden="true" />
              {key === "all" ? "すべて" : SERVICE_META[key].label}
            </button>
          ))}
        </div>
        <Select value={level} onValueChange={(value) => setLevel(value === "warn" || value === "error" ? value : "all")}>
          <SelectTrigger className="bg-background w-full text-[13px] data-[size=default]:h-10 md:w-auto" aria-label="レベル">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">すべてのレベル</SelectItem>
            <SelectItem value="warn">WARN以上</SelectItem>
            <SelectItem value="error">ERRORのみ</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="search"
          aria-label="ログを検索"
          placeholder="メッセージを検索"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="bg-background h-10 text-[13px] md:text-[13px]"
        />
        <span
          role="status"
          className={cn(
            "flex h-7 items-center gap-1.5 justify-self-start rounded-full px-2.5 text-xs whitespace-nowrap xl:justify-self-end",
            live ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
          )}
        >
          <span className={cn("size-2 rounded-full", live ? "bg-success" : "bg-muted-foreground")} aria-hidden="true" />
          {live ? "ライブ表示中" : "一時停止中"}
        </span>
        <Button variant="outline" className="h-10 justify-self-end text-[13px]" onClick={() => setLive((value) => !value)}>
          {live ? "一時停止" : "再開"}
        </Button>
      </div>

      {logs.data ? (
        <>
          <section
            aria-label="ログ出力"
            className="flex max-h-[65vh] min-h-64 flex-col gap-1 overflow-y-auto rounded-xl bg-zinc-900 px-4 py-3.5 font-mono text-[12.5px] leading-relaxed text-zinc-200"
          >
            {entries.length === 0 && <p className="py-6 text-center text-zinc-400">該当するログはありません。</p>}
            {entries.map((entry, index) => (
              <div key={`${entry.at}-${index}`} className={cn("flex flex-col gap-0.5 rounded px-2 py-1.5", LEVEL_STYLE[entry.level].row)}>
                <div className="flex flex-wrap items-center gap-x-3.5 gap-y-0.5 text-xs">
                  <span className="text-zinc-400">{timeFormat.format(new Date(entry.at))}</span>
                  {service === "all" && (
                    <span className={cn("flex items-center gap-1.5 font-bold", SERVICE_META[entry.service].text)}>
                      <span className={cn("h-3 w-[3px] rounded-sm", SERVICE_META[entry.service].bar)} aria-hidden="true" />
                      {SERVICE_META[entry.service].label}
                    </span>
                  )}
                  <span className={cn("font-bold", LEVEL_STYLE[entry.level].text)}>{entry.level}</span>
                  <span className="text-zinc-400">{entry.scope}</span>
                </div>
                <div className="wrap-anywhere whitespace-pre-wrap">{entry.msg}</div>
              </div>
            ))}
          </section>
          <p className="text-muted-foreground text-xs">
            最新 {logs.data.entries.length} 件を表示しています。直近 {logs.data.retained} 件を保持し、古いログは自動で削除されます。
          </p>
        </>
      ) : logs.isError ? (
        <Alert variant="destructive">
          <AlertDescription>ログの取得に失敗しました。</AlertDescription>
        </Alert>
      ) : (
        <Loading />
      )}
    </>
  );
}

function AccessTab() {
  const queryClient = useQueryClient();
  const viewers = useQuery(trpc.status.viewers.queryOptions());
  const candidates = useQuery(trpc.status.viewerCandidates.queryOptions());
  const [selected, setSelected] = useState("");
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.status.viewers.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.status.viewerCandidates.queryKey() }),
    ]);
  const add = useMutation(
    trpc.status.addViewer.mutationOptions({
      onSuccess: async () => {
        setSelected("");
        await refresh();
        toast.success("閲覧を許可しました");
      },
      onError: () => toast.error("追加に失敗しました"),
    }),
  );
  const remove = useMutation(
    trpc.status.removeViewer.mutationOptions({
      onSuccess: async () => {
        await refresh();
        toast.success("閲覧の許可を取り消しました");
      },
      onError: () => toast.error("削除に失敗しました"),
    }),
  );

  return (
    <section className="bg-card flex w-full max-w-3xl flex-col gap-4 rounded-xl border px-5 py-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-bold">閲覧を許可するユーザー</h2>
        <p className="text-muted-foreground text-sm">
          Botオーナー(Discord Developer PortalでのBotアプリの所有者・Teamメンバー)と、ここに追加したユーザーだけがこのページを開けます。それ以外のユーザーには404を返します。
        </p>
      </div>
      <div className="grid gap-2.5 sm:flex sm:items-end">
        <label className="text-muted-foreground flex min-w-0 flex-col gap-1.5 text-sm">
          追加するユーザー
          <Select value={selected} onValueChange={setSelected} disabled={!candidates.data?.length}>
            <SelectTrigger className="bg-background w-full data-[size=default]:h-10 sm:w-80">
              <SelectValue placeholder={candidates.data?.length === 0 ? "追加できるユーザーがいません" : "ユーザーを選択"} />
            </SelectTrigger>
            <SelectContent>
              {candidates.data?.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <Button className="h-10" disabled={!selected || add.isPending} onClick={() => add.mutate({ discordUserId: selected })}>
          追加
        </Button>
      </div>
      <p className="text-muted-foreground -mt-2 text-xs">ダッシュボードにログインしたことのあるユーザーから選べます。</p>
      {viewers.data ? (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {viewers.data.owners.map((owner) => (
            <UserRow key={owner.id} name={owner.name}>
              <span className="bg-muted shrink-0 rounded-full px-2 py-0.5 text-xs whitespace-nowrap">オーナー(自動)</span>
            </UserRow>
          ))}
          {viewers.data.viewers.map((viewer) => (
            <UserRow key={viewer.id} name={viewer.name}>
              <Button
                variant="outline"
                size="sm"
                className="h-8 shrink-0"
                disabled={remove.isPending}
                onClick={() => remove.mutate({ discordUserId: viewer.id })}
              >
                削除
              </Button>
            </UserRow>
          ))}
        </ul>
      ) : viewers.isError ? (
        <Alert variant="destructive">
          <AlertDescription>閲覧権限の取得に失敗しました。</AlertDescription>
        </Alert>
      ) : (
        <Loading />
      )}
    </section>
  );
}

function UserRow({ name, children }: { name: string; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5 px-3.5 py-3 text-sm">
      <span className="bg-muted flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold" aria-hidden="true">
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {children}
    </li>
  );
}
