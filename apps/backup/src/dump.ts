import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { BackupFile } from "@management-bot/shared";

// 暗号化導入前の平文`.sql.gz`も保持期限で削除できるよう、両方を対象にする。
const DUMP_FILENAME_PATTERN = /^management_bot-.*\.sql\.gz(\.age)?$/;

export function timestampedFilename(now = new Date()): string {
  const iso = now.toISOString().replace(/[:.]/g, "-");
  return `management_bot-${iso}.sql.gz.age`;
}

export async function runPgDump(databaseUrl: string, outFile: string, recipient: string): Promise<void> {
  // set -eu + explicit rename: a gzip-only exit code would mask a failed pg_dump (empty stdin still gzips to exit 0).
  // 平文は一時ファイル(/tmp)にしか置かず、最終出力先にはage暗号化済みのものだけをmvする。
  const script = `
    set -eu
    tmp_raw=$(mktemp)
    tmp_gz=$(mktemp)
    tmp_age=$(mktemp)
    trap 'rm -f "$tmp_raw" "$tmp_gz" "$tmp_age"' EXIT
    pg_dump "$DATABASE_URL" --format=plain > "$tmp_raw"
    gzip -c "$tmp_raw" > "$tmp_gz"
    age -r "$AGE_RECIPIENT" "$tmp_gz" > "$tmp_age"
    mv "$tmp_age" "$OUT_FILE"
  `;
  const proc = Bun.spawn(["sh", "-c", script], {
    env: { ...process.env, DATABASE_URL: databaseUrl, OUT_FILE: outFile, AGE_RECIPIENT: recipient },
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`pg_dump failed (exit ${exitCode}): ${stderr}`);
  }
}

export async function pruneOldDumps(dir: string, retentionDays: number, now = new Date()): Promise<void> {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !DUMP_FILENAME_PATTERN.test(entry.name)) continue;
    const path = join(dir, entry.name);
    const info = await stat(path);
    if (info.mtimeMs < cutoff) {
      await unlink(path);
    }
  }
}

/** バックアップファイルを新しい順に返す(ダッシュボードの一覧表示用, issue #629)。 */
export async function listDumps(dir: string): Promise<BackupFile[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: BackupFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !DUMP_FILENAME_PATTERN.test(entry.name)) continue;
    const info = await stat(join(dir, entry.name));
    files.push({ name: entry.name, sizeBytes: info.size, createdAt: info.mtime.toISOString() });
  }
  return files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function backupOnce(
  databaseUrl: string,
  dir: string,
  retentionDays: number,
  recipient: string,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const outFile = join(dir, timestampedFilename());
  await runPgDump(databaseUrl, outFile, recipient);
  await pruneOldDumps(dir, retentionDays);
  return outFile;
}
