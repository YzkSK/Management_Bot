import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CAPABILITIES, hasCapability, type LogCategory, type LogEntry, type MessageAttachment } from "@management-bot/shared";
import {
  appEmojiNameFor,
  CHANGE_FIELD_LABELS,
  CHANNEL_REFERENCE_CHANGE_FIELDS,
  diffPermissions,
  formatChangeValue,
  formatLogMessage,
  isBulkDeleteLogEntry,
  summarizeLogEntry,
} from "@management-bot/shared";
import { useGuildCapabilities } from "../guild-pages.js";
import { trpc } from "../trpc.js";
import { ChevronLeft, ChevronRight, Lock, Settings } from "lucide-react";
import { CATEGORY_ACCENT, CATEGORY_ICON, CATEGORY_LABELS } from "./category-labels.js";
import { CategoryFilter } from "./CategoryFilter.js";
import { formatCreatedAt } from "./format-created-at.js";
import { visiblePages } from "./pagination.js";
import { useLogEntryNotifications } from "./use-log-entry-notifications.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Loading, Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

/**
 * Discordログと同じアプリ絵文字画像(assets/emojis)と、そのライトモード向け黒版(assets/emojis-light、
 * scripts/make-light-emojis.ps1で生成)。Viteがビルド時にURLへ解決する。import.meta.globはVite専用で
 * 呼び出し式のみ変換されるため、bun test実行時は例外を握りつぶして空にしドット表示へフォールバックさせる。
 */
const EMOJI_URLS: Record<string, string> = (() => {
  try {
    return import.meta.glob<string>("../../../../assets/{emojis,emojis-light}/*.png", { eager: true, import: "default", query: "?url" });
  } catch {
    return {};
  }
})();

function emojiUrlFor(entry: LogEntry, dir: "emojis" | "emojis-light"): string | undefined {
  return EMOJI_URLS[`../../../../assets/${dir}/${appEmojiNameFor(entry)}.png`];
}

/** ログ種別アイコン。画像が無い種別はカテゴリのアイコンにフォールバックする。 */
function LogIcon({ entry }: { entry: LogEntry }) {
  const url = emojiUrlFor(entry, "emojis");
  if (url) {
    return (
      <>
        <img src={emojiUrlFor(entry, "emojis-light") ?? url} alt="" className="size-5 shrink-0 dark:hidden" />
        <img src={url} alt="" className="hidden size-5 shrink-0 dark:block" />
      </>
    );
  }
  const Icon = CATEGORY_ICON[entry.category];
  return <Icon className="size-5 shrink-0" style={{ color: CATEGORY_ACCENT[entry.category] }} aria-hidden="true" />;
}

export function shouldShowRawLogPayload(hasRawAccess: boolean, details: Record<string, unknown>): boolean {
  return hasRawAccess && Object.keys(details).length > 0;
}

const CONNECTION_STATUS_LABELS = {
  connecting: "リアルタイム更新: 接続中...",
  open: "リアルタイム更新: 有効",
  reconnecting: "リアルタイム更新: 切断中(再接続を試みています)",
  stopped: "リアルタイム更新: 停止しました(画面を再読み込みしてください)",
} as const;

/** 接続状態バッジの色(正常=緑、再接続中=黄、停止=赤、接続中=グレー)。 */
const CONNECTION_STATUS_TONES = {
  connecting: "bg-muted text-muted-foreground [&>span]:bg-muted-foreground",
  open: "bg-success/10 text-success [&>span]:bg-success",
  reconnecting: "bg-warning/10 text-warning [&>span]:bg-warning",
  stopped: "bg-destructive/10 text-destructive [&>span]:bg-destructive",
} as const;

/** 短時間に連続した通知をまとめて1回のrefetchにし、高頻度ログでの過剰な再取得を避ける。 */
const INVALIDATE_DEBOUNCE_MS = 300;

/** formatLogMessageが参照しうる全ユーザーIDフィールド。新カテゴリ追加時はここにも追記する。 */
const USER_ID_FIELDS = [
  "executorId",
  "authorId",
  "userId",
  "targetUserId",
  "moderatorId",
  "ownerId",
  "previousOwnerId",
  "newOwnerId",
] as const;

/**
 * 各IDフィールドに対応するDiscord表示名スナップショットフィールド。スナップショットが存在すれば
 * Discord APIへの名前解決(resolveDisplayNames)を省略できる。targetUserId/moderatorIdは
 * moderationCase(#212時点で書き込み経路が未実装)のため対応するスナップショットがない。
 */
const SNAPSHOT_FIELD_BY_ID_FIELD: Partial<Record<(typeof USER_ID_FIELDS)[number], string>> = {
  executorId: "executorName",
  authorId: "authorName",
  userId: "userName",
  ownerId: "ownerName",
  previousOwnerId: "previousOwnerName",
  newOwnerId: "newOwnerName",
};

/**
 * tempVoiceのtargetId(memberPermissionChanged)はuser/role両対応で、roleの場合はDiscordの
 * ユーザー表示名解決対象に含めるべきではない(codexレビュー指摘)。targetType==="user"の
 * 場合のみ収集する。スナップショット(targetName)がある場合はDiscord APIへの問い合わせを省略する。
 */
function collectTempVoiceUserTargetId(entry: LogEntry): string | undefined {
  if (entry.category !== "tempVoice" || entry.action !== "memberPermissionChanged") return undefined;
  if (entry.targetType !== "user") return undefined;
  return entry.targetName ? undefined : entry.targetId;
}

type ListedLogEntry = { id: string; entry: LogEntry; collapsedEntries?: ListedLogEntry[] };

function flattenLogEntries(entries: readonly ListedLogEntry[]): LogEntry[] {
  return entries.flatMap(({ entry, collapsedEntries }) => [entry, ...flattenLogEntries(collapsedEntries ?? [])]);
}

// 名前解決中のIDを見出し文字列内で目印付けするための私用領域文字(ログ本文に現れない前提)
const PENDING_START = "";
const PENDING_END = "";

/** 名前解決中は、未解決IDの表示名を目印付きの文字列にしておき、描画時にスケルトンへ置き換える。 */
function pendingNames(ids: readonly string[]): Record<string, string> {
  return Object.fromEntries(ids.map((id) => [id, `${PENDING_START}${id}${PENDING_END}`]));
}

/** 目印付きの部分だけをスケルトンにする。失敗・未解決時は目印が無いのでIDがそのまま表示される。 */
function withNameSkeletons(message: string): ReactNode {
  if (!message.includes(PENDING_START)) return message;
  return message
    .split(new RegExp(`(${PENDING_START}[^${PENDING_END}]*${PENDING_END})`))
    .map((part, i) =>
      part.startsWith(PENDING_START) ? (
        <Skeleton key={i} className="inline-block h-4 w-20 align-middle" aria-label="名前を読み込み中" />
      ) : (
        part
      ),
    );
}

/**
 * 画像は<img>、Tenor等のGIF(gifv、実体はmp4)は自動ループ再生、通常の動画はコントロール付きで手動再生にする(#528)。
 * ネタバレ指定(SPOILER_)はDiscordと同様にぼかして伏せ、クリックで解除する(解除前は動画を再生しない)。
 */
function AttachmentPreview({ attachment }: { attachment: MessageAttachment }) {
  const [revealed, setRevealed] = useState(false);
  const isImage = attachment.contentType?.startsWith("image/") ?? false;
  const isVideo = attachment.contentType?.startsWith("video/") ?? false;
  if (!isImage && !isVideo) {
    return (
      <a href={attachment.url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
        {attachment.filename}
      </a>
    );
  }
  const hidden = attachment.filename.startsWith("SPOILER_") && !revealed;
  const className = cn("rounded-md border object-cover", isVideo && !attachment.gifv ? "h-40 w-64" : "h-24 w-24", hidden && "blur-xl");
  const media = !isVideo ? (
    <img src={attachment.url} alt={attachment.filename} className={className} />
  ) : attachment.gifv ? (
    // 読込済みのvideoにautoPlayを後から付けても再生は始まらないため、ネタバレ解除時はkeyで再マウントする。
    <video key={String(hidden)} src={attachment.url} aria-label={attachment.filename} className={className} autoPlay={!hidden} loop muted playsInline />
  ) : (
    <video src={attachment.url} aria-label={attachment.filename} className={className} controls={!hidden} preload="metadata" />
  );
  return (
    <div className="relative overflow-hidden rounded-md">
      {isVideo && !attachment.gifv ? (
        media
      ) : (
        <a href={attachment.url} target="_blank" rel="noreferrer">
          {media}
        </a>
      )}
      {hidden && (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs font-semibold text-white"
        >
          ネタバレ
        </button>
      )}
    </div>
  );
}

export function LogListPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const capabilities = useGuildCapabilities(guildId);
  const canManageSettings = capabilities !== undefined && hasCapability(capabilities, CAPABILITIES.MANAGE_LOGGING_SETTINGS);
  const [categories, setCategories] = useState<LogCategory[]>([]);
  const [page, setPage] = useState(0);
  const queryClient = useQueryClient();

  const logsQuery = useQuery({
    ...trpc.logging.listLogEntries.queryOptions({
      guildId: guildId ?? "",
      categories: categories.length === 0 ? undefined : categories,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    enabled: Boolean(guildId),
  });
  const totalPages = Math.ceil((logsQuery.data?.totalCount ?? 0) / PAGE_SIZE);
  // 保持期間による削除などで総件数が減り、表示中のページが範囲外になった場合は最終ページへ寄せる。
  useEffect(() => {
    if (logsQuery.data && page > 0 && page >= totalPages) setPage(Math.max(totalPages - 1, 0));
  }, [logsQuery.data, page, totalPages]);

  const subjectIds = useMemo(
    () =>
      logsQuery.data
        ? Array.from(
            new Set(
              flattenLogEntries(logsQuery.data.entries).flatMap((visibleEntry) => [
                ...USER_ID_FIELDS.flatMap((key) => {
                  // スナップショットがあれば名前解決済みのため、Discord APIへの無駄な問い合わせを避ける。
                  const snapshotField = SNAPSHOT_FIELD_BY_ID_FIELD[key];
                  if (snapshotField && snapshotField in visibleEntry && visibleEntry[snapshotField as keyof typeof visibleEntry]) return [];
                  const value = visibleEntry[key as keyof typeof visibleEntry];
                  return typeof value === "string" ? [value] : [];
                }),
                ...(() => {
                  const targetId = collectTempVoiceUserTargetId(visibleEntry);
                  return targetId ? [targetId] : [];
                })(),
              ]),
            ),
          ).sort() // tRPCクエリのキャッシュキーを安定させるため、収集順ではなく辞書順に揃える
        : [],
    [logsQuery.data],
  );

  const channelIds = useMemo(
    () =>
      logsQuery.data
        ? Array.from(
            new Set(
              flattenLogEntries(logsQuery.data.entries).flatMap((visibleEntry) => {
                const direct = Object.entries(visibleEntry).flatMap(([key, value]) =>
                  (key === "channelId" || key === "previousChannelId" || key === "threadId") && typeof value === "string"
                    ? [value]
                    : [],
                );
                const changes = "changes" in visibleEntry && visibleEntry.changes ? visibleEntry.changes : {};
                const fromChanges = Object.entries(changes).flatMap(([field, change]) =>
                  CHANNEL_REFERENCE_CHANGE_FIELDS.has(field)
                    ? [change.before, change.after].filter((v): v is string => typeof v === "string")
                    : [],
                );
                return [...direct, ...fromChanges];
              }),
            ),
          ).sort() // tRPCクエリのキャッシュキーを安定させるため、収集順ではなく辞書順に揃える
        : [],
    [logsQuery.data],
  );

  const namesQuery = useQuery({
    ...trpc.logging.resolveDisplayNames.queryOptions({
      guildId: guildId ?? "",
      userIds: subjectIds,
      channelIds,
    }),
    enabled: Boolean(guildId) && (subjectIds.length > 0 || channelIds.length > 0),
  });

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const invalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectionStatus = useLogEntryNotifications(guildId ?? "", (notifiedCategory) => {
    // 過去ページを閲覧中は表示中の内容を壊さないよう、最新ページ(先頭)表示中のみ自動更新する。
    if (page !== 0) return;
    if (categories.length > 0 && !categories.some((c) => c === notifiedCategory)) return;
    if (invalidateTimerRef.current) return; // 連続通知は1回のrefetchにまとめる
    invalidateTimerRef.current = setTimeout(() => {
      invalidateTimerRef.current = null;
      void queryClient.invalidateQueries({
        queryKey: trpc.logging.listLogEntries.queryOptions({
          guildId: guildId ?? "",
          categories: categories.length === 0 ? undefined : categories,
          limit: PAGE_SIZE,
          offset: 0,
        }).queryKey,
      });
    }, INVALIDATE_DEBOUNCE_MS);
  });

  if (!guildId) {
    return (
      <Alert variant="destructive">
        <AlertDescription>サーバーが指定されていません。</AlertDescription>
      </Alert>
    );
  }

  const isForbidden = logsQuery.error instanceof TRPCClientError && logsQuery.error.data?.code === "FORBIDDEN";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">ログ一覧</h1>
          <p
            role="status"
            className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs", CONNECTION_STATUS_TONES[connectionStatus])}
          >
            <span className="size-2 shrink-0 rounded-full" aria-hidden="true" />
            {CONNECTION_STATUS_LABELS[connectionStatus]}
          </p>
        </div>
        {canManageSettings && (
          <Button asChild variant="outline">
            <Link to={`/guilds/${guildId}/logs/settings`}>
              <Settings aria-hidden="true" />
              ログ設定
            </Link>
          </Button>
        )}
      </div>

      <CategoryFilter
        selected={categories}
        onChange={(next) => {
          setCategories(next);
          setPage(0);
        }}
      />

      {logsQuery.isPending && <Loading />}
      {isForbidden && (
        <Alert variant="warning">
          <Lock />
          <AlertDescription>この操作を行う権限がありません。ログの閲覧には「ログの閲覧」権限が必要です。</AlertDescription>
        </Alert>
      )}
      {logsQuery.isError && !isForbidden && (
        <Alert variant="destructive">
          <AlertDescription>ログの取得に失敗しました。時間をおいて再度お試しください。</AlertDescription>
        </Alert>
      )}

      {logsQuery.data && (
        <>
          {logsQuery.data.entries.length === 0 ? (
            <p className="text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">該当するログはありません。</p>
          ) : (
            <div className="bg-card flex flex-col overflow-hidden rounded-xl border">
              {logsQuery.data.entries.map(({ id, entry, collapsedEntries }) => {
                const summary = summarizeLogEntry(entry);
                const names = namesQuery.isLoading
                  ? { users: pendingNames(subjectIds), channels: pendingNames(channelIds) }
                  : { users: namesQuery.data?.users ?? {}, channels: namesQuery.data?.channels ?? {} };
                const message = formatLogMessage(entry, summary, names);
                const isExpanded = expandedIds.has(id);
                const detailId = `log-detail-${id}`;
                const collapsedDetailId = `collapsed-log-detail-${id}`;
                const isCollapsedExpanded = expandedIds.has(`collapsed-${id}`);

                return (
                  <div key={id} className="border-t first:border-t-0">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(id)}
                      aria-expanded={isExpanded}
                      aria-controls={detailId}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/50 sm:px-4"
                    >
                      <span
                        className="h-7 w-1 shrink-0 rounded-full"
                        style={{ backgroundColor: CATEGORY_ACCENT[entry.category] }}
                        aria-hidden="true"
                      />
                      <LogIcon entry={entry} />
                      <span className="flex min-w-0 flex-1 flex-col-reverse gap-0.5 sm:flex-row sm:items-center sm:gap-3">
                        <span className="flex shrink-0 items-center gap-2 text-xs sm:gap-3">
                          <time dateTime={summary.createdAt} className="text-muted-foreground sm:order-first sm:w-36">
                            {formatCreatedAt(summary.createdAt)}
                          </time>
                          <span
                            className="order-first font-medium sm:order-none sm:w-28"
                            style={{ color: CATEGORY_ACCENT[entry.category] }}
                          >
                            {CATEGORY_LABELS[entry.category]}
                          </span>
                        </span>
                        <span className="min-w-0 flex-1 text-sm">{withNameSkeletons(message)}</span>
                      </span>
                    </button>

                    {isExpanded && (
                      <div id={detailId} className="flex flex-col gap-3 border-t bg-muted/40 p-3">
                        {isBulkDeleteLogEntry(entry) && (
                          <section aria-label="削除されたメッセージ" className="flex flex-col gap-2 rounded-md border bg-card p-3">
                            <h2 className="text-sm font-semibold">削除されたメッセージ（{entry.deletedMessages.length}件）</h2>
                            {entry.deletedMessages.map((deletedMessage, index) => (
                              <article
                                key={deletedMessage.messageId ?? `${deletedMessage.authorId}-${index}`}
                                className="flex flex-col gap-2 rounded-md border p-3"
                              >
                                <p className="text-sm font-medium">{deletedMessage.authorName ?? deletedMessage.authorId}</p>
                                <p className="text-sm whitespace-pre-wrap">{deletedMessage.content || "本文なし"}</p>
                                <p className="text-muted-foreground font-mono text-xs">
                                  メッセージ ID: {deletedMessage.messageId ?? "取得不可"}
                                </p>
                                {deletedMessage.attachments && deletedMessage.attachments.length > 0 && (
                                  <div className="flex flex-wrap gap-2">
                                    {deletedMessage.attachments.map((attachment) => (
                                      <AttachmentPreview key={attachment.url} attachment={attachment} />
                                    ))}
                                  </div>
                                )}
                              </article>
                            ))}
                          </section>
                        )}
                        {(summary.content !== null || summary.previousContent !== null) && (
                          <div className="grid gap-2 md:grid-cols-2">
                            {summary.previousContent !== null && (
                              <p className="bg-destructive/10 flex flex-col gap-1 rounded-md p-3 text-sm whitespace-pre-wrap">
                                <span className="text-destructive text-xs">編集前</span>
                                <del>{summary.previousContent || "(本文なし)"}</del>
                              </p>
                            )}
                            {summary.content && (
                              <p
                                className={cn(
                                  "flex flex-col gap-1 rounded-md p-3 text-sm whitespace-pre-wrap",
                                  summary.previousContent !== null ? "bg-success/10" : "bg-card border md:col-span-2",
                                )}
                              >
                                {summary.previousContent !== null && <span className="text-success text-xs">編集後</span>}
                                {summary.content}
                              </p>
                            )}
                          </div>
                        )}

                        {summary.changes !== null && entry.category !== "voice" && (
                          <div className="flex flex-col gap-2 rounded-md border bg-card p-3">
                            {Object.entries(summary.changes).map(([field, change]) => {
                              const permissionsDiff =
                                field === "permissions" && typeof change.before === "string" && typeof change.after === "string"
                                  ? diffPermissions(change.before, change.after)
                                  : null;
                              if (permissionsDiff) {
                                const { added, removed } = permissionsDiff;
                                return (
                                  <div key={field} className="text-sm">
                                    <span className="text-muted-foreground mr-2 text-xs">
                                      {CHANGE_FIELD_LABELS[field] ?? field}
                                    </span>
                                    {added.length === 0 && removed.length === 0 && (
                                      <span className="text-muted-foreground">変更なし</span>
                                    )}
                                    {added.map((name) => (
                                      <span key={`added-${name}`} className="mr-2 text-green-600 dark:text-green-500">
                                        +{name}
                                      </span>
                                    ))}
                                    {removed.map((name) => (
                                      <del key={`removed-${name}`} className="text-muted-foreground mr-2">
                                        {name}
                                      </del>
                                    ))}
                                  </div>
                                );
                              }
                              return (
                                <div key={field} className="text-sm">
                                  <span className="text-muted-foreground mr-2 text-xs">
                                    {CHANGE_FIELD_LABELS[field] ?? field}
                                  </span>
                                  <del className="text-muted-foreground">{formatChangeValue(field, change.before, names.channels)}</del>
                                  <span className="mx-1">→</span>
                                  <span>{formatChangeValue(field, change.after, names.channels)}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {summary.attachments !== null && summary.attachments.length > 0 && (
                          <div className="flex flex-wrap gap-2 rounded-md border bg-card p-3">
                            {summary.attachments.map((attachment) => (
                              <AttachmentPreview key={attachment.url} attachment={attachment} />
                            ))}
                          </div>
                        )}

                        <div className="grid grid-cols-3 gap-3 text-xs">
                          {summary.executorId !== null && (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-muted-foreground font-semibold tracking-wide uppercase">
                                実行者ID
                              </span>
                              <span className="font-mono">{summary.executorId}</span>
                            </div>
                          )}
                          {summary.categorySubjectId !== null && (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-muted-foreground font-semibold tracking-wide uppercase">
                                対象ユーザーID
                              </span>
                              <span className="font-mono">{summary.categorySubjectId}</span>
                            </div>
                          )}
                          <div className="flex flex-col gap-0.5">
                            <span className="text-muted-foreground font-semibold tracking-wide uppercase">
                              ログID
                            </span>
                            <span className="font-mono">{id}</span>
                          </div>
                        </div>

                        {shouldShowRawLogPayload(logsQuery.data.hasRawAccess, summary.details) && (
                          <details>
                            <summary className="text-muted-foreground cursor-pointer text-xs">生データ</summary>
                            <pre className="text-muted-foreground mt-1 text-xs overflow-x-auto">{JSON.stringify(summary.details, null, 2)}</pre>
                          </details>
                        )}
                      </div>
                    )}

                    {collapsedEntries && (
                      <>
                        <button
                          type="button"
                          onClick={() => toggleExpanded(`collapsed-${id}`)}
                          aria-expanded={isCollapsedExpanded}
                          aria-controls={collapsedDetailId}
                          className="flex w-full items-center gap-3 border-t px-3 py-2 text-left hover:bg-accent/50"
                        >
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: CATEGORY_ACCENT.message }}
                            aria-hidden="true"
                          />
                          <span className="flex-1 text-sm">
                            {entry.category === "moderationCase" ? "関連する削除ログ" : "削除された投稿ログ"}（{collapsedEntries.length}件）
                          </span>
                        </button>
                        {isCollapsedExpanded && (
                          <div id={collapsedDetailId} className="flex flex-col gap-2 border-t bg-muted/40 p-3">
                            {collapsedEntries.map(({ id: collapsedId, entry: collapsedEntry, collapsedEntries: nestedEntries }) => {
                              const collapsedSummary = summarizeLogEntry(collapsedEntry);
                              const collapsedMessage = formatLogMessage(collapsedEntry, collapsedSummary, names);
                              return (
                                <article key={collapsedId} className="flex flex-col gap-2 rounded-md border bg-card p-3">
                                  <p className="text-sm">{collapsedMessage}</p>
                                  {collapsedSummary.content !== null && (
                                    <p className="text-sm whitespace-pre-wrap">{collapsedSummary.content || "本文なし"}</p>
                                  )}
                                  {collapsedSummary.attachments !== null && collapsedSummary.attachments.length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                      {collapsedSummary.attachments.map((attachment) => (
                                        <AttachmentPreview key={attachment.url} attachment={attachment} />
                                      ))}
                                    </div>
                                  )}
                                  {nestedEntries && nestedEntries.length > 0 && (
                                    <details className="rounded-md border bg-muted/40 p-2">
                                      <summary className="cursor-pointer text-sm">
                                        削除された投稿ログ（{nestedEntries.length}件）
                                      </summary>
                                      <div className="mt-2 flex flex-col gap-2">
                                        {nestedEntries.map(({ id: nestedId, entry: nestedEntry }) => {
                                          const nestedSummary = summarizeLogEntry(nestedEntry);
                                          return (
                                            <article key={nestedId} className="rounded-md border bg-card p-2">
                                              <p className="text-sm">{formatLogMessage(nestedEntry, nestedSummary, names)}</p>
                                              {nestedSummary.content !== null && (
                                                <p className="mt-1 text-sm whitespace-pre-wrap">
                                                  {nestedSummary.content || "本文なし"}
                                                </p>
                                              )}
                                            </article>
                                          );
                                        })}
                                      </div>
                                    </details>
                                  )}
                                </article>
                              );
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {totalPages > 1 && (
            <nav aria-label="ページ" className="flex justify-center gap-2">
              <Button type="button" variant="outline" size="icon" aria-label="前のページ" disabled={page === 0} onClick={() => setPage(page - 1)}>
                <ChevronLeft />
              </Button>
              {visiblePages(page, totalPages).map((p) => (
                <Button
                  key={p}
                  type="button"
                  variant={p === page ? "default" : "outline"}
                  size="icon"
                  aria-current={p === page ? "page" : undefined}
                  onClick={() => setPage(p)}
                >
                  {p + 1}
                </Button>
              ))}
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="次のページ"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight />
              </Button>
            </nav>
          )}
          <p className="text-muted-foreground text-center text-sm">
            {page + 1} / {Math.max(totalPages, 1)} ページ(全{logsQuery.data.totalCount}件)
          </p>
        </>
      )}
    </div>
  );
}
