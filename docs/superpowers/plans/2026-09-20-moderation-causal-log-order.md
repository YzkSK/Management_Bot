# Moderation Causal Log Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relate a moderation case to its gateway bulk-delete log and render it as one ordered Dashboard group.

**Architecture:** Persist a short-lived message-ID-to-case-ID link before the moderation code calls Discord deletion. The logging handler consumes the link when it receives `messageDeleteBulk`, writes `moderationCaseId` into the aggregate log, and the list API returns `moderationCase → bulkDelete → message/create` nested entries.

**Tech Stack:** TypeScript, Bun, Drizzle/PostgreSQL, discord.js, tRPC, React.

---

### Task 1: Persist deletion-to-case links

**Files:**
- Modify: `packages/db/src/schema/moderation.ts`
- Create: `packages/db/drizzle/0022_<generated_name>.sql`
- Create: `packages/db/src/moderation-message-deletion-links.ts`
- Modify: `packages/moderation/src/discord/handle-message-create.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/moderation-message-deletion-links.db.test.ts`

- [ ] **Step 1: Write a failing DB test for create, lookup, and expiry**

```ts
test("caseId付き削除対象を保存し、期限切れの対応表は返さない", async () => {
  await recordModerationMessageDeletionLinks(db, { guildId, caseId: "case-1", messageIds: ["m1", "m2"] });
  expect(await findModerationCaseIdForDeletedMessages(db, guildId, ["m1", "m2"])).toBe("case-1");
  await expireLinks(db, guildId);
  expect(await findModerationCaseIdForDeletedMessages(db, guildId, ["expired"])).toBeNull();
});
```

- [ ] **Step 2: Run the test and confirm the import fails**

Run: `bun test packages/db/src/moderation-message-deletion-links.db.test.ts`

- [ ] **Step 3: Add the table and migration**

```ts
export const moderationMessageDeletionLinks = pgTable("moderation_message_deletion_links", {
  guildId: text("guild_id").notNull().references(() => guilds.id, { onDelete: "cascade" }),
  messageId: text("message_id").notNull(),
  caseId: text("case_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [primaryKey({ columns: [table.guildId, table.messageId] }), index("moderation_message_deletion_links_expiry_idx").on(table.expiresAt)]);
```

Generate with `bun --cwd packages/db run db:generate`; include the generated SQL and snapshot files.

- [ ] **Step 4: Implement link writing and lookup**

Export `recordModerationMessageDeletionLinks` and `findModerationCaseIdForDeletedMessages` from `@management-bot/db`. Use a 15-minute `expiresAt`, delete expired rows before writes and lookups, and return a case only when every deleted message maps to the same unexpired `caseId`.

- [ ] **Step 5: Record links before Discord deletion**

In `handleMessageCreate`, call `recordModerationMessageDeletionLinks(deps.db, { guildId, caseId: target.caseId, messageIds: mergedIds })` immediately before `executeEscalationAction`. If persistence fails, throw before the Discord API call.

- [ ] **Step 6: Run and commit**

Run: `bun test packages/db/src/moderation-message-deletion-links.db.test.ts packages/moderation/src/discord/handle-message-create.test.ts`

Commit: `feat(moderation): persist deletion case links`

### Task 2: Attach the case ID to gateway deletion logs

**Files:**
- Modify: `packages/shared/src/log-entry.ts`
- Modify: `packages/logging/src/discord/handlers/message.ts`
- Modify: `packages/logging/src/discord/handlers/message.test.ts`

- [ ] **Step 1: Write failing handler tests**

```ts
expect(toMessageBulkDeleteLogEntry(messages, BOT_ID, "case-1")).toMatchObject({
  action: "bulkDelete", moderationCaseId: "case-1",
});
```

- [ ] **Step 2: Add optional `moderationCaseId` only to aggregate `bulkDelete` schema**

```ts
moderationCaseId: nonEmptyString.optional(),
```

- [ ] **Step 3: Resolve the case before writing the gateway entry**

Call `findModerationCaseIdForDeletedMessages` from `@management-bot/db` in `registerMessageHandlers`; preserve the unlinked entry when it returns `null`.

- [ ] **Step 4: Run and commit**

Run: `bun test packages/logging/src/discord/handlers/message.test.ts packages/shared/src/log-entry.test.ts`

Commit: `feat(logging): link bulk deletion to moderation case`

### Task 3: Return causal nested log entries

**Files:**
- Modify: `packages/logging/src/application/list-log-entries.ts`
- Modify: `packages/logging/src/application/list-log-entries.db.test.ts`
- Modify: `packages/logging/src/router/index.ts`
- Modify: `packages/logging/src/router/index.test.ts`

- [ ] **Step 1: Write failing API/DB tests**

```ts
expect(result.entries).toEqual([
  expect.objectContaining({
    entry: expect.objectContaining({ category: "moderationCase", caseId: "case-1" }),
    collapsedEntries: [expect.objectContaining({ entry: expect.objectContaining({ action: "bulkDelete", moderationCaseId: "case-1" }) })],
  }),
]);
```

- [ ] **Step 2: Attach matching bulk logs to their moderation-case parent**

Extend `ListedLogEntry` recursively. Suppress `bulkDelete` entries with `moderationCaseId` at top level, fetch them for visible moderation-case parents, then retain their existing collapsed `message/create` children.

- [ ] **Step 3: Recursively mask descendants**

```ts
function maskListedEntry(item: ListedLogEntry): ListedLogEntry {
  return { ...item, entry: maskSensitiveFields(item.entry), collapsedEntries: item.collapsedEntries?.map(maskListedEntry) };
}
```

- [ ] **Step 4: Run and commit**

Run: `bun test packages/logging/src/application/list-log-entries.db.test.ts packages/logging/src/router/index.test.ts`

Commit: `feat(logging): nest moderated deletion logs`

### Task 4: Render nested causal groups in Dashboard

**Files:**
- Modify: `apps/dashboard-web/src/pages/LogListPage.tsx`
- Modify: `apps/dashboard-web/src/pages/LogListPage.test.tsx`

- [ ] **Step 1: Write failing UI tests for nested group order and names**

```tsx
expect(screen.getByText("system が mini への処分を実行しました")).toBeVisible();
expect(screen.getByRole("button", { name: "削除された投稿ログ（5件）" })).toBeVisible();
```

- [ ] **Step 2: Implement a recursive collapsed-entry renderer**

Render a `bulkDelete` child under its `moderationCase` parent, then use the existing collapsed message-create rendering under the bulk entry. Collect display-name IDs recursively.

- [ ] **Step 3: Run and commit**

Run: `bun test apps/dashboard-web/src/pages/LogListPage.test.tsx`

Commit: `feat(dashboard): group deletion under moderation case`
