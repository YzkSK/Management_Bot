# Raid Kick and New-Account Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kick all raid-window entrants with a best-effort DM and make new-account detection non-punitive.

**Architecture:** Simplify raid presets to detection thresholds and replace per-member timeout with sequential kick-then-DM. New-account guard remains a threshold and history signal but does not create strike or moderation-action events.

**Tech Stack:** TypeScript, discord.js, Redis, Bun test.

---

### Task 1: Simplify raid and new-account domain behavior

**Files:**
- Modify: `packages/moderation/src/domain/presets.ts`
- Modify: `packages/moderation/src/domain/raid.ts`
- Modify: `packages/moderation/src/application/guild-member-add.ts`
- Modify: `packages/moderation/src/domain/raid.test.ts`
- Modify: `packages/moderation/src/application/guild-member-add.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
expect(detectRaid(buffer, now, RAID_PRESETS.medium).targetUserIds).toEqual(["u1", "u2"]);
expect(result.newAccountGuardDetected).toBe(true);
expect(eventBus.published.filter((event) => event.incident.violationType === "new_account_guard")).toEqual([]);
```

- [ ] **Step 2: Remove severity/timeout fields from the raid preset and result**

```ts
export interface RaidPresetConfig { window: { windowSeconds: number; memberThreshold: number } }
export interface RaidHitResult { targetUserIds: readonly string[]; caseId: string; incidentCount: number; incident: RaidIncident }
```

- [ ] **Step 3: Make new-account guard observation-only**

Return `newAccountGuardDetected: boolean` from `handleGuildMemberAdd`; do not call `escalateAndRecordStrike` for it. Keep whitelist exclusion and its preset age test.

- [ ] **Step 4: Run and commit**

Run: `bun test packages/moderation/src/domain/raid.test.ts packages/moderation/src/application/guild-member-add.test.ts`

Commit: `refactor(moderation): make new account guard observational`

### Task 2: Kick raid targets and notify them by DM

**Files:**
- Modify: `packages/moderation/src/discord/handle-guild-member-add.ts`
- Modify: `packages/moderation/src/discord/handle-guild-member-add.test.ts`
- Modify: `packages/shared/src/domain-events.ts`
- Modify: `packages/shared/src/domain-events.test.ts`

- [ ] **Step 1: Write failing kick/DM tests**

```ts
expect(member.kick).toHaveBeenCalledWith(expect.stringContaining("raid detected"));
expect(member.user.send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("レイド対策") }));
expect(secondMember.kick).toHaveBeenCalled();
```

- [ ] **Step 2: Implement sequential `executeRaidKick`**

```ts
async function executeRaidKick(target: GuildMember, raidHit: RaidHitResult): Promise<ActionExecutionResult> {
  await target.kick(raidKickReason(raidHit.caseId, raidHit.incidentCount));
  void target.user.send(RAID_KICK_DM).catch((error) => console.warn("raid kick DM failed", error));
  return SUCCESS;
}
```

Await the DM attempt before returning only when testability requires it; catch its error and preserve a successful kick result. Continue through all fetched targets after each failure.

- [ ] **Step 3: Publish resolve events with `actionType: "kick"`**

Update raid create/resolve events and tests so dashboard history reports the actual enforcement action.

- [ ] **Step 4: Run and commit**

Run: `bun test packages/moderation/src/discord/handle-guild-member-add.test.ts packages/shared/src/domain-events.test.ts`

Commit: `feat(moderation): kick raid entrants and notify by dm`
