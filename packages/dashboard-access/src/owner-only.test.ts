import { describe, expect, test } from "bun:test";
import { CAPABILITIES, OWNER_ONLY_CAPABILITIES } from "@management-bot/shared";
import { assertOwnerForOwnerOnlyChange } from "./router.js";

const OWNER_BIT = CAPABILITIES.VIEW_AUDIT_LOG;
const OTHER = CAPABILITIES.VIEW_LOGS;

function isForbidden(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return typeof e === "object" && e !== null && "code" in e && e.code === "FORBIDDEN";
  }
}

describe("assertOwnerForOwnerOnlyChange", () => {
  test("VIEW_AUDIT_LOGはオーナー専用capabilityである", () => {
    expect(OWNER_ONLY_CAPABILITIES & OWNER_BIT).toBe(OWNER_BIT);
  });

  test("非オーナーがオーナー専用bitを付与するとFORBIDDEN", () => {
    expect(isForbidden(() => assertOwnerForOwnerOnlyChange(false, 0, OWNER_BIT))).toBe(true);
    expect(isForbidden(() => assertOwnerForOwnerOnlyChange(false, OTHER, OTHER | OWNER_BIT))).toBe(true);
  });

  test("非オーナーが既存のオーナー専用bitを外す・剥奪するとFORBIDDEN", () => {
    expect(isForbidden(() => assertOwnerForOwnerOnlyChange(false, OWNER_BIT | OTHER, OTHER))).toBe(true);
    expect(isForbidden(() => assertOwnerForOwnerOnlyChange(false, OWNER_BIT, 0))).toBe(true);
  });

  test("非オーナーでもオーナー専用bitが変わらない更新は許可される", () => {
    expect(isForbidden(() => assertOwnerForOwnerOnlyChange(false, OWNER_BIT | OTHER, OWNER_BIT))).toBe(false);
    expect(isForbidden(() => assertOwnerForOwnerOnlyChange(false, 0, OTHER))).toBe(false);
  });

  test("オーナーは付与・剥奪できる", () => {
    expect(isForbidden(() => assertOwnerForOwnerOnlyChange(true, 0, OWNER_BIT))).toBe(false);
    expect(isForbidden(() => assertOwnerForOwnerOnlyChange(true, OWNER_BIT, 0))).toBe(false);
  });
});
