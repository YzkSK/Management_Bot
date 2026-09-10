import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { LogCategory } from "@management-bot/shared";
import { trpc } from "../trpc.js";
import { CATEGORY_OPTIONS, CATEGORY_ACCENT } from "./category-labels.js";
import { diffPermissions } from "./discord-permission-labels.js";
import { formatCreatedAt } from "./format-created-at.js";
import { formatLogMessage } from "./format-log-message.js";
import { summarizeLogEntry } from "./log-entry-summary.js";
import { INITIAL_PAGINATION, currentCursor, goNextPage, goPrevPage } from "./pagination.js";
import { useLogEntryNotifications } from "./use-log-entry-notifications.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PAGE_SIZE = 50;
const ALL_CATEGORIES = "__all__";

export function shouldShowRawLogPayload(hasRawAccess: boolean, details: Record<string, unknown>): boolean {
  return hasRawAccess && Object.keys(details).length > 0;
}

/** role/channel updateのchangesキーを表示用の日本語ラベルに変換する。未知キーはそのまま表示する。 */
const CHANGE_FIELD_LABELS: Record<string, string> = {
  nickname: "ニックネーム",
  name: "名前",
  color: "色",
  hoist: "表示を分離",
  mentionable: "メンション許可",
  permissions: "権限",
  topic: "トピック",
  nsfw: "年齢制限",
  rateLimitPerUser: "スロー モード",
  bitrate: "ビットレート",
  userLimit: "ユーザー上限",
  icon: "アイコン",
  banner: "バナー",
  description: "説明",
  verificationLevel: "認証レベル",
  explicitContentFilter: "不適切なコンテンツフィルター",
  defaultMessageNotifications: "デフォルトの通知設定",
  afkChannelId: "AFKチャンネル",
  afkTimeout: "AFKタイムアウト",
  systemChannelId: "システムチャンネル",
  rulesChannelId: "ルールチャンネル",
  publicUpdatesChannelId: "公開アップデートチャンネル",
  preferredLocale: "優先言語",
  widgetEnabled: "ウィジェット有効",
  widgetChannelId: "ウィジェットチャンネル",
};

/** guild updateのchangesのうち、値がチャンネルIDであるフィールド。表示名解決の対象にする。 */
const CHANNEL_REFERENCE_CHANGE_FIELDS = new Set(["afkChannelId", "systemChannelId", "rulesChannelId", "publicUpdatesChannelId", "widgetChannelId"]);

/** changesのbefore/after値を表示用文字列に変換する。nullはtopic未設定等を表すため「未設定」と表示する。チャンネルIDフィールドは解決済み名称があれば使う。 */
function formatChangeValue(field: string, value: string | number | boolean | null, channelNames: Record<string, string>): string {
  if (value === null) return "未設定";
  if (CHANNEL_REFERENCE_CHANGE_FIELDS.has(field) && typeof value === "string") return channelNames[value] ?? value;
  return String(value);
}

const CONNECTION_STATUS_LABELS = {
  connecting: "リアルタイム更新: 接続中...",
  open: "リアルタイム更新: 有効",
  reconnecting: "リアルタイム更新: 切断中(再接続を試みています)",
  stopped: "リアルタイム更新: 停止しました(画面を再読み込みしてください)",
} as const;

/** 短時間に連続した通知をまとめて1回のrefetchにし、高頻度ログでの過剰な再取得を避ける。 */
const INVALIDATE_DEBOUNCE_MS = 300;

/** formatLogMessageが参照しうる全ユーザーIDフィールド。新カテゴリ追加時はここにも追記する。 */
const USER_ID_FIELDS = ["executorId", "authorId", "userId", "targetUserId", "moderatorId"] as const;

/**
 * 各IDフィールドに対応するDiscord表示名スナップショットフィールド。スナップショットが存在すれば
 * Discord APIへの名前解決(resolveDisplayNames)を省略できる。targetUserId/moderatorIdは
 * moderationCase(#212時点で書き込み経路が未実装)のため対応するスナップショットがない。
 */
const SNAPSHOT_FIELD_BY_ID_FIELD: Partial<Record<(typeof USER_ID_FIELDS)[number], string>> = {
  executorId: "executorName",
  authorId: "authorName",
  userId: "userName",
};

export function LogListPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const [category, setCategory] = useState<LogCategory | "">("");
  const [pagination, setPagination] = useState(INITIAL_PAGINATION);
  const queryClient = useQueryClient();

  const logsQuery = useQuery({
    ...trpc.logging.listLogEntries.queryOptions({
      guildId: guildId ?? "",
      category: category === "" ? undefined : category,
      limit: PAGE_SIZE,
      cursor: currentCursor(pagination),
    }),
    enabled: Boolean(guildId),
  });

  const subjectIds = useMemo(
    () =>
      logsQuery.data
        ? Array.from(
            new Set(
              logsQuery.data.entries.flatMap(({ entry }) =>
                USER_ID_FIELDS.flatMap((key) => {
                  // スナップショットがあれば名前解決済みのため、Discord APIへの無駄な問い合わせを避ける。
                  const snapshotField = SNAPSHOT_FIELD_BY_ID_FIELD[key];
                  if (snapshotField && snapshotField in entry && entry[snapshotField as keyof typeof entry]) return [];
                  const value = entry[key as keyof typeof entry];
                  return typeof value === "string" ? [value] : [];
                }),
              ),
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
              logsQuery.data.entries.flatMap(({ entry }) => {
                const direct = Object.entries(entry).flatMap(([key, value]) =>
                  (key === "channelId" || key === "previousChannelId" || key === "threadId") && typeof value === "string"
                    ? [value]
                    : [],
                );
                const changes = "changes" in entry && entry.changes ? entry.changes : {};
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
    if (pagination.pageIndex !== 0) return;
    if (category !== "" && category !== notifiedCategory) return;
    if (invalidateTimerRef.current) return; // 連続通知は1回のrefetchにまとめる
    invalidateTimerRef.current = setTimeout(() => {
      invalidateTimerRef.current = null;
      void queryClient.invalidateQueries({
        queryKey: trpc.logging.listLogEntries.queryOptions({
          guildId: guildId ?? "",
          category: category === "" ? undefined : category,
          limit: PAGE_SIZE,
          cursor: undefined,
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
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">ログ一覧</h1>
        <Button asChild variant="outline">
          <Link to={`/guilds/${guildId}/logs/settings`}>設定</Link>
        </Button>
      </div>

      <p
        className={
          connectionStatus === "open" ? "text-muted-foreground text-xs" : "text-destructive text-xs"
        }
      >
        {CONNECTION_STATUS_LABELS[connectionStatus]}
      </p>

      <Select
        value={category === "" ? ALL_CATEGORIES : category}
        onValueChange={(value) => {
          setCategory(value === ALL_CATEGORIES ? "" : (value as LogCategory));
          setPagination(INITIAL_PAGINATION);
        }}
      >
        <SelectTrigger className="w-48" aria-label="ログのカテゴリ">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_CATEGORIES}>すべて</SelectItem>
          {CATEGORY_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {logsQuery.isPending && <div className="text-sm">読み込み中...</div>}
      {isForbidden && (
        <Alert variant="destructive">
          <AlertDescription>この操作を行う権限がありません。</AlertDescription>
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
            <p className="text-muted-foreground text-sm">該当するログはありません。</p>
          ) : (
            <div className="flex flex-col gap-2">
              {logsQuery.data.entries.map(({ id, entry }) => {
                const summary = summarizeLogEntry(entry);
                const names = { users: namesQuery.data?.users ?? {}, channels: namesQuery.data?.channels ?? {} };
                const message = formatLogMessage(entry, summary, names);
                const isExpanded = expandedIds.has(id);
                const detailId = `log-detail-${id}`;

                return (
                  <div key={id} className="rounded-lg border">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(id)}
                      aria-expanded={isExpanded}
                      aria-controls={detailId}
                      className="flex w-full items-center gap-3 p-3 text-left hover:bg-accent/50"
                    >
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: CATEGORY_ACCENT[entry.category] }}
                        aria-hidden="true"
                      />
                      <span className="flex-1 text-sm">{message}</span>
                      <time dateTime={summary.createdAt} className="text-muted-foreground shrink-0 text-xs">
                        {formatCreatedAt(summary.createdAt)}
                      </time>
                    </button>

                    {isExpanded && (
                      <div id={detailId} className="flex flex-col gap-3 border-t bg-muted/40 p-3">
                        {(summary.content !== null || summary.previousContent !== null) && (
                          <div className="rounded-md border bg-card p-3">
                            {summary.previousContent !== null && (
                              <p className="mb-1 text-sm whitespace-pre-wrap text-muted-foreground">
                                <span className="mr-2 text-xs">編集前</span>
                                <del>{summary.previousContent || "(本文なし)"}</del>
                              </p>
                            )}
                            {summary.content && (
                              <p className="text-sm whitespace-pre-wrap">
                                {summary.previousContent !== null && (
                                  <span className="text-muted-foreground mr-2 text-xs">編集後</span>
                                )}
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
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pagination.pageIndex === 0}
              onClick={() => setPagination(goPrevPage(pagination))}
            >
              前へ
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={logsQuery.data.nextCursor === null}
              onClick={() => setPagination(goNextPage(pagination, logsQuery.data.nextCursor))}
            >
              次へ
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
