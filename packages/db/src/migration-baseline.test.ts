import { describe, expect, test } from "bun:test";
import { decideBaseline } from "./migration-baseline.js";

describe("decideBaseline", () => {
  test("uses normal migration for an empty database", () => {
    expect(
      decideBaseline({ hasJournal: false, hasApplicationTables: false, matchesLegacyMain: false }),
    ).toBe("migrate");
  });

  test("uses normal migration when a journal already exists", () => {
    expect(
      decideBaseline({ hasJournal: true, hasApplicationTables: true, matchesLegacyMain: false }),
    ).toBe("migrate");
  });

  test("baselines a verified legacy main database", () => {
    expect(
      decideBaseline({ hasJournal: false, hasApplicationTables: true, matchesLegacyMain: true }),
    ).toBe("baseline-and-migrate");
  });

  test("rejects an unverified non-empty database", () => {
    expect(() =>
      decideBaseline({ hasJournal: false, hasApplicationTables: true, matchesLegacyMain: false }),
    ).toThrow("does not match main migration 0016");
  });
});
