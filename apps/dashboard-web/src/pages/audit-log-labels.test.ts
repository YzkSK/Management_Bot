import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUDIT_ACTION_LABELS,
  auditActionLabel,
  auditFeatureLabel,
  auditOutcomeLabel,
  dateInputToIso,
  periodToRange,
} from "./audit-log-labels.js";

describe("audit-log-labels", () => {
  test("既知のキーは日本語、未知のキーはそのまま返す", () => {
    expect(auditFeatureLabel("tempVoice")).toBe("一時VC");
    expect(auditFeatureLabel("custom")).toBe("custom");
    expect(auditOutcomeLabel("denied")).toBe("権限不足");
    expect(auditOutcomeLabel("pending")).toBe("結果不明");
    expect(auditActionLabel("scheduledPost", "cancel")).toBe("予約投稿を取り消し");
    expect(auditActionLabel("logging", "unknownAction")).toBe("unknownAction");
  });

  test("dateInputToIsoは終了日を翌日0時(排他的上限)にする。不正値はundefined", () => {
    const from = dateInputToIso("2026-10-10", false);
    const to = dateInputToIso("2026-10-10", true);
    expect(new Date(to ?? "").getTime() - new Date(from ?? "").getTime()).toBeGreaterThanOrEqual(23 * 3600_000);
    expect(dateInputToIso("", false)).toBeUndefined();
    expect(dateInputToIso("bad", true)).toBeUndefined();
  });

  test("periodToRangeは過去N日間を当日0時起点のN日分にする。すべては境界なし", () => {
    const now = new Date(2026, 9, 12, 15, 30);
    expect(periodToRange("all", "", "", now)).toEqual({ from: undefined, to: undefined });
    expect(periodToRange("today", "", "", now).from).toBe(new Date(2026, 9, 12).toISOString());
    expect(periodToRange("7d", "", "", now).from).toBe(new Date(2026, 9, 6).toISOString());
    expect(periodToRange("30d", "", "", now).from).toBe(new Date(2026, 8, 13).toISOString());
    expect(periodToRange("custom", "2026-10-01", "2026-10-03", now)).toEqual({
      from: dateInputToIso("2026-10-01", false),
      to: dateInputToIso("2026-10-03", true),
    });
  });

});

/** ルーターのソースから、`.mutation(`を持つprocedure名を取り出す(新しいmutationのラベル追加漏れを検知する)。 */
function mutationNames(relativePath: string): string[] {
  const source = readFileSync(join(import.meta.dir, "../../../../", relativePath), "utf8");
  const body = source.slice(source.search(/Router = router\(\{/));
  return body
    .split(/\n {2}(?=[A-Za-z])/)
    // requireGuildMemberのmutation(本人取り消し等)は操作履歴に記録しないのでラベル不要。
    .filter((segment) => segment.includes(".mutation(") && !segment.includes("requireGuildMember()"))
    .flatMap((segment) => {
      const name = /^(\w+):/.exec(segment)?.[1];
      return name === undefined ? [] : [name];
    });
}

describe("AUDIT_ACTION_LABELS", () => {
  const routers: [feature: string, path: string][] = [
    ["logging", "packages/logging/src/router/index.ts"],
    ["moderation", "packages/moderation/src/router/index.ts"],
    ["scheduledPost", "packages/scheduled-post/src/router/index.ts"],
    ["tempVoice", "packages/temp-voice/src/router/index.ts"],
    ["access", "packages/dashboard-access/src/router.ts"],
  ];

  for (const [feature, path] of routers) {
    test(`${feature}の全mutationに日本語ラベルがある`, () => {
      const names = mutationNames(path);
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        expect(AUDIT_ACTION_LABELS[`${feature}.${name}`]).toBeDefined();
      }
    });
  }

  test("存在しないmutationのラベルは残さない", () => {
    const existing = new Set(
      routers.flatMap(([feature, path]) => mutationNames(path).map((name) => `${feature}.${name}`)),
    );
    for (const key of Object.keys(AUDIT_ACTION_LABELS)) {
      expect(existing.has(key)).toBe(true);
    }
  });
});
