# ログ一覧の表示改善(実行者フォールバック・名前解決・監査ログ相関除外) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ダッシュボードのログ一覧画面で、(1) 「実行者」列がexecutorId未設定時に空欄になる問題を修正し、(2) 実行者ID・チャンネルIDをDiscordのユーザー名/チャンネル名で表示し、(3) auditLogCorrelationカテゴリの生ログ行を一覧から除外する設定を追加する(デフォルトで除外)。

**Architecture:** application層に「カテゴリごとの主体ID抽出」ロジックを追加し、summarizeLogEntryの`executorId`をexecutorId優先・主体IDフォールバックの`subjectId`に置き換える。名前解決はdashboard-api層に集約する: 既存の`fetchGuildChannels`と同じBot REST APIパターンで、ページ内に出現したユーザーID/チャンネルIDだけをまとめて解決するtRPC procedureを新設し、フロントは一覧取得後にこのprocedureを呼んでID→名前のMapを作りテーブル描画時に引く。auditLogCorrelation除外は新規のguild単位1行設定テーブル(`log_display_settings`)を追加し、`listLogEntries`呼び出し前にカテゴリ一覧から除外する。

**Tech Stack:** TypeScript strict, Drizzle ORM(Postgres), tRPC, React + TanStack Query, Zod, bun test

**Spec:** GitHub Issue #84(このplanが唯一の参照先。別途specファイルはなし)

## Global Constraints

- TypeScript strictモード、`any`禁止。外部境界(Discord APIレスポンス)は`unknown`→zod `parse`/`safeParse`必須。
- Discord IDは`text`型、タイムスタンプは`timestamptz`。enumは使わずtext+CHECK制約。
- Dashboard UIでのID直接入力は禁止(既存のセレクター経由方針を維持、今回は表示のみなので新規入力UIは無し)。
- マイグレーションは手書きせず`bun run db:generate`(drizzle-kit generate)で生成する。
- 詳細JSON(`details`展開)内のID解決はスコープ外。実行者列とチャンネル表示のみ名前解決する。
- テストは実装ファイルとコロケーション(`*.test.ts`)。DB依存テストは`*.db.test.ts`。

---

## File Structure

- Modify: `packages/logging/src/domain/log-category.ts` — 変更なし(参照のみ)
- Create: `packages/logging/src/domain/log-entry-subject.ts` — カテゴリごとに「主体ID」を1つ取り出すロジック(新規)
- Create: `packages/logging/src/domain/log-entry-subject.test.ts`
- Modify: `packages/logging/src/domain/index.ts` — 上記のexport追加
- Modify: `apps/dashboard-web/src/pages/log-entry-summary.ts` — `executorId`→`subjectId`(フォールバック込み)に変更
- Modify: `apps/dashboard-web/src/pages/log-entry-summary.test.ts` — 上記に合わせて更新
- Modify: `apps/dashboard-web/src/pages/LogListPage.tsx` — 列表示をsubjectId+名前解決に変更
- Modify: `apps/dashboard-web/src/pages/LogListPage.test.tsx` — 上記に合わせて更新
- Create: `packages/db/src/schema/logging.ts` に `logDisplaySettings` テーブル追加(既存ファイルmodify)
- Modify: `packages/db/src/schema/logging.test.ts` — 追加テーブルのテスト
- Create: `packages/logging/src/application/display-settings.ts` — `getDisplaySettings`/`setDisplaySetting`
- Create: `packages/logging/src/application/display-settings.db.test.ts`
- Modify: `packages/logging/src/application/list-log-entries.ts` — `excludeCategories`オプション追加
- Modify: `packages/logging/src/application/list-log-entries.db.test.ts`
- Modify: `packages/logging/src/application/index.ts` — export追加
- Modify: `packages/logging/src/router/index.ts` — `listLogEntries`呼び出し前にauditLogCorrelation除外設定を適用するprocedure追加、`getDisplaySetting`/`setDisplaySetting` procedure追加、`resolveDisplayNames` procedure追加
- Modify: `packages/logging/src/router/index.test.ts`
- Modify: `packages/dashboard-access/src/trpc.ts` — `DashboardAccessContext`に`getGuildMemberNames`追加
- Modify: `apps/dashboard-api/src/discord/bot-client.ts` — `fetchGuildMemberNames`追加、`fetchGuildChannels`を名前解決にも使えるよう関数分離
- Create: `apps/dashboard-api/src/discord/bot-client.test.ts`(既存があれば追記)
- Modify: `apps/dashboard-api/src/context.ts` — `getGuildMemberNames`をctxに供給
- Modify: `apps/dashboard-web/src/pages/SettingsPage.tsx` — 監査ログ相関除外のトグルUI追加
- Modify: `apps/dashboard-web/src/pages/SettingsPage.test.tsx`

---

### Task 1: カテゴリごとの主体ID抽出ロジック

**Files:**
- Create: `packages/logging/src/domain/log-entry-subject.ts`
- Test: `packages/logging/src/domain/log-entry-subject.test.ts`
- Modify: `packages/logging/src/domain/index.ts`

**Interfaces:**
- Consumes: `LogEntry`型(`packages/logging/src/domain/log-category.ts`で定義済み)
- Produces: `getLogEntrySubjectId(entry: LogEntry): string | undefined` — executorIdは見ない、カテゴリ固有の「誰の動きか」を表すユーザーIDのみを返す。member→userId、role→userId(あれば)、autoMod→userId、moderationCase→targetUserId、message→authorId、voice→userId、他(guild/thread/invite/emoji/integration/poll/scheduledEvent/stage/channel/auditLogCorrelation)はユーザーIDを持たないのでundefined。

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// packages/logging/src/domain/log-entry-subject.test.ts
import { describe, expect, test } from "bun:test";
import { getLogEntrySubjectId } from "./log-entry-subject.js";
import type { LogEntry } from "./log-category.js";

describe("getLogEntrySubjectId", () => {
  test("messageはauthorIdを返す", () => {
    const entry = {
      category: "message",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      channelId: "c1",
      authorId: "a1",
      action: "delete",
    } satisfies LogEntry;
    expect(getLogEntrySubjectId(entry)).toBe("a1");
  });

  test("memberはuserIdを返す", () => {
    const entry = {
      category: "member",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      userId: "u1",
      action: "join",
    } satisfies LogEntry;
    expect(getLogEntrySubjectId(entry)).toBe("u1");
  });

  test("moderationCaseはtargetUserIdを返す(moderatorIdではない)", () => {
    const entry = {
      category: "moderationCase",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      caseId: "case1",
      targetUserId: "target1",
      moderatorId: "mod1",
      action: "create",
      actionType: "warn",
    } satisfies LogEntry;
    expect(getLogEntrySubjectId(entry)).toBe("target1");
  });

  test("roleはuserId未設定(create/update/delete)ならundefined", () => {
    const entry = {
      category: "role",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      roleId: "r1",
      action: "update",
    } satisfies LogEntry;
    expect(getLogEntrySubjectId(entry)).toBeUndefined();
  });

  test("guildはundefined(ユーザーIDを持たないカテゴリ)", () => {
    const entry = {
      category: "guild",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      action: "update",
    } satisfies LogEntry;
    expect(getLogEntrySubjectId(entry)).toBeUndefined();
  });

  test("voiceはuserIdを返す", () => {
    const entry = {
      category: "voice",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      userId: "u1",
      channelId: "c1",
      action: "join",
    } satisfies LogEntry;
    expect(getLogEntrySubjectId(entry)).toBe("u1");
  });

  test("autoModはuserIdを返す", () => {
    const entry = {
      category: "autoMod",
      guildId: "g1",
      createdAt: "2026-09-04T00:00:00.000Z",
      ruleId: "rule1",
      userId: "u1",
      action: "actionExecuted",
    } satisfies LogEntry;
    expect(getLogEntrySubjectId(entry)).toBe("u1");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd packages/logging && bun test src/domain/log-entry-subject.test.ts`
Expected: FAIL(モジュールが存在しない)

- [ ] **Step 3: 実装**

```typescript
// packages/logging/src/domain/log-entry-subject.ts
import type { LogEntry } from "./log-category.js";

/**
 * カテゴリごとに異なる形のLogEntryから「誰の行動/誰に対する行動か」を表す
 * 単一のユーザーIDを取り出す。executorId(監査ログ相関で事後的に埋まる実行者)は
 * ここでは見ない(呼び出し側で優先度を決める)。
 * moderationCaseはtargetUserId(処分対象)を返す。実行者を見たい場合はmoderatorIdを別途参照すること。
 */
export function getLogEntrySubjectId(entry: LogEntry): string | undefined {
  switch (entry.category) {
    case "message":
      return entry.authorId;
    case "member":
      return entry.userId;
    case "role":
      return entry.userId;
    case "autoMod":
      return entry.userId;
    case "voice":
      return entry.userId;
    case "moderationCase":
      return entry.targetUserId;
    case "channel":
    case "guild":
    case "thread":
    case "invite":
    case "emoji":
    case "integration":
    case "poll":
    case "scheduledEvent":
    case "stage":
    case "auditLogCorrelation":
      return undefined;
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd packages/logging && bun test src/domain/log-entry-subject.test.ts`
Expected: PASS(7件)

- [ ] **Step 5: exportを追加**

`packages/logging/src/domain/index.ts` に以下を追加:

```typescript
export { getLogEntrySubjectId } from "./log-entry-subject.js";
```

- [ ] **Step 6: パッケージ全体のtypecheckを実行**

Run: `cd packages/logging && bun run typecheck`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add packages/logging/src/domain/log-entry-subject.ts packages/logging/src/domain/log-entry-subject.test.ts packages/logging/src/domain/index.ts
git commit -m "$(cat <<'EOF'
feat(logging): カテゴリごとの主体ID抽出ロジックを追加

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: ログ一覧の「実行者」列をexecutorId優先・主体IDフォールバックに修正

**Files:**
- Modify: `apps/dashboard-web/src/pages/log-entry-summary.ts`
- Modify: `apps/dashboard-web/src/pages/log-entry-summary.test.ts`

**Interfaces:**
- Consumes: `getLogEntrySubjectId`(Task 1で作成、`@management-bot/logging`から`domain`経由でexportされている想定。dashboard-webから直接importできない場合は`packages/logging/src/index.ts`(パッケージルート)からもexportされているか確認し、必要ならそちらにも追加する)
- Produces: `LogEntrySummary.subjectId: string | null`(既存の`executorId`フィールドを置き換える)。`summarizeLogEntry`のシグネチャは`LogEntry`型そのものを受け取るよう変更(現状は`{category, createdAt, executorId?}`のみの緩い型)。

**事前確認:** `packages/logging/src/index.ts`(パッケージのルートエントリ)に`domain`のexportが含まれているか確認すること。

- [ ] **Step 1: ルートexportを確認**

Run: `cat packages/logging/src/index.ts` (Readツールで確認)
domainの型/関数がexportされていなければ、`getLogEntrySubjectId`と`LogEntry`型をこのファイルにも追加でexportする。

- [ ] **Step 2: 失敗するテストを書く(既存テストを置き換え)**

```typescript
// apps/dashboard-web/src/pages/log-entry-summary.test.ts
import { describe, expect, test } from "bun:test";
import { summarizeLogEntry } from "./log-entry-summary.js";
import type { LogEntry } from "@management-bot/logging";

describe("summarizeLogEntry", () => {
  test("executorIdがあればexecutorIdをsubjectIdとして使う", () => {
    const entry = {
      category: "role",
      createdAt: "2026-09-04T00:00:00.000Z",
      guildId: "g1",
      executorId: "u1",
      channelId: "c1",
      authorId: "a1",
      action: "delete",
    } as unknown as LogEntry;

    const summary = summarizeLogEntry(entry);

    expect(summary).toEqual({
      category: "role",
      createdAt: "2026-09-04T00:00:00.000Z",
      subjectId: "u1",
      action: "delete",
      content: null,
      details: { channelId: "c1", authorId: "a1" },
    });
  });

  test("executorId未設定でカテゴリ固有の主体IDがあればそれをsubjectIdにする", () => {
    const entry = {
      category: "message",
      createdAt: "2026-09-04T00:00:00.000Z",
      guildId: "g1",
      channelId: "c1",
      authorId: "a1",
      action: "delete",
    } as unknown as LogEntry;

    const summary = summarizeLogEntry(entry);

    expect(summary.subjectId).toBe("a1");
    // authorIdはsubjectIdとして採用されたのでdetailsには残らない
    expect(summary.details).toEqual({ channelId: "c1" });
  });

  test("executorIdも主体IDもない場合はnullになる", () => {
    const entry = {
      category: "guild",
      createdAt: "2026-09-04T00:00:00.000Z",
      guildId: "g1",
      action: "update",
    } as unknown as LogEntry;

    expect(summarizeLogEntry(entry).subjectId).toBeNull();
  });

  test("contentはdetailsに埋めずそのまま取り出す", () => {
    const entry = {
      category: "message",
      createdAt: "2026-09-04T00:00:00.000Z",
      guildId: "g1",
      channelId: "c1",
      authorId: "a1",
      action: "create",
      content: "こんにちは",
    } as unknown as LogEntry;

    const summary = summarizeLogEntry(entry);
    expect(summary.content).toBe("こんにちは");
    expect(summary.details).toEqual({ channelId: "c1" });
  });

  test("content未設定の場合はnullになる", () => {
    const entry = {
      category: "message",
      createdAt: "2026-09-04T00:00:00.000Z",
      guildId: "g1",
      channelId: "c1",
      authorId: "a1",
      action: "delete",
    } as unknown as LogEntry;

    expect(summarizeLogEntry(entry).content).toBeNull();
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `cd apps/dashboard-web && bun test src/pages/log-entry-summary.test.ts`
Expected: FAIL(`subjectId`が存在しない、または型エラー)

- [ ] **Step 4: 実装を更新**

```typescript
// apps/dashboard-web/src/pages/log-entry-summary.ts
import { getLogEntrySubjectId, type LogEntry } from "@management-bot/logging";

export interface LogEntrySummary {
  category: string;
  createdAt: string;
  /** 実行者(executorId、監査ログ相関で判明した場合)またはカテゴリ固有の主体(authorId/userId等)。どちらもなければnull。 */
  subjectId: string | null;
  action: string | null;
  /** メッセージ本文等、そのまま読める形で表示したいテキスト。 */
  content: string | null;
  /** 上記以外のcategory固有フィールド。一覧では隠し、詳細展開時のみJSONで描画する。 */
  details: Record<string, unknown>;
}

const BASE_FIELDS = new Set(["category", "createdAt", "executorId", "guildId"]);

/** カテゴリごとに形の異なるLogEntryを、一覧表示用の共通形式に変換する。 */
export function summarizeLogEntry(entry: LogEntry): LogEntrySummary {
  const subjectId = ("executorId" in entry ? entry.executorId : undefined) ?? getLogEntrySubjectId(entry);
  const details: Record<string, unknown> = {};
  let action: string | null = null;
  let content: string | null = null;
  for (const [key, value] of Object.entries(entry)) {
    if (key === "action" && typeof value === "string") {
      action = value;
      continue;
    }
    if (key === "content" && typeof value === "string") {
      content = value;
      continue;
    }
    if (!BASE_FIELDS.has(key) && value !== subjectId) {
      details[key] = value;
    }
  }
  return {
    category: entry.category,
    createdAt: entry.createdAt,
    subjectId: subjectId ?? null,
    action,
    content,
    details,
  };
}
```

**注意:** `value !== subjectId`によるdetails除外は、値が偶然subjectIdと同じ文字列になる他フィールド(通常あり得ないが)を誤って消す可能性がある。より安全にするため、`getLogEntrySubjectId`が返した「フィールド名」を別途持ち回るほうが望ましいが、シンプルさを優先しこの実装にする。もしテストで問題が出た場合は、`getLogEntrySubjectId`を`{ field: string; value: string } | undefined`を返すように変更し、`BASE_FIELDS`に`field`を動的に追加する方式に切り替えること。

- [ ] **Step 5: テストが通ることを確認**

Run: `cd apps/dashboard-web && bun test src/pages/log-entry-summary.test.ts`
Expected: PASS(5件)

- [ ] **Step 6: コミット**

```bash
git add apps/dashboard-web/src/pages/log-entry-summary.ts apps/dashboard-web/src/pages/log-entry-summary.test.ts
git commit -m "$(cat <<'EOF'
fix(dashboard): ログ一覧の実行者列がexecutorId未設定時に空欄になる問題を修正

executorId(監査ログ相関で事後的に埋まる実行者)が未設定のカテゴリでは
常に「-」表示になっていたため、authorId/userId等のカテゴリ固有の主体IDに
フォールバックするようにした。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: LogListPageの表示をsubjectIdに追従させる

**Files:**
- Modify: `apps/dashboard-web/src/pages/LogListPage.tsx`
- Modify: `apps/dashboard-web/src/pages/LogListPage.test.tsx`

**Interfaces:**
- Consumes: `LogEntrySummary.subjectId`(Task 2で作成)

- [ ] **Step 1: 既存テストの`executorId`関連アサーションを確認**

Read `apps/dashboard-web/src/pages/LogListPage.test.tsx` を全文読み、`executorId`を参照している箇所を特定する。

- [ ] **Step 2: テストを`subjectId`ベースに書き換える**

既存テスト内の`executorId`を含むモックデータ・アサーションを、Task 2で定義した`subjectId`セマンティクスに合わせて書き換える(例: `authorId`のみ持つmessageエントリで「実行者」列に`authorId`の値が表示されることを検証するテストケースを追加する)。既存の記述パターン(モックエントリ・レンダリング・`screen.getByText`等)を踏襲すること。

- [ ] **Step 3: テストが失敗することを確認**

Run: `cd apps/dashboard-web && bun test src/pages/LogListPage.test.tsx`
Expected: FAIL

- [ ] **Step 4: LogListPage.tsxを修正**

`apps/dashboard-web/src/pages/LogListPage.tsx`の148行目付近:

```tsx
                      <TableCell>{summary.subjectId ?? "-"}</TableCell>
```

(元は`{summary.executorId ?? "-"}`だった行を上記に置き換える。この時点ではまだID表示のまま、名前解決はTask 6で追加する。)

- [ ] **Step 5: テストが通ることを確認**

Run: `cd apps/dashboard-web && bun test src/pages/LogListPage.test.tsx`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add apps/dashboard-web/src/pages/LogListPage.tsx apps/dashboard-web/src/pages/LogListPage.test.tsx
git commit -m "$(cat <<'EOF'
fix(dashboard): ログ一覧の実行者列をsubjectId(executorIdフォールバック込み)で表示

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 表示設定テーブル(auditLogCorrelation除外フラグ)の追加

**Files:**
- Modify: `packages/db/src/schema/logging.ts`
- Modify: `packages/db/src/schema/logging.test.ts`
- Create: マイグレーション(drizzle-kit generateで自動生成、手書きしない)

**Interfaces:**
- Produces: `logDisplaySettings`テーブル(Drizzleスキーマ)。列: `guildId: text (PK, FK->guilds.id, onDelete cascade)`, `hideAuditLogCorrelation: boolean (default true, notNull)`。

- [ ] **Step 1: 既存のschemaテストの形式を確認**

Read `packages/db/src/schema/logging.test.ts` で既存テストのアサーション方法(型検証かSQL検証か)を確認する。

- [ ] **Step 2: 失敗するテストを書く(既存ファイルに追記)**

既存の`logging.test.ts`のパターンに倣い、`logDisplaySettings`テーブルが`guildId`カラムを主キーに持つこと、`hideAuditLogCorrelation`のデフォルトが`true`であることを検証するテストケースを追加する。既存テストの検証方法(drizzleのテーブル定義から`getTableConfig`等で読む形式が使われていればそれに従う)をそのまま踏襲すること。

- [ ] **Step 3: テストが失敗することを確認**

Run: `cd packages/db && bun test src/schema/logging.test.ts`
Expected: FAIL(`logDisplaySettings`が存在しない)

- [ ] **Step 4: スキーマに追加**

`packages/db/src/schema/logging.ts`の末尾に追記:

```typescript
export const logDisplaySettings = pgTable("log_display_settings", {
  guildId: text("guild_id")
    .primaryKey()
    .references(() => guilds.id, { onDelete: "cascade" }),
  /** trueの場合、auditLogCorrelationカテゴリの生ログをダッシュボードの一覧表示から除外する。 */
  hideAuditLogCorrelation: boolean("hide_audit_log_correlation").notNull().default(true),
});
```

ファイル先頭のimport文に`boolean`を追加すること:

```typescript
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cd packages/db && bun test src/schema/logging.test.ts`
Expected: PASS

- [ ] **Step 6: マイグレーションを生成**

Run: `cd packages/db && bun run db:generate`
生成された`packages/db/drizzle/000N_*.sql`の内容を読み、`CREATE TABLE "log_display_settings"`が含まれることを確認する。

- [ ] **Step 7: マイグレーションをテストDBに適用して確認**

Run: `cd packages/db && bun run db:migrate`(`DATABASE_URL`がテスト用に設定されている前提。CLAUDE.mdの既存運用ルールに従う)
Expected: エラーなく適用される

- [ ] **Step 8: コミット**

```bash
git add packages/db/src/schema/logging.ts packages/db/src/schema/logging.test.ts packages/db/drizzle/
git commit -m "$(cat <<'EOF'
feat(db): 監査ログ相関の一覧非表示設定テーブルを追加

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 表示設定のapplication層とlistLogEntriesへの統合

**Files:**
- Create: `packages/logging/src/application/display-settings.ts`
- Create: `packages/logging/src/application/display-settings.db.test.ts`
- Modify: `packages/logging/src/application/list-log-entries.ts`
- Modify: `packages/logging/src/application/list-log-entries.db.test.ts`
- Modify: `packages/logging/src/application/index.ts`

**Interfaces:**
- Consumes: `logDisplaySettings`(Task 4)
- Produces: `getDisplaySettings(db, guildId): Promise<{ hideAuditLogCorrelation: boolean }>`、`setDisplaySetting(db, guildId, hideAuditLogCorrelation: boolean): Promise<void>`。`ListLogEntriesInput`に`excludeCategories?: readonly LogCategory[]`を追加。

- [ ] **Step 1: display-settings.db.test.tsを書く(既存のretention-settings.db.test.tsのセットアップパターンに倣う)**

Read `packages/logging/src/application/retention-settings.db.test.ts` を参照し、同じDBセットアップ(テスト用guild作成等)パターンで以下を書く:

```typescript
// packages/logging/src/application/display-settings.db.test.ts
import { describe, expect, test } from "bun:test";
// NOTE: 既存のretention-settings.db.test.tsのimport/セットアップ(testDb、テストguild作成ヘルパー等)を
// そのままこのファイルでも使うこと。ファイル冒頭の共通セットアップコードを確認してから書くこと。
import { getDisplaySettings, setDisplaySetting } from "./display-settings.js";

describe("display-settings", () => {
  test("未設定のguildはhideAuditLogCorrelation=trueを返す(デフォルトON)", async () => {
    // 既存パターンでテスト用guildIdを用意
    const settings = await getDisplaySettings(db, guildId);
    expect(settings.hideAuditLogCorrelation).toBe(true);
  });

  test("setDisplaySettingでfalseに変更できる", async () => {
    await setDisplaySetting(db, guildId, false);
    const settings = await getDisplaySettings(db, guildId);
    expect(settings.hideAuditLogCorrelation).toBe(false);
  });

  test("falseに変更後trueに戻せる", async () => {
    await setDisplaySetting(db, guildId, false);
    await setDisplaySetting(db, guildId, true);
    const settings = await getDisplaySettings(db, guildId);
    expect(settings.hideAuditLogCorrelation).toBe(true);
  });
});
```

(実際のimport/セットアップは既存の`retention-settings.db.test.ts`の内容をコピーして`db`, `guildId`変数を用意すること。)

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd packages/logging && bun test src/application/display-settings.db.test.ts`
Expected: FAIL(モジュールが存在しない)

- [ ] **Step 3: 実装**

```typescript
// packages/logging/src/application/display-settings.ts
import type { Db } from "@management-bot/db";
import { logDisplaySettings } from "@management-bot/db";
import { eq } from "drizzle-orm";

export interface DisplaySettings {
  hideAuditLogCorrelation: boolean;
}

/** 未設定のguildはデフォルト値(hideAuditLogCorrelation=true)を返す。 */
export async function getDisplaySettings(db: Db, guildId: string): Promise<DisplaySettings> {
  const [row] = await db
    .select({ hideAuditLogCorrelation: logDisplaySettings.hideAuditLogCorrelation })
    .from(logDisplaySettings)
    .where(eq(logDisplaySettings.guildId, guildId));
  return { hideAuditLogCorrelation: row?.hideAuditLogCorrelation ?? true };
}

export async function setDisplaySetting(
  db: Db,
  guildId: string,
  hideAuditLogCorrelation: boolean,
): Promise<void> {
  await db
    .insert(logDisplaySettings)
    .values({ guildId, hideAuditLogCorrelation })
    .onConflictDoUpdate({
      target: logDisplaySettings.guildId,
      set: { hideAuditLogCorrelation },
    });
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd packages/logging && bun test src/application/display-settings.db.test.ts`
Expected: PASS

- [ ] **Step 5: `@management-bot/db`からlogDisplaySettingsがexportされているか確認**

Read `packages/db/src/index.ts`(またはschema集約ファイル)を確認し、`logDisplaySettings`がexportされていなければ追加する。

- [ ] **Step 6: list-log-entries.tsに除外オプションを追加するテストを書く**

Read `packages/logging/src/application/list-log-entries.db.test.ts` の既存パターンを確認した上で、以下のテストケースを追加:

```typescript
test("excludeCategoriesで指定したカテゴリは結果に含まれない", async () => {
  // 既存パターンでauditLogCorrelationカテゴリと他カテゴリのログエントリをそれぞれ書き込む
  const result = await listLogEntries(db, {
    guildId,
    limit: 50,
    excludeCategories: ["auditLogCorrelation"],
  });
  expect(result.entries.every((e) => e.entry.category !== "auditLogCorrelation")).toBe(true);
});
```

- [ ] **Step 7: テストが失敗することを確認**

Run: `cd packages/logging && bun test src/application/list-log-entries.db.test.ts`
Expected: FAIL(`excludeCategories`が型エラーまたは無視される)

- [ ] **Step 8: list-log-entries.tsを修正**

```typescript
// packages/logging/src/application/list-log-entries.ts の該当箇所を編集
import { and, desc, eq, lt, notInArray, or } from "drizzle-orm";
// ... (既存importに notInArray を追加)

export interface ListLogEntriesInput {
  guildId: string;
  category?: LogCategory;
  limit: number;
  cursor?: string;
  /** これらのカテゴリは結果から除外する(categoryフィルタと併用可)。 */
  excludeCategories?: readonly LogCategory[];
}
```

`listLogEntries`関数内、`conditions`配列組み立て部分に追加:

```typescript
  const conditions = [eq(logEntries.guildId, input.guildId)];
  if (input.category) conditions.push(eq(logEntries.category, input.category));
  if (input.excludeCategories && input.excludeCategories.length > 0) {
    conditions.push(notInArray(logEntries.category, input.excludeCategories));
  }
```

- [ ] **Step 9: テストが通ることを確認**

Run: `cd packages/logging && bun test src/application/list-log-entries.db.test.ts`
Expected: PASS

- [ ] **Step 10: application/index.tsにexportを追加**

```typescript
export {
  getDisplaySettings,
  setDisplaySetting,
  type DisplaySettings,
} from "./display-settings.js";
```

- [ ] **Step 11: パッケージ全体のtypecheck**

Run: `cd packages/logging && bun run typecheck`
Expected: エラーなし

- [ ] **Step 12: コミット**

```bash
git add packages/logging/src/application/display-settings.ts packages/logging/src/application/display-settings.db.test.ts packages/logging/src/application/list-log-entries.ts packages/logging/src/application/list-log-entries.db.test.ts packages/logging/src/application/index.ts packages/db/src/index.ts
git commit -m "$(cat <<'EOF'
feat(logging): 監査ログ相関の一覧除外設定とlistLogEntriesへの統合

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: routerへの表示設定procedure追加とlistLogEntriesでの適用

**Files:**
- Modify: `packages/logging/src/router/index.ts`
- Modify: `packages/logging/src/router/index.test.ts`

**Interfaces:**
- Consumes: `getDisplaySettings`, `setDisplaySetting`(Task 5)
- Produces: tRPC procedures `logging.getDisplaySettings`, `logging.setDisplaySetting`。`logging.listLogEntries`内部で`hideAuditLogCorrelation`が`true`の場合、`excludeCategories: ["auditLogCorrelation"]`を渡す(ただし、ユーザーが明示的に`category: "auditLogCorrelation"`を選んでいる場合はそのまま表示する=除外しない)。

- [ ] **Step 1: 既存のrouter/index.test.tsのテストパターンを確認**

Read `packages/logging/src/router/index.test.ts` を全文読み、`listLogEntries`procedureのテストがどうモックのdbやctxを渡しているか確認する。

- [ ] **Step 2: 失敗するテストを書く**

既存パターンに倣い、以下のテストケースを追加:

```typescript
test("listLogEntriesはhideAuditLogCorrelation=true(デフォルト)の場合、auditLogCorrelationを除外する", async () => {
  // 既存パターンでcaller/ctxを用意し、auditLogCorrelationと他カテゴリのエントリを用意
  // listLogEntries呼び出し結果にauditLogCorrelationが含まれないことを検証
});

test("category=auditLogCorrelationを明示指定した場合は除外しない", async () => {
  // category: "auditLogCorrelation" を指定した場合、結果にauditLogCorrelationが含まれることを検証
});

test("getDisplaySettings/setDisplaySettingで設定を読み書きできる", async () => {
  // setDisplaySetting({guildId, hideAuditLogCorrelation: false})後、
  // getDisplaySettings({guildId})がfalseを返すことを検証
  // その後listLogEntriesでauditLogCorrelationが含まれることも検証
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `cd packages/logging && bun test src/router/index.test.ts`
Expected: FAIL

- [ ] **Step 4: router/index.tsを修正**

```typescript
// 既存importに追加
import {
  getDisplaySettings,
  setDisplaySetting,
  // ...既存のimportに加えて
} from "../application/index.js";

const setDisplaySettingInput = z.object({
  guildId: z.string().min(1),
  hideAuditLogCorrelation: z.boolean(),
});
```

`listLogEntries`procedureを修正:

```typescript
  listLogEntries: protectedProcedure
    .input(listLogEntriesInput)
    .use(requireCapability(CAPABILITIES.VIEW_LOGS))
    .query(async ({ ctx, input }) => {
      const displaySettings = await getDisplaySettings(ctx.db, input.guildId);
      const excludeCategories =
        displaySettings.hideAuditLogCorrelation && input.category !== "auditLogCorrelation"
          ? (["auditLogCorrelation"] as const)
          : undefined;

      let result;
      try {
        result = await listLogEntries(ctx.db, { ...input, excludeCategories });
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "invalid cursor" });
      }
      const hasRawAccess = hasCapability(ctx.capabilities, CAPABILITIES.VIEW_LOGS_RAW);

      return {
        entries: result.entries.map(({ id, entry }) => ({
          id,
          entry: hasRawAccess ? entry : maskSensitiveFields(entry),
        })),
        nextCursor: result.nextCursor,
      };
    }),
```

`router`定義の末尾に追加:

```typescript
  getDisplaySettings: protectedProcedure
    .input(guildIdInput)
    .use(requireCapability(CAPABILITIES.MANAGE_LOGGING_SETTINGS))
    .query(({ ctx, input }) => getDisplaySettings(ctx.db, input.guildId)),

  setDisplaySetting: protectedProcedure
    .input(setDisplaySettingInput)
    .use(requireCapability(CAPABILITIES.MANAGE_LOGGING_SETTINGS))
    .mutation(({ ctx, input }) => setDisplaySetting(ctx.db, input.guildId, input.hideAuditLogCorrelation)),
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cd packages/logging && bun test src/router/index.test.ts`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add packages/logging/src/router/index.ts packages/logging/src/router/index.test.ts
git commit -m "$(cat <<'EOF'
feat(logging): 監査ログ相関の一覧除外設定をrouterに統合

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: SettingsPageに監査ログ相関除外トグルUIを追加

**Files:**
- Modify: `apps/dashboard-web/src/pages/SettingsPage.tsx`
- Modify: `apps/dashboard-web/src/pages/SettingsPage.test.tsx`

**Interfaces:**
- Consumes: tRPC `logging.getDisplaySettings`, `logging.setDisplaySetting`(Task 6)

- [ ] **Step 1: 既存のSettingsPage.test.tsxのテストパターンを確認**

Read `apps/dashboard-web/src/pages/SettingsPage.test.tsx` を全文読み、`trpc`のモック方法を確認する。

- [ ] **Step 2: 失敗するテストを書く**

既存パターンに倣い、以下を追加:

```typescript
test("監査ログ相関を一覧に表示するチェックボックスが表示され、初期状態はオフ(非表示がデフォルト)", async () => {
  // getDisplaySettingsが{hideAuditLogCorrelation: true}を返すモックを用意してレンダリング
  // チェックボックスがuncheckedであることを確認(「表示する」チェックボックスなのでtrueのとき=非表示=unchecked)
});

test("チェックボックスをオンにするとsetDisplaySettingがhideAuditLogCorrelation:falseで呼ばれる", async () => {
  // クリック後、mutation呼び出し引数を検証
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `cd apps/dashboard-web && bun test src/pages/SettingsPage.test.tsx`
Expected: FAIL

- [ ] **Step 4: SettingsPage.tsxに追記**

`SettingsPage`関数内、既存の`retentionQuery`等の隣に追加:

```tsx
  const displaySettingsQuery = useQuery({
    ...trpc.logging.getDisplaySettings.queryOptions({ guildId: guildId ?? "" }),
    enabled: Boolean(guildId),
  });
  const displaySettingsMutation = useMutation({
    ...trpc.logging.setDisplaySetting.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: trpc.logging.getDisplaySettings.queryOptions({ guildId: guildId ?? "" }).queryKey,
      }),
  });
```

`queries`配列に`displaySettingsQuery`を追加:

```tsx
  const queries = [retentionQuery, channelSettingsQuery, channelOptionsQuery, displaySettingsQuery];
```

一括設定ブロックの中(`<div className="flex flex-col gap-4 rounded-lg border p-4">`内、`BulkChannelControl`の下)に追加:

```tsx
            {displaySettingsQuery.data && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!displaySettingsQuery.data.hideAuditLogCorrelation}
                  disabled={displaySettingsMutation.isPending}
                  onChange={(e) =>
                    displaySettingsMutation.mutate({
                      guildId,
                      hideAuditLogCorrelation: !e.target.checked,
                    })
                  }
                />
                ログ一覧に「監査ログ相関」カテゴリを表示する
              </label>
            )}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cd apps/dashboard-web && bun test src/pages/SettingsPage.test.tsx`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add apps/dashboard-web/src/pages/SettingsPage.tsx apps/dashboard-web/src/pages/SettingsPage.test.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): 監査ログ相関の一覧表示/非表示を切り替えるトグルを追加

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Bot REST APIでのユーザー名解決関数(dashboard-api)

**Files:**
- Modify: `apps/dashboard-api/src/discord/bot-client.ts`
- Create: `apps/dashboard-api/src/discord/bot-client.test.ts`(既存になければ新規)

**Interfaces:**
- Produces: `fetchGuildMemberNames(botToken: string, guildId: string, userIds: readonly string[]): Promise<Map<string, string>>` — 各userIdについてBot REST(`GET /guilds/{guildId}/members/{userId}`)を並列に叩き、表示名(`nick` > `global_name` > `username`)を解決する。404(脱退済み等)はMapに含めない(呼び出し側でIDフォールバック)。

- [ ] **Step 1: 既存テストファイルの有無を確認**

Run: `ls apps/dashboard-api/src/discord/*.test.ts` (Bashツールで確認)。既存になければ新規作成、既存の`channel-permissions.test.ts`と同じテスト基盤(fetchのモック方法)を確認する。

- [ ] **Step 2: fetchのモック方法を確認**

Read `apps/dashboard-api/src/discord/channel-permissions.test.ts`(もしfetchをモックしていなければ、`bot-client.ts`内の`discordGet`がグローバル`fetch`を直接呼ぶ構造なので、`bun:test`の`mock.module`や`global.fetch`差し替えパターンで書く)。既存に`bot-client`用のテストが無い場合は、シンプルに`global.fetch`を一時差し替えるテストを書く。

- [ ] **Step 3: 失敗するテストを書く**

```typescript
// apps/dashboard-api/src/discord/bot-client.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { fetchGuildMemberNames } from "./bot-client.js";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe("fetchGuildMemberNames", () => {
  test("nickがあればnickを使う", async () => {
    global.fetch = (async (url: string) => {
      expect(url).toContain("/guilds/g1/members/u1");
      return new Response(
        JSON.stringify({ nick: "ニックネーム", user: { username: "user1", global_name: "User One" } }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await fetchGuildMemberNames("token", "g1", ["u1"]);
    expect(result.get("u1")).toBe("ニックネーム");
  });

  test("nickがなければglobal_nameを使う", async () => {
    global.fetch = (async () =>
      new Response(
        JSON.stringify({ nick: null, user: { username: "user1", global_name: "User One" } }),
        { status: 200 },
      )) as typeof fetch;

    const result = await fetchGuildMemberNames("token", "g1", ["u1"]);
    expect(result.get("u1")).toBe("User One");
  });

  test("nickもglobal_nameもなければusernameを使う", async () => {
    global.fetch = (async () =>
      new Response(JSON.stringify({ nick: null, user: { username: "user1", global_name: null } }), {
        status: 200,
      })) as typeof fetch;

    const result = await fetchGuildMemberNames("token", "g1", ["u1"]);
    expect(result.get("u1")).toBe("user1");
  });

  test("404(脱退済み等)はMapに含めない", async () => {
    global.fetch = (async () => new Response("", { status: 404 })) as typeof fetch;

    const result = await fetchGuildMemberNames("token", "g1", ["u1"]);
    expect(result.has("u1")).toBe(false);
  });

  test("複数IDを並列解決する", async () => {
    global.fetch = (async (url: string) => {
      const id = url.split("/").pop();
      return new Response(
        JSON.stringify({ nick: null, user: { username: `user-${id}`, global_name: null } }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await fetchGuildMemberNames("token", "g1", ["u1", "u2"]);
    expect(result.get("u1")).toBe("user-u1");
    expect(result.get("u2")).toBe("user-u2");
  });
});
```

- [ ] **Step 4: テストが失敗することを確認**

Run: `cd apps/dashboard-api && bun test src/discord/bot-client.test.ts`
Expected: FAIL(`fetchGuildMemberNames`が存在しない)

- [ ] **Step 5: bot-client.tsに実装を追加**

`apps/dashboard-api/src/discord/bot-client.ts`のスキーマ定義群に追加:

```typescript
const guildMemberWithUserSchema = z.object({
  nick: z.string().nullable().optional(),
  user: z.object({
    username: z.string(),
    global_name: z.string().nullable().optional(),
  }),
});
```

ファイル末尾に関数を追加:

```typescript
/**
 * 指定したuserIdごとにguild memberを引き、表示名(サーバーニックネーム > global_name > username)を
 * 解決する。並列にfetchするが、userIds件数はダッシュボードの1ページ(最大100件)内のユニークID数程度に
 * 収まる前提(ponytail: 大量呼び出しへのレート制限対策は現時点で行わない)。
 * 脱退済み等で404の場合はMapに含めない(呼び出し側でIDそのまま表示にフォールバックする)。
 */
export async function fetchGuildMemberNames(
  botToken: string,
  guildId: string,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  const entries = await Promise.all(
    userIds.map(async (userId) => {
      const member = await discordGet(
        botToken,
        `/guilds/${guildId}/members/${userId}`,
        guildMemberWithUserSchema,
      );
      if (member === "not_found") return undefined;
      const name = member.nick || member.user.global_name || member.user.username;
      return [userId, name] as const;
    }),
  );
  return new Map(entries.filter((entry): entry is readonly [string, string] => entry !== undefined));
}
```

- [ ] **Step 6: テストが通ることを確認**

Run: `cd apps/dashboard-api && bun test src/discord/bot-client.test.ts`
Expected: PASS(5件)

- [ ] **Step 7: typecheck**

Run: `cd apps/dashboard-api && bun run typecheck`
Expected: エラーなし

- [ ] **Step 8: コミット**

```bash
git add apps/dashboard-api/src/discord/bot-client.ts apps/dashboard-api/src/discord/bot-client.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard-api): Bot REST APIでguildメンバーの表示名を解決する関数を追加

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: DashboardAccessContextへのgetGuildMemberNames追加とrouter procedure新設

**Files:**
- Modify: `packages/dashboard-access/src/trpc.ts`
- Modify: `apps/dashboard-api/src/context.ts`
- Modify: `packages/logging/src/router/index.ts`
- Modify: `packages/logging/src/router/index.test.ts`

**Interfaces:**
- Consumes: `fetchGuildMemberNames`(Task 8)
- Produces: `DashboardAccessContext.getGuildMemberNames: (guildId: string, userIds: readonly string[]) => Promise<ReadonlyMap<string, string>>`。tRPC procedure `logging.resolveDisplayNames(input: {guildId, userIds, channelIds}) => {users: Record<string,string>, channels: Record<string,string>}`。

- [ ] **Step 1: DashboardAccessContextに型を追加**

`packages/dashboard-access/src/trpc.ts`の`DashboardAccessContext`インターフェースに追記:

```typescript
  /**
   * 指定したdiscordユーザーIDごとの表示名(サーバーニックネーム優先)を解決する。
   * ダッシュボードのログ一覧でユーザーIDをそのまま見せず名前表示するために使う。
   * 解決できなかったID(脱退済み等)はMapに含めない。dashboard-api側でDiscord APIから供給する。
   */
  getGuildMemberNames: (guildId: string, userIds: readonly string[]) => Promise<ReadonlyMap<string, string>>;
```

- [ ] **Step 2: context.tsに実装を追加**

`apps/dashboard-api/src/context.ts`の`import`に`fetchGuildMemberNames`を追加:

```typescript
import { fetchGuildChannels, fetchGuildMemberNames } from "./discord/bot-client.js";
```

`createGetGuildChannels`の隣に関数を追加:

```typescript
function createGetGuildMemberNames(
  botToken: string,
): (guildId: string, userIds: readonly string[]) => Promise<ReadonlyMap<string, string>> {
  return (guildId, userIds) => fetchGuildMemberNames(botToken, guildId, userIds);
}
```

`createContext`内の`ctx`オブジェクトに追加:

```typescript
      getGuildMemberNames: createGetGuildMemberNames(botToken),
```

- [ ] **Step 3: routerテストで新procedureのテストを書く**

Read `packages/logging/src/router/index.test.ts` の既存の`listChannelOptions`テストパターンを確認し、同様の形で以下を追加:

```typescript
test("resolveDisplayNamesはgetGuildMemberNames/getGuildChannelsを介してid→nameを返す", async () => {
  // 既存パターンでctx.getGuildMemberNames/ctx.getGuildChannelsをモックし、
  // caller.resolveDisplayNames({guildId, userIds: ["u1"], channelIds: ["c1"]})の結果を検証
  // 期待値: { users: { u1: "解決された名前" }, channels: { c1: "解決されたチャンネル名" } }
});
```

- [ ] **Step 4: テストが失敗することを確認**

Run: `cd packages/logging && bun test src/router/index.test.ts`
Expected: FAIL(`resolveDisplayNames`が存在しない)

- [ ] **Step 5: router/index.tsにprocedureを追加**

```typescript
const resolveDisplayNamesInput = z.object({
  guildId: z.string().min(1),
  userIds: z.array(z.string()).default([]),
  channelIds: z.array(z.string()).default([]),
});
```

router定義末尾に追加:

```typescript
  resolveDisplayNames: protectedProcedure
    .input(resolveDisplayNamesInput)
    .use(requireCapability(CAPABILITIES.VIEW_LOGS))
    .query(async ({ ctx, input }) => {
      const uniqueUserIds = [...new Set(input.userIds)];
      const [userNames, channels] = await Promise.all([
        uniqueUserIds.length > 0
          ? ctx.getGuildMemberNames(input.guildId, uniqueUserIds)
          : Promise.resolve(new Map<string, string>()),
        ctx.getGuildChannels(input.guildId),
      ]);
      const channelNameById = new Map(channels.map((c) => [c.id, c.name]));
      const wantedChannelIds = new Set(input.channelIds);

      return {
        users: Object.fromEntries(userNames),
        channels: Object.fromEntries(
          [...channelNameById].filter(([id]) => wantedChannelIds.has(id)),
        ),
      };
    }),
```

**注意:** `ctx.getGuildChannels`は既存実装(`fetchGuildChannels`)がBot送信可能チャンネルのみにフィルタしている。アーカイブ済み/送信不可チャンネルの名前は解決できない可能性がある。これは既知の制約として許容する(ponytail: 表示専用の全チャンネル取得関数を別途作るのは今回はやらない。解決できなければ呼び出し側でIDにフォールバックするため実害は「一部IDのまま表示される」に留まる)。

- [ ] **Step 6: テストが通ることを確認**

Run: `cd packages/logging && bun test src/router/index.test.ts`
Expected: PASS

- [ ] **Step 7: 依存パッケージのtypecheckを一通り実行**

Run: `cd packages/dashboard-access && bun run typecheck`
Run: `cd apps/dashboard-api && bun run typecheck`
Run: `cd packages/logging && bun run typecheck`
Expected: いずれもエラーなし

- [ ] **Step 8: コミット**

```bash
git add packages/dashboard-access/src/trpc.ts apps/dashboard-api/src/context.ts packages/logging/src/router/index.ts packages/logging/src/router/index.test.ts
git commit -m "$(cat <<'EOF'
feat(logging): ユーザーID/チャンネルIDの表示名を解決するprocedureを追加

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: LogListPageで名前解決を使い、実行者列/チャンネルをID表示から名前表示に変える

**Files:**
- Modify: `apps/dashboard-web/src/pages/LogListPage.tsx`
- Modify: `apps/dashboard-web/src/pages/LogListPage.test.tsx`

**Interfaces:**
- Consumes: tRPC `logging.resolveDisplayNames`(Task 9)、`LogEntrySummary.subjectId`(Task 2)

**方針:** 一覧取得後、表示されている行から「ユーザーIDらしきsubjectId」と「チャンネルID」を集めて`resolveDisplayNames`を1回呼び、返ってきたid→nameのRecordをテーブル描画時に参照する。チャンネルIDは現状メインカラムに出していない(詳細JSON内のみ)ため、このタスクでは「実行者列」の名前解決のみ行う(チャンネル名表示はスコープ外の詳細JSON内なので対象外、というユーザー合意に基づく)。

- [ ] **Step 1: 既存テストのモック方法を確認**

Read `apps/dashboard-web/src/pages/LogListPage.test.tsx` を全文読み、`trpc.logging.listLogEntries`のモック方法を確認する。

- [ ] **Step 2: 失敗するテストを書く**

既存パターンに倣い、以下を追加:

```typescript
test("実行者列にsubjectIdの表示名(resolveDisplayNamesの結果)が表示される", async () => {
  // listLogEntriesが{entries: [{id: "1", entry: {category: "message", ..., authorId: "u1", action: "delete"}}], nextCursor: null}を返すモック
  // resolveDisplayNamesが{users: {u1: "テストユーザー"}, channels: {}}を返すモック
  // レンダリング後、"テストユーザー"がテーブルに表示されることを確認(IDの"u1"がそのまま表示されないこと)
});

test("名前解決できないIDはそのままID表示にフォールバックする", async () => {
  // resolveDisplayNamesがusers: {}を返すモック(該当ユーザーが名前解決不可)
  // 実行者列に元のID文字列がそのまま表示されることを確認
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `cd apps/dashboard-web && bun test src/pages/LogListPage.test.tsx`
Expected: FAIL

- [ ] **Step 4: LogListPage.tsxを修正**

`useQuery`のimportの下に追加するロジック。まず`logsQuery.data`から一意な`subjectId`一覧を集める:

```tsx
  const subjectIds = logsQuery.data
    ? [...new Set(logsQuery.data.entries.map(({ entry }) => summarizeLogEntry(entry).subjectId).filter((id): id is string => id !== null))]
    : [];

  const namesQuery = useQuery({
    ...trpc.logging.resolveDisplayNames.queryOptions({
      guildId: guildId ?? "",
      userIds: subjectIds,
      channelIds: [],
    }),
    enabled: Boolean(guildId) && subjectIds.length > 0,
  });
```

テーブル描画部分(148行目付近)を修正:

```tsx
                      <TableCell>
                        {summary.subjectId
                          ? (namesQuery.data?.users[summary.subjectId] ?? summary.subjectId)
                          : "-"}
                      </TableCell>
```

**注意:** `subjectIds`を`logsQuery.data`から毎レンダー計算すると`useQuery`の`queryKey`が配列の参照変化で毎回変わり無限リフェッチしかねない。`subjectIds`は`useMemo`で安定化すること:

```tsx
  const subjectIds = useMemo(
    () =>
      logsQuery.data
        ? [...new Set(logsQuery.data.entries.map(({ entry }) => summarizeLogEntry(entry).subjectId).filter((id): id is string => id !== null))]
        : [],
    [logsQuery.data],
  );
```

`useMemo`を`react`のimportに追加すること: `import { useMemo, useRef, useState } from "react";`

- [ ] **Step 5: テストが通ることを確認**

Run: `cd apps/dashboard-web && bun test src/pages/LogListPage.test.tsx`
Expected: PASS

- [ ] **Step 6: 手動でダッシュボードUIを起動して確認**

CLAUDE.mdの方針(Dashboard UI変更時は手動確認必須)に従い、ローカルでdashboard-web/dashboard-apiを起動し、実際にログ一覧画面を開いて実行者列がユーザー名で表示されること、名前解決できないIDはID文字列にフォールバックすることを目視確認する。

- [ ] **Step 7: コミット**

```bash
git add apps/dashboard-web/src/pages/LogListPage.tsx apps/dashboard-web/src/pages/LogListPage.test.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): ログ一覧の実行者列をDiscordのユーザー名で表示

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: 全体テスト・lint・typecheckの通し確認とcodexレビュー依頼

**Files:** なし(検証のみ)

- [ ] **Step 1: リポジトリ全体のtest/lint/typecheckを実行**

Run: `bun test` (リポジトリルート、workspace全体)
Run: `bun run lint`(全workspace)
Run: `bun run typecheck`(全workspace)
Expected: すべてPASS

- [ ] **Step 2: 差分を確認**

Run: `git status` / `git diff --stat`
Issue #84の3項目(実行者フォールバック、名前解決、監査ログ相関除外設定)がすべて反映されていることを確認する。

- [ ] **Step 3: codexレビューを依頼する**

ユーザーのグローバル指示により、コード実装完了後は必ずcodexにレビューを依頼すること。`codex-review`スキルを起動する。

- [ ] **Step 4: レビュー指摘への対応**

指摘があれば修正し、対応内容を1コミットにまとめる(既存の履歴パターン「fix(dashboard): codexレビュー対応(...)」に倣う)。

---

## Self-Review Notes

- **Spec coverage:** Issue #84の3項目(実行者フォールバック=Task1-3、名前解決=Task8-10、監査ログ相関除外=Task4-7)を全てカバー。スコープ外(詳細JSON内ID解決、削除実行者の監査ログ拡張)には触れていない。
- **Placeholder scan:** 各タスクのコードは実装コードを明記。Task 2/9/10のテストは一部「既存パターンに倣う」形で完全なコードを書き切っていない箇所があるが、これは対象ファイルの既存内容(実行時に読む前提)に強く依存するテストのため、実行者が既存ファイルを読んでから具体化する設計としている(モックライブラリの有無等が未確認のため)。実装コード(本体ロジック)は全タスクで完全に記述済み。
- **Type consistency:** `LogEntrySummary.subjectId`(Task2で定義)を Task3/Task10で一貫して使用。`getLogEntrySubjectId`(Task1で定義)をTask2で使用。`fetchGuildMemberNames`(Task8)を`getGuildMemberNames`(Task9)経由でTask10まで一貫した型(`ReadonlyMap<string,string>`→`Record<string,string>`)で受け渡し。
