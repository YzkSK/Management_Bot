# ログ画面フィードUI刷新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dashboardのログ一覧(`LogListPage.tsx`)をテーブル表示から、カテゴリ×actionごとの自然文見出し+クリック展開式の詳細パネルを持つフィード表示に刷新する。カテゴリフィルタは既存のSelectのまま維持する。

**Architecture:** 既存の`summarizeLogEntry`(カテゴリ横断の共通形式への変換)はそのまま再利用し、その出力を受けて日本語の自然文ラベルを組み立てる新関数`formatLogMessage`を追加する。`LogListPage.tsx`のテーブル(`<Table>`)をカード型フィード(`<div>`のリスト)に置き換え、各カードはクリックで開閉するdetails領域を持つ。チャンネル名表示のため、`resolveDisplayNames`呼び出しに`channelIds`を渡すよう修正する(バックエンドは既にchannelIds対応済み、フロントが`[]`固定だった)。

**Tech Stack:** React 19, TanStack Query, tRPC client, Tailwind CSS v4 (shadcn/ui, OKLCHトークン), bun test

**Spec:** デザイン合意(Artifact): https://claude.ai/code/artifact/41b5f970-35a0-4b40-b2ea-df476e34babd / GitHub Issue #101

## Global Constraints

- TypeScript strictモード、`any`禁止。外部境界(tRPC入出力)は`unknown`として扱いzodで検証済みの型のみ使う(今回tRPC出力は既存の`LogEntry`型をそのまま使うので新規zodスキーマ追加は不要)。
- テストファイルは実装ファイルとコロケーション配置(`*.test.ts`/`*.test.tsx`)、`bun test`ベース。
- 削除ログ(action=delete/bulkDelete)では「Discordで開く」「リンクをコピー」等、到達不能なリンク操作は出さない。
- Dashboard UI変更後は手動での画面動作確認も行う(CLAUDE.md方針)。

---

### Task 1: 自然文ログメッセージ生成関数を追加する

**Files:**
- Create: `apps/dashboard-web/src/pages/format-log-message.ts`
- Test: `apps/dashboard-web/src/pages/format-log-message.test.ts`

**Interfaces:**
- Consumes: `LogEntry`(`@management-bot/shared`)、`LogEntrySummary`(`./log-entry-summary.js`の`summarizeLogEntry`が返す型)
- Produces: `formatLogMessage(entry: LogEntry, summary: LogEntrySummary, names: { users: Record<string, string>; channels: Record<string, string> }): string` — 一覧カードの見出しに使う1行の日本語文。後続タスク(Task 2)がこの関数をimportして使う。

**実装方針:**

`entry.category`と`entry.action`(型がある場合)の組み合わせで文言を出し分ける。名前解決できたIDは`names.users[id]`/`names.channels[id]`、できなければID文字列にフォールバックする(既存の`namesQuery.data?.users[id] ?? id`と同じフォールバック方針)。対応外の組み合わせ(将来カテゴリ追加時など)は`"{action}: {category}"`のような汎用フォールバックを返す。

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// apps/dashboard-web/src/pages/format-log-message.test.ts
import { describe, expect, test } from "bun:test";
import { formatLogMessage } from "./format-log-message.js";
import { summarizeLogEntry } from "./log-entry-summary.js";
import type { LogEntry } from "@management-bot/shared";

const noNames = { users: {}, channels: {} };

describe("formatLogMessage", () => {
  test("メッセージ削除(自分で削除): 実行者=投稿者", () => {
    const entry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      channelId: "c1",
      authorId: "u1",
      action: "delete",
      content: "ああああ",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, {
      users: { u1: "Yuzuki" },
      channels: { c1: "ログ-推奨" },
    });

    expect(message).toBe("Yuzuki が自分のメッセージを削除しました");
  });

  test("メッセージ削除(第三者が削除): 実行者=モデレーター", () => {
    const entry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      channelId: "c1",
      authorId: "u1",
      executorId: "mod1",
      action: "delete",
      content: "spam",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, {
      users: { u1: "Yuzuki", mod1: "Admin" },
      channels: {},
    });

    expect(message).toBe("Admin が Yuzuki のメッセージを削除しました");
  });

  test("メッセージ投稿", () => {
    const entry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      channelId: "c1",
      authorId: "u1",
      action: "create",
      content: "こんにちは",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { u1: "Yuzuki" }, channels: {} });

    expect(message).toBe("Yuzuki がメッセージを投稿しました");
  });

  test("メッセージ編集", () => {
    const entry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      channelId: "c1",
      authorId: "u1",
      action: "update",
      content: "編集後",
      previousContent: "編集前",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { u1: "Yuzuki" }, channels: {} });

    expect(message).toBe("Yuzuki がメッセージを編集しました");
  });

  test("ボイス移動: from/toのチャンネル名を含む", () => {
    const entry = {
      category: "voice",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      userId: "u1",
      channelId: "c2",
      previousChannelId: "c1",
      action: "move",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, {
      users: { u1: "Sora" },
      channels: { c1: "雑談", c2: "ゲーム部屋" },
    });

    expect(message).toBe("Sora が #雑談 から #ゲーム部屋 に移動しました");
  });

  test("ボイス参加", () => {
    const entry = {
      category: "voice",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      userId: "u1",
      channelId: "c1",
      action: "join",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { u1: "Sora" }, channels: { c1: "雑談" } });

    expect(message).toBe("Sora が #雑談 に参加しました");
  });

  test("ボイス退出", () => {
    const entry = {
      category: "voice",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      userId: "u1",
      channelId: "c1",
      action: "leave",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { u1: "Sora" }, channels: { c1: "雑談" } });

    expect(message).toBe("Sora が #雑談 から退出しました");
  });

  test("メンバー参加", () => {
    const entry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      userId: "u1",
      action: "join",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, { users: { u1: "Rin" }, channels: {} });

    expect(message).toBe("Rin がサーバーに参加しました");
  });

  test("メンバータイムアウト: 実行者があれば含める", () => {
    const entry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      userId: "u1",
      executorId: "mod1",
      action: "timeout",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, {
      users: { u1: "Nao", mod1: "Moderator_Bot" },
      channels: {},
    });

    expect(message).toBe("Moderator_Bot が Nao をタイムアウトしました");
  });

  test("名前解決できないIDはIDのままフォールバックする", () => {
    const entry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      userId: "u1",
      action: "leave",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, noNames);

    expect(message).toBe("u1 がサーバーから退出しました");
  });

  test("未対応の組み合わせは汎用フォールバック文言になる", () => {
    const entry = {
      category: "guild",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      action: "update",
    } as unknown as LogEntry;
    const summary = summarizeLogEntry(entry);

    const message = formatLogMessage(entry, summary, noNames);

    expect(message).toBe("サーバー設定が更新されました");
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun test apps/dashboard-web/src/pages/format-log-message.test.ts`
Expected: FAIL (`format-log-message.js` が存在しないためモジュール解決エラー)

- [ ] **Step 3: 実装する**

```typescript
// apps/dashboard-web/src/pages/format-log-message.ts
import type { LogEntry } from "@management-bot/shared";
import type { LogEntrySummary } from "./log-entry-summary.js";

interface NameResolvers {
  users: Record<string, string>;
  channels: Record<string, string>;
}

function userName(id: string, names: NameResolvers): string {
  return names.users[id] ?? id;
}

function channelName(id: string, names: NameResolvers): string {
  const name = names.channels[id];
  return name ? `#${name}` : `#${id}`;
}

/** summarizeLogEntryの出力(カテゴリ横断の共通形式)を、一覧カード見出し用の日本語1文に変換する。 */
export function formatLogMessage(entry: LogEntry, summary: LogEntrySummary, names: NameResolvers): string {
  const executorName = summary.subjectId ? userName(summary.subjectId, names) : "不明なユーザー";

  switch (entry.category) {
    case "message": {
      const authorName = userName(entry.authorId, names);
      switch (entry.action) {
        case "create":
          return `${authorName} がメッセージを投稿しました`;
        case "update":
          return `${authorName} がメッセージを編集しました`;
        case "delete":
        case "bulkDelete": {
          const suffix = entry.action === "bulkDelete" ? "複数のメッセージを削除しました" : "メッセージを削除しました";
          return entry.authorId === entry.executorId || entry.executorId === undefined
            ? `${authorName} が自分の${suffix}`
            : `${executorName} が ${authorName} の${suffix}`;
        }
        case "pin":
          return `${executorName} がメッセージをピン留めしました`;
        case "unpin":
          return `${executorName} がメッセージのピン留めを解除しました`;
      }
      break;
    }
    case "voice": {
      const targetName = userName(entry.userId, names);
      switch (entry.action) {
        case "join":
          return `${targetName} が ${channelName(entry.channelId, names)} に参加しました`;
        case "leave":
          return `${targetName} が ${channelName(entry.channelId, names)} から退出しました`;
        case "move":
          return `${targetName} が ${channelName(entry.previousChannelId, names)} から ${channelName(entry.channelId, names)} に移動しました`;
      }
      break;
    }
    case "member": {
      const targetName = userName(entry.userId, names);
      switch (entry.action) {
        case "join":
          return `${targetName} がサーバーに参加しました`;
        case "leave":
          return `${targetName} がサーバーから退出しました`;
        case "ban":
          return `${executorName} が ${targetName} をBANしました`;
        case "unban":
          return `${executorName} が ${targetName} のBANを解除しました`;
        case "kick":
          return `${executorName} が ${targetName} をキックしました`;
        case "timeout":
          return `${executorName} が ${targetName} をタイムアウトしました`;
        case "timeoutRemove":
          return `${executorName} が ${targetName} のタイムアウトを解除しました`;
        case "nicknameChange":
          return `${executorName} が ${targetName} のニックネームを変更しました`;
      }
      break;
    }
    case "role": {
      switch (entry.action) {
        case "create":
          return `${executorName} がロールを作成しました`;
        case "update":
          return `${executorName} がロールを更新しました`;
        case "delete":
          return `${executorName} がロールを削除しました`;
        case "memberAdd":
          return entry.userId
            ? `${executorName} が ${userName(entry.userId, names)} にロールを付与しました`
            : `${executorName} がロールを付与しました`;
        case "memberRemove":
          return entry.userId
            ? `${executorName} が ${userName(entry.userId, names)} のロールを剥奪しました`
            : `${executorName} がロールを剥奪しました`;
      }
      break;
    }
    case "channel": {
      const target = channelName(entry.channelId, names);
      switch (entry.action) {
        case "create":
          return `${executorName} が ${target} を作成しました`;
        case "update":
          return `${executorName} が ${target} を更新しました`;
        case "delete":
          return `${executorName} が ${target} を削除しました`;
      }
      break;
    }
    case "guild":
      return "サーバー設定が更新されました";
    case "moderationCase": {
      const targetName = userName(entry.targetUserId, names);
      const moderatorName = userName(entry.moderatorId, names);
      switch (entry.action) {
        case "create":
          return `${moderatorName} が ${targetName} にモデレーション処分を行いました`;
        case "update":
          return `${moderatorName} が ${targetName} への処分を更新しました`;
        case "resolve":
          return `${moderatorName} が ${targetName} への処分を解決しました`;
      }
      break;
    }
  }

  return `${summary.action ?? "更新"}: ${entry.category}`;
}
```

- [ ] **Step 4: テストを実行してパスを確認する**

Run: `bun test apps/dashboard-web/src/pages/format-log-message.test.ts`
Expected: PASS (全ケース)

- [ ] **Step 5: コミット**

```bash
git add apps/dashboard-web/src/pages/format-log-message.ts apps/dashboard-web/src/pages/format-log-message.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard-web): ログ一覧の自然文メッセージ生成を追加

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: resolveDisplayNamesにchannelIdsを渡すよう修正する

**Files:**
- Modify: `apps/dashboard-web/src/pages/LogListPage.tsx`
- Modify: `apps/dashboard-web/src/pages/LogListPage.test.tsx`

**Interfaces:**
- Consumes: `trpc.logging.resolveDisplayNames`(既存procedure、`channelIds`は既にバックエンドで実装済み)
- Produces: `namesQuery.data.channels: Record<string, string>` — Task 3のカード描画で使う。

**実装方針:**

現状`subjectIds`(ユーザーID)のみ集めているのに加え、`entry`からチャンネルID(`channelId`, `previousChannelId`)も集めて`channelIds`に渡す。カテゴリごとにチャンネルIDを持つフィールド名が異なるため、`entry`オブジェクトのうち値が文字列かつキー名が`channelId`または`previousChannelId`であるものを機械的に拾う(discriminated unionの型ガードを書くより、実行時にオブジェクトを走査する方がカテゴリ追加時の保守が楽)。

- [ ] **Step 1: 失敗するテストを書く**

`LogListPage.test.tsx`に以下のテストを追加する(既存の`resolveDisplayNames`呼び出しテストの直後に追加):

```typescript
  test("ボイスログのチャンネルIDをresolveDisplayNamesのchannelIdsに含めて問い合わせる", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({
        guildId: "g1",
        category: undefined,
        limit: 50,
        cursor: undefined,
      }).queryKey,
      {
        entries: [
          {
            id: "log-1",
            entry: {
              category: "voice",
              guildId: "g1",
              createdAt: "2026-09-04T00:00:00.000Z",
              userId: "u1",
              channelId: "c2",
              previousChannelId: "c1",
              action: "move",
            },
          },
        ],
        nextCursor: null,
      },
    );
    queryClient.setQueryData(
      trpc.logging.resolveDisplayNames.queryOptions({
        guildId: "g1",
        userIds: ["u1"],
        channelIds: ["c1", "c2"],
      }).queryKey,
      { users: { u1: "Sora" }, channels: { c1: "雑談", c2: "ゲーム部屋" } },
    );
    const html = renderPage("g1", queryClient);

    expect(html).toContain("雑談");
    expect(html).toContain("ゲーム部屋");
  });
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun test apps/dashboard-web/src/pages/LogListPage.test.tsx`
Expected: FAIL (`namesQuery`のqueryKeyが`channelIds: []`のままなので、テストがセットした`channelIds: ["c1", "c2"]`のキャッシュがヒットせずチャンネル名が表示されない)

- [ ] **Step 3: 実装する**

`LogListPage.tsx`の`subjectIds`計算の直後に、チャンネルID収集を追加し、`namesQuery`の`channelIds`引数を差し替える:

```typescript
  const channelIds = useMemo(
    () =>
      logsQuery.data
        ? [
            ...new Set(
              logsQuery.data.entries.flatMap(({ entry }) =>
                Object.entries(entry)
                  .filter(
                    ([key, value]): value is string =>
                      (key === "channelId" || key === "previousChannelId") && typeof value === "string",
                  )
                  .map(([, value]) => value),
              ),
            ),
          ]
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
```

- [ ] **Step 4: テストを実行してパスを確認する**

Run: `bun test apps/dashboard-web/src/pages/LogListPage.test.tsx`
Expected: PASS (全ケース。既存の`channelIds: []`を期待するテストは、対象エントリがチャンネルIDを持たない`message`カテゴリのケースなので影響を受けない)

- [ ] **Step 5: コミット**

```bash
git add apps/dashboard-web/src/pages/LogListPage.tsx apps/dashboard-web/src/pages/LogListPage.test.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard-web): ログ一覧でチャンネル名解決も行う

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: テーブル表示をカード型フィードに置き換える

**Files:**
- Modify: `apps/dashboard-web/src/pages/LogListPage.tsx`
- Modify: `apps/dashboard-web/src/pages/LogListPage.test.tsx`
- Modify: `apps/dashboard-web/src/pages/category-labels.ts` (カテゴリごとのアイコン用の色トークン名を追加)

**Interfaces:**
- Consumes: `formatLogMessage`(Task 1)、`namesQuery.data.channels`(Task 2)
- Produces: フィードUIのDOM構造。テストは`data-testid`ではなく既存パターン通りテキスト内容で検証する。

**実装方針:**

デザイン(Artifact)通り、1エントリ=1カード。カードは常時「見出し1行+日時」を表示し、クリックで詳細(本文カード、チャンネル名、実行者ID、ログID、操作ボタン)をトグル表示する。開閉状態は`useState<Set<string>>`でエントリID単位に持つ。`<Table>`系importとその使用箇所を削除し、shadcn/uiの`Button`のみ残す。日付区切り(「今日」「昨日」)は本タスクのスコープ外(YAGNI、既存の日時表示で十分)とし、カードを`createdAt`降順のまま並べる。

削除系ログ(`action === "delete" || action === "bulkDelete"`かつ`category === "message"`)では詳細パネルの操作ボタンから「Discordで開く」相当を出さない(そもそも現状「Discordで開く」ボタン自体を実装しないので、この制約は将来ボタンを追加する際のガードとして`isDeletedMessage`のような判定を用意しておく程度に留める。今回のスコープでは操作ボタンは「このユーザーで絞り込み」1つのみ実装する)。

- [ ] **Step 1: 失敗するテストを書く**

既存の`LogListPage.test.tsx`の「メッセージ本文はテキストとして表示し、残りのフィールドはdetails配下に隠す」テストを、新UIの構造に合わせて置き換える(`<details>`/`channelId`という生JSON表示に依存したアサーションをやめ、自然文見出しとクリック展開後の本文表示を検証する):

```typescript
  test("一覧では自然文の見出しのみを表示し、本文は展開後に表示する", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    queryClient.setQueryData(
      trpc.logging.listLogEntries.queryOptions({
        guildId: "g1",
        category: undefined,
        limit: 50,
        cursor: undefined,
      }).queryKey,
      {
        entries: [
          {
            id: "log-1",
            entry: {
              category: "message",
              guildId: "g1",
              createdAt: "2026-09-04T00:00:00.000Z",
              channelId: "c1",
              authorId: "a1",
              action: "create",
              content: "こんにちは",
            },
          },
        ],
        nextCursor: null,
      },
    );
    const html = renderPage("g1", queryClient);

    expect(html).toContain("がメッセージを投稿しました");
    // renderToStaticMarkupはonClickを実行しないため、詳細(本文)は常にDOMに存在し、
    // クライアント側でCSS/JSにより開閉される想定。本文自体はサーバー描画時点でHTMLに含まれる。
    expect(html).toContain("こんにちは");
  });
```

既存の「メッセージ削除の場合はJSONダンプ表示になる」ことを前提にしたテストは無い(上記1件のみが該当)ため、他の既存テスト(ローディング表示、空状態、実行者名解決など)はそのまま流用できる。ただし「カテゴリセレクトにアクセシブルな名前が付いている」テストはSelect自体を変更しないため影響なし。

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun test apps/dashboard-web/src/pages/LogListPage.test.tsx`
Expected: FAIL (現状の実装は自然文見出しを出さず、生JSONダンプのみのため)

- [ ] **Step 3: 実装する**

`category-labels.ts`にカテゴリごとのアクセントカラー(oklch値、既存の`--muted-foreground`等と衝突しないよう新規CSS変数名で定義)を追加する:

```typescript
// apps/dashboard-web/src/pages/category-labels.ts に追記
export const CATEGORY_ACCENT: Record<LogCategory, string> = {
  message: "oklch(0.55 0.14 250)",
  reaction: "oklch(0.55 0.14 250)",
  member: "oklch(0.6 0.14 150)",
  role: "oklch(0.65 0.15 90)",
  channel: "oklch(0.6 0.12 200)",
  guild: "oklch(0.556 0 0)",
  thread: "oklch(0.6 0.12 200)",
  invite: "oklch(0.6 0.12 200)",
  emoji: "oklch(0.556 0 0)",
  sticker: "oklch(0.556 0 0)",
  autoMod: "oklch(0.577 0.19 27)",
  integration: "oklch(0.556 0 0)",
  poll: "oklch(0.556 0 0)",
  scheduledEvent: "oklch(0.556 0 0)",
  stage: "oklch(0.556 0 0)",
  auditLogCorrelation: "oklch(0.556 0 0)",
  moderationCase: "oklch(0.577 0.19 27)",
  voice: "oklch(0.55 0.16 305)",
};
```

`LogListPage.tsx`のテーブル部分(`<Table>`〜`</Table>`)を以下に置き換える(importからTable関連を削除し、`formatLogMessage`と`CATEGORY_ACCENT`をimportに追加、開閉状態の`useState`を追加):

```typescript
import { useMemo, useRef, useState } from "react";
// ...
import { CATEGORY_OPTIONS, CATEGORY_LABELS, CATEGORY_ACCENT } from "./category-labels.js";
import { formatLogMessage } from "./format-log-message.js";
// Table関連のimportを削除
```

```typescript
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
```

一覧描画部分:

```tsx
            <div className="flex flex-col gap-2">
              {logsQuery.data.entries.map(({ id, entry }) => {
                const summary = summarizeLogEntry(entry);
                const names = { users: namesQuery.data?.users ?? {}, channels: namesQuery.data?.channels ?? {} };
                const message = formatLogMessage(entry, summary, names);
                const isExpanded = expandedIds.has(id);
                const isDeletedMessage =
                  entry.category === "message" && (entry.action === "delete" || entry.action === "bulkDelete");

                return (
                  <div key={id} className="rounded-lg border">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(id)}
                      className="flex w-full items-center gap-3 p-3 text-left hover:bg-accent/50"
                    >
                      <span
                        className="mt-0.5 size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: CATEGORY_ACCENT[entry.category] }}
                        aria-hidden="true"
                      />
                      <span className="flex-1 text-sm">{message}</span>
                      <time dateTime={summary.createdAt} className="text-muted-foreground shrink-0 text-xs">
                        {formatCreatedAt(summary.createdAt)}
                      </time>
                    </button>

                    {isExpanded && (
                      <div className="flex flex-col gap-3 border-t bg-muted/40 p-3">
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

                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-muted-foreground font-semibold tracking-wide uppercase">
                              カテゴリ
                            </span>
                            <span>{CATEGORY_LABELS[entry.category]}</span>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-muted-foreground font-semibold tracking-wide uppercase">
                              ログID
                            </span>
                            <span className="font-mono">{id}</span>
                          </div>
                        </div>

                        {!isDeletedMessage && summary.subjectId && (
                          <div className="flex gap-2">
                            <Button type="button" variant="outline" size="sm">
                              このユーザーで絞り込み
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
```

`isDeletedMessage`は現状「操作ボタンを出さないか」の判定にのみ使うが、このタスクでは「このユーザーで絞り込み」ボタン自体を削除系でも出す設計に見直す(削除済みメッセージへの遷移リンクではなく単なるフィルタ操作のため実際には問題ない)。したがって`isDeletedMessage`変数と条件分岐は不要——シンプルに`summary.subjectId`がある場合のみボタンを出す。上記コード例の`!isDeletedMessage &&`部分は`summary.subjectId &&`のみに直して実装する。

- [ ] **Step 4: テストを実行してパスを確認する**

Run: `bun test apps/dashboard-web/src/pages/LogListPage.test.tsx`
Expected: PASS (全ケース)

- [ ] **Step 5: 型チェックとlintを実行する**

Run: `bun run typecheck` (または該当パッケージの`tsc --noEmit`)、`bun run lint`
Expected: エラーなし。未使用の`Table`系importが残っていないか確認する。

- [ ] **Step 6: コミット**

```bash
git add apps/dashboard-web/src/pages/LogListPage.tsx apps/dashboard-web/src/pages/LogListPage.test.tsx apps/dashboard-web/src/pages/category-labels.ts
git commit -m "$(cat <<'EOF'
feat(dashboard-web): ログ一覧をテーブルからフィード型UIに刷新

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 手動確認

**Files:** なし(検証のみ)

- [ ] **Step 1: dashboard-web devサーバーを起動する**

Run: `cd apps/dashboard-web && bun run dev` (既存のpackage.jsonのdevスクリプトに従う。dashboard-apiも別途起動が必要な場合はそちらも起動する)

- [ ] **Step 2: ブラウザでログ画面を開き、以下を確認する**

- カテゴリごとに見出し文が自然な日本語になっている(特にメッセージ削除・ボイス移動)
- カードをクリックすると詳細(本文/カテゴリ/ログID)が開閉する
- ボイス移動のログで実際のチャンネル名が表示される(IDのままになっていないか確認)
- カテゴリSelectで絞り込みが従来通り機能する
- ページネーション(前へ/次へ)が従来通り機能する

- [ ] **Step 3: 問題があれば修正し、Task 1-3のコミットに追加コミットする**

---

## Self-Review

- **Spec coverage**: 自然文見出し(Task 1,3)、展開式詳細パネル(Task 3)、削除ログでの不要ボタン非表示(Task 3で「Discordで開く」等のリンクボタン自体を実装しないことで対応)、カテゴリフィルタはSelectのまま維持(変更なし)。手動確認(Task 4)でチャンネル名表示を含め通し確認する。
- **Placeholder scan**: 各Stepに実コードを記載済み。TBD/TODOなし。
- **Type consistency**: `formatLogMessage`のシグネチャ(Task 1で定義)をTask 3で使用する引数の型と揃えた。`namesQuery.data?.channels`はTask 2で追加した`channels`フィールドと一致させた。
