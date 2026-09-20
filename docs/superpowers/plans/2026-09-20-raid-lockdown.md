# Raid Lockdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support automatic and manual guild lockdown, block `@everyone` posting, kick human joiners while locked, and restore permissions from Dashboard.

**Architecture:** Store desired and applied guild lockdown state plus a per-channel `@everyone` SendMessages snapshot in PostgreSQL. Dashboard requests manual state changes through the capability-protected router; the Bot observes DB notifications and applies Discord permissions, while automatic raid handling calls the same focused service directly.

**Tech Stack:** TypeScript, Drizzle/PostgreSQL, discord.js, tRPC, React, Bun test.

---

### Task 1: Add persistent lockdown state and snapshots

**Files:**
- Modify: `packages/db/src/schema/moderation.ts`
- Create: `packages/db/drizzle/0023_<generated_name>.sql`
- Create: `packages/moderation/src/application/lockdown-state.ts`
- Test: `packages/moderation/src/application/lockdown-state.db.test.ts`

- [ ] **Step 1: Write failing DB tests**

```ts
await activateLockdown(db, guildId, snapshots);
expect(await getLockdownState(db, guildId)).toMatchObject({ isLocked: true });
expect(await takeLockdownSnapshots(db, guildId)).toEqual(snapshots);
```

- [ ] **Step 2: Add settings, active state, and snapshots tables**

```ts
export const moderationLockdownSettings = pgTable("moderation_lockdown_settings", {
  guildId: text("guild_id").primaryKey().references(() => guilds.id, { onDelete: "cascade" }),
  autoLockdownOnRaid: boolean("auto_lockdown_on_raid").notNull().default(false),
  requestedLocked: boolean("requested_locked").notNull().default(false),
  isLocked: boolean("is_locked").notNull().default(false),
});
export const moderationLockdownChannelSnapshots = pgTable("moderation_lockdown_channel_snapshots", {
  guildId: text("guild_id").notNull().references(() => guilds.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull(),
  hadEveryoneOverwrite: boolean("had_everyone_overwrite").notNull(),
  sendMessages: boolean("send_messages"),
}, (table) => [primaryKey({ columns: [table.guildId, table.channelId] })]);
```

Generate the migration with `bun --cwd packages/db run db:generate`.

- [ ] **Step 3: Implement idempotent state operations**

`requestLockdownState` changes only `requestedLocked`; `activateLockdown` must not overwrite existing snapshots when already locked. `releaseLockdown` returns and clears snapshots in one transaction before setting `isLocked=false`.

- [ ] **Step 4: Run and commit**

Run: `bun test packages/moderation/src/application/lockdown-state.db.test.ts`

Commit: `feat(moderation): persist lockdown state`

### Task 2: Apply and restore Discord permissions

**Files:**
- Create: `packages/moderation/src/discord/lockdown.ts`
- Test: `packages/moderation/src/discord/lockdown.test.ts`
- Modify: `packages/moderation/src/discord/index.ts`

- [ ] **Step 1: Write failing permission tests**

```ts
await startGuildLockdown(deps, guild);
expect(channel.permissionOverwrites.edit).toHaveBeenCalledWith(guild.id, { SendMessages: false });
await releaseGuildLockdown(deps, guild);
expect(channel.permissionOverwrites.edit).toHaveBeenCalledWith(guild.id, { SendMessages: null });
```

- [ ] **Step 2: Implement channel filtering and snapshot application**

Operate only on guild text-based channels. Read the existing `@everyone` overwrite's existence and `SendMessages` value as `true`, `false`, or `null`, persist snapshots, then set `false`.

- [ ] **Step 3: Implement release and new-channel enforcement**

Restore each saved value with `permissionOverwrites.delete(guildId)` when `hadEveryoneOverwrite=false`, otherwise `permissionOverwrites.edit(guildId, { SendMessages: savedValue })`. When a text channel is created while `isLocked`, snapshot and deny it using the same service.

- [ ] **Step 4: Run and commit**

Run: `bun test packages/moderation/src/discord/lockdown.test.ts packages/moderation/src/discord/index.test.ts`

Commit: `feat(moderation): apply and restore lockdown permissions`

### Task 3: Start automatically and enforce join blocking

**Files:**
- Modify: `packages/moderation/src/discord/handle-guild-member-add.ts`
- Modify: `packages/moderation/src/discord/handle-guild-member-add.test.ts`
- Modify: `packages/moderation/src/discord/index.ts`

- [ ] **Step 1: Write failing tests for requested-state reconciliation**

```ts
await handleGuildMemberAddEvent(deps, joiningMember);
expect(joiningMember.kick).toHaveBeenCalledWith(expect.stringContaining("lockdown"));
expect(startGuildLockdown).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Check lock state before normal member processing**

For human users, kick and return when already locked. Do not run detection or whitelist logic after that. Bot accounts return without action.

- [ ] **Step 3: Trigger automatic start and reconcile Dashboard requests**

If `autoLockdownOnRaid` is true, start the service once per new `raidHit`; keep the existing kick enforcement independent. Add a `listenForModerationLockdownChanges` DB notification subscription at Bot startup, and reconcile `requestedLocked` to the Discord service. Reconcile all requested states once at Bot startup so a request made while the Bot was offline is applied.

- [ ] **Step 4: Run and commit**

Run: `bun test packages/moderation/src/discord/handle-guild-member-add.test.ts`

Commit: `feat(moderation): enforce lockdown on joins`

### Task 4: Add Dashboard setting and controls

**Files:**
- Modify: `packages/moderation/src/router/index.ts`
- Modify: `packages/moderation/src/router/index.test.ts`
- Modify: `apps/dashboard-web/src/pages/ModerationPage.tsx`
- Modify: `apps/dashboard-web/src/pages/ModerationPage.test.tsx`

- [ ] **Step 1: Write failing router tests for authorization and transitions**

```ts
await expect(caller.setLockdown({ guildId, isLocked: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
expect(await managerCaller.getLockdown({ guildId })).toEqual({ autoLockdownOnRaid: false, isLocked: false });
```

- [ ] **Step 2: Add `getLockdown`, `setAutoLockdownOnRaid`, `requestLockdown`, and `releaseLockdown` procedures**

Require existing moderation-settings management capability for all mutations. The request/release procedures update `requestedLocked` only; the Bot applies Discord changes after the DB notification. Return both requested and applied state so the UI can show a pending transition.

- [ ] **Step 3: Add Dashboard controls and tests**

Render an automatic-mode switch, requested/applied status, a destructive `ロックダウン開始` button when inactive, and `解除` when active. Invalidate the query after each successful mutation and show `適用中` until requested and applied state match.

- [ ] **Step 4: Run and commit**

Run: `bun test packages/moderation/src/router/index.test.ts apps/dashboard-web/src/pages/ModerationPage.test.tsx`

Commit: `feat(dashboard): manage raid lockdown`

### Task 5: Run end-to-end verification

**Files:**
- Test: `apps/bot/src/moderation-logging-integration.test.ts`

- [ ] **Step 1: Add an integration scenario**

Verify a raid with auto-lockdown stores active state, applies channel denial, and records the moderation action without duplicating notifications.

- [ ] **Step 2: Run focused and full checks**

Run: `bun run lint`

Run: `bun run typecheck`

Run: `bun run test -- --concurrency=1`

- [ ] **Step 3: Commit**

Commit: `test: cover raid lockdown flow`
