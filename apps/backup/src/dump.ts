import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

const DUMP_FILENAME_PATTERN = /^management_bot-.*\.sql\.gz$/;

export function timestampedFilename(now = new Date()): string {
  const iso = now.toISOString().replace(/[:.]/g, "-");
  return `management_bot-${iso}.sql.gz`;
}

export async function runPgDump(databaseUrl: string, outFile: string): Promise<void> {
  // set -eu + explicit rename: a gzip-only exit code would mask a failed pg_dump (empty stdin still gzips to exit 0).
  const script = `
    set -eu
    tmp_raw=$(mktemp)
    tmp_gz=$(mktemp)
    trap 'rm -f "$tmp_raw" "$tmp_gz"' EXIT
    pg_dump "$DATABASE_URL" --format=plain > "$tmp_raw"
    gzip -c "$tmp_raw" > "$tmp_gz"
    mv "$tmp_gz" "$OUT_FILE"
  `;
  const proc = Bun.spawn(["sh", "-c", script], {
    env: { ...process.env, DATABASE_URL: databaseUrl, OUT_FILE: outFile },
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

export async function backupOnce(databaseUrl: string, dir: string, retentionDays: number): Promise<string> {
  await mkdir(dir, { recursive: true });
  const outFile = join(dir, timestampedFilename());
  await runPgDump(databaseUrl, outFile);
  await pruneOldDumps(dir, retentionDays);
  return outFile;
}
