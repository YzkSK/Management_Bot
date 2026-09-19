# Fixed Moderation Preset UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove ineffective strength controls for NG-word and invite-link detection while preserving persisted settings.

**Architecture:** Keep all API and DB values unchanged. Dashboard identifies the two preset-independent violation types and renders a fixed explanatory label instead of a selector.

**Tech Stack:** TypeScript, React, Bun test.

---

### Task 1: Render preset-independent rows as fixed conditions

**Files:**
- Modify: `apps/dashboard-web/src/pages/moderation-labels.ts`
- Modify: `apps/dashboard-web/src/pages/ModerationPage.tsx`
- Modify: `apps/dashboard-web/src/pages/ModerationPage.test.tsx`

- [ ] **Step 1: Write failing UI tests**

```tsx
expect(screen.queryByLabelText("NGワードの強度")).toBeNull();
expect(screen.queryByLabelText("招待リンクの強度")).toBeNull();
expect(screen.getAllByText("強度共通")).toHaveLength(2);
expect(screen.getByLabelText("連投の強度")).toBeVisible();
```

- [ ] **Step 2: Add an explicit predicate**

```ts
export function isPresetIndependentViolationType(type: ModerationViolationType): boolean {
  return type === "ngword" || type === "invite_link";
}
```

- [ ] **Step 3: Replace only those selects**

In `ThresholdTableRow`, render `強度共通` plus the medium condition tooltip when the predicate is true. Do not call `setThreshold` for that cell; retain the row's stored preset for future compatibility.

- [ ] **Step 4: Run and commit**

Run: `bun test apps/dashboard-web/src/pages/ModerationPage.test.tsx`

Commit: `fix(dashboard): hide fixed moderation preset controls`
