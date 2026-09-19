import { describe, expect, test } from "bun:test";
import {
  decideBaseline,
  loadLegacyMainJournalEntries,
  loadLegacyMainManifest,
} from "./migration-baseline.js";

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

describe("legacy main metadata", () => {
  test("loads the frozen main schema manifest", async () => {
    const manifest = await loadLegacyMainManifest();

    expect(manifest.tableNames).toContain("guilds");
    expect(manifest.tableNames).toContain("moderation_thresholds");
    expect(manifest.tableNames).not.toContain("moderation_ngwords");
  });

  test("uses the exact Drizzle hashes through main migration 0016", async () => {
    const entries = await loadLegacyMainJournalEntries();

    expect(entries).toHaveLength(17);
    expect(entries.at(-1)).toEqual({
      tag: "0016_remove_messagedelete_action_type",
      when: 1789538989056,
      hash: "ea0cc77d10896073ee702959a895bc5a7bcfdbc4c81f49eae9224c384699afec",
    });
  });
});
