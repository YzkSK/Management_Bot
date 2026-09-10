# Dashboard Query Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop retrying permanent dashboard query failures while retaining retries for transient failures.

**Architecture:** Add the retry policy to the single dashboard `QueryClient` factory. The predicate keeps React Query's three-retry limit and rejects known permanent tRPC client errors before another request is made.

**Tech Stack:** TypeScript, TanStack React Query, tRPC, Bun Test.

---

### Task 1: Shared dashboard retry policy

**Files:**
- Modify: `apps/dashboard-web/src/dashboard-query-client.ts`
- Test: `apps/dashboard-web/src/dashboard-query-client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
expect(shouldRetryDashboardQuery(0, forbiddenError())).toBe(false);
expect(shouldRetryDashboardQuery(0, internalServerError())).toBe(true);
expect(shouldRetryDashboardQuery(3, internalServerError())).toBe(false);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/dashboard-web/src/dashboard-query-client.test.ts`
Expected: FAIL because `shouldRetryDashboardQuery` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
export function shouldRetryDashboardQuery(failureCount: number, error: unknown): boolean {
  return failureCount < 3 && !isPermanentClientError(error);
}
```

Use a `TRPCClientError` error-code set for permanent client failures and configure it as the shared `QueryClient` query `retry` predicate.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/dashboard-web/src/dashboard-query-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

Run: `bun run lint && bun run typecheck && bun test`

Commit: `fix(dashboard-web): skip retries for permanent query errors`
