import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listDumps, pruneOldDumps, timestampedFilename } from "./dump.js";

describe("listDumps", () => {
  test("ダンプファイルのみを新しい順に返す", async () => {
    const dir = await mkdtemp(join(tmpdir(), "backup-test-"));
    try {
      const older = join(dir, "management_bot-a.sql.gz.age");
      const newer = join(dir, "management_bot-b.sql.gz");
      await writeFile(older, "12345");
      await writeFile(newer, "123");
      await writeFile(join(dir, "other.sql.gz"), "x");
      await mkdir(join(dir, "management_bot-dir.sql.gz"));
      await utimes(older, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"));
      await utimes(newer, new Date("2026-01-02T00:00:00.000Z"), new Date("2026-01-02T00:00:00.000Z"));

      expect(await listDumps(dir)).toEqual([
        { name: "management_bot-b.sql.gz", sizeBytes: 3, createdAt: "2026-01-02T00:00:00.000Z" },
        { name: "management_bot-a.sql.gz.age", sizeBytes: 5, createdAt: "2026-01-01T00:00:00.000Z" },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("timestampedFilename", () => {
  test("日時を含むファイル名を生成する", () => {
    const name = timestampedFilename(new Date("2026-01-02T03:04:05.000Z"));
    expect(name).toBe("management_bot-2026-01-02T03-04-05-000Z.sql.gz.age");
  });
});

describe("pruneOldDumps", () => {
  test("保持期間を過ぎたダンプファイルのみ削除する", async () => {
    const dir = await mkdtemp(join(tmpdir(), "backup-test-"));
    try {
      const oldFile = join(dir, "management_bot-old.sql.gz.age");
      const oldLegacyFile = join(dir, "management_bot-old-legacy.sql.gz");
      const newFile = join(dir, "management_bot-new.sql.gz.age");
      const newLegacyFile = join(dir, "management_bot-new-legacy.sql.gz");
      await writeFile(oldFile, "old");
      await writeFile(oldLegacyFile, "old");
      await writeFile(newFile, "new");
      await writeFile(newLegacyFile, "new");

      const now = new Date("2026-01-10T00:00:00.000Z");
      const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
      await utimes(oldFile, eightDaysAgo, eightDaysAgo);
      await utimes(oldLegacyFile, eightDaysAgo, eightDaysAgo);
      await utimes(newFile, now, now);
      await utimes(newLegacyFile, now, now);

      await pruneOldDumps(dir, 7, now);

      expect(await Bun.file(newFile).exists()).toBe(true);
      expect(await Bun.file(newLegacyFile).exists()).toBe(true);
      expect(await Bun.file(oldFile).exists()).toBe(false);
      expect(await Bun.file(oldLegacyFile).exists()).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("management_bot-プレフィックスを持たない.sql.gzは無視する", async () => {
    const dir = await mkdtemp(join(tmpdir(), "backup-test-"));
    try {
      const otherDump = join(dir, "other-service.sql.gz");
      await writeFile(otherDump, "keep me");
      const old = new Date("2000-01-01");
      await utimes(otherDump, old, old);

      await pruneOldDumps(dir, 1, new Date());

      expect(await Bun.file(otherDump).exists()).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("ディレクトリは削除対象にしない", async () => {
    const dir = await mkdtemp(join(tmpdir(), "backup-test-"));
    try {
      const subdir = join(dir, "management_bot-old.sql.gz");
      await mkdir(subdir);
      const old = new Date("2000-01-01");
      await utimes(subdir, old, old);

      await pruneOldDumps(dir, 1, new Date());

      expect(await stat(subdir).then((s) => s.isDirectory())).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
