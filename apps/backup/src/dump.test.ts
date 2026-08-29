import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneOldDumps, timestampedFilename } from "./dump.js";

describe("timestampedFilename", () => {
  test("日時を含むファイル名を生成する", () => {
    const name = timestampedFilename(new Date("2026-01-02T03:04:05.000Z"));
    expect(name).toBe("management_bot-2026-01-02T03-04-05-000Z.sql.gz");
  });
});

describe("pruneOldDumps", () => {
  test("保持期間を過ぎたダンプファイルのみ削除する", async () => {
    const dir = await mkdtemp(join(tmpdir(), "backup-test-"));
    try {
      const oldFile = join(dir, "management_bot-old.sql.gz");
      const newFile = join(dir, "management_bot-new.sql.gz");
      await writeFile(oldFile, "old");
      await writeFile(newFile, "new");

      const now = new Date("2026-01-10T00:00:00.000Z");
      const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
      await utimes(oldFile, eightDaysAgo, eightDaysAgo);
      await utimes(newFile, now, now);

      await pruneOldDumps(dir, 7, now);

      const remaining = await Bun.file(newFile).exists();
      const removed = await Bun.file(oldFile).exists();
      expect(remaining).toBe(true);
      expect(removed).toBe(false);
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
