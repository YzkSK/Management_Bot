import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type postgres from "postgres";

export const LEGACY_MAIN_MIGRATION_TAG = "0016_remove_messagedelete_action_type";

type SnapshotColumn = {
  type: string;
  primaryKey: boolean;
};

type SnapshotTable = {
  name: string;
  columns: Record<string, SnapshotColumn>;
  indexes: Record<string, unknown>;
  foreignKeys: Record<string, unknown>;
  compositePrimaryKeys: Record<string, unknown>;
  uniqueConstraints: Record<string, unknown>;
  checkConstraints: Record<string, unknown>;
};

type Snapshot = { tables: Record<string, SnapshotTable> };

type Journal = {
  entries: Array<{ idx: number; tag: string; when: number }>;
};

export type LegacyMainManifest = {
  tables: SnapshotTable[];
  tableNames: string[];
};

export type LegacyMainJournalEntry = {
  tag: string;
  when: number;
  hash: string;
};

type Queryable = postgres.Sql | postgres.TransactionSql;

export function decideBaseline(input: {
  hasJournal: boolean;
  hasApplicationTables: boolean;
  matchesLegacyMain: boolean;
}): "migrate" | "baseline-and-migrate" {
  if (input.hasJournal || !input.hasApplicationTables) return "migrate";
  if (input.matchesLegacyMain) return "baseline-and-migrate";
  throw new Error(
    "Database has application tables but does not match main migration 0016; refusing to synthesize Drizzle history.",
  );
}

export async function loadLegacyMainManifest(): Promise<LegacyMainManifest> {
  const snapshot = JSON.parse(
    await readFile(fileURLToPath(new URL("../drizzle/meta/0016_snapshot.json", import.meta.url)), "utf8"),
  ) as Snapshot;
  const tables = Object.values(snapshot.tables);
  return { tables, tableNames: tables.map((table) => table.name).sort() };
}

export async function loadLegacyMainJournalEntries(): Promise<LegacyMainJournalEntry[]> {
  const journal = JSON.parse(
    await readFile(fileURLToPath(new URL("../drizzle/meta/_journal.json", import.meta.url)), "utf8"),
  ) as Journal;
  const entries = journal.entries.filter((entry) => entry.tag <= LEGACY_MAIN_MIGRATION_TAG);
  return Promise.all(
    entries.map(async (entry) => {
      const sql = await readFile(fileURLToPath(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url)), "utf8");
      return { tag: entry.tag, when: entry.when, hash: createHash("sha256").update(sql).digest("hex") };
    }),
  );
}

function expectedConstraintNames(table: SnapshotTable) {
  const names = [
    ...Object.keys(table.foreignKeys),
    ...Object.keys(table.compositePrimaryKeys),
    ...Object.keys(table.uniqueConstraints),
    ...Object.keys(table.checkConstraints),
  ];
  if (Object.values(table.columns).some((column) => column.primaryKey)) names.push(`${table.name}_pkey`);
  return names.sort();
}

async function listPublicTableNames(sql: Queryable) {
  const rows = await sql<{ tableName: string }[]>`
    SELECT tablename AS "tableName"
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `;
  return rows.map((row) => row.tableName);
}

async function matchesLegacyMain(sql: Queryable, manifest: LegacyMainManifest) {
  const tableNames = await listPublicTableNames(sql);
  if (tableNames.join("\u0000") !== manifest.tableNames.join("\u0000")) return false;

  for (const table of manifest.tables) {
    const columns = await sql<{ columnName: string; dataType: string }[]>`
      SELECT column_name AS "columnName", data_type AS "dataType"
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table.name}
      ORDER BY ordinal_position
    `;
    const expectedColumns = Object.entries(table.columns).map(([name, column]) => `${name}:${column.type}`);
    const actualColumns = columns.map((column) => `${column.columnName}:${column.dataType}`);
    if (actualColumns.join("\u0000") !== expectedColumns.join("\u0000")) return false;

    const constraints = await sql<{ name: string }[]>`
      SELECT constraint_name AS name
      FROM information_schema.table_constraints
      WHERE table_schema = 'public' AND table_name = ${table.name}
      ORDER BY constraint_name
    `;
    if (constraints.map((constraint) => constraint.name).join("\u0000") !== expectedConstraintNames(table).join("\u0000")) {
      return false;
    }

    const indexes = await sql<{ name: string }[]>`
      SELECT indexname AS name
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = ${table.name}
      ORDER BY indexname
    `;
    if (!Object.keys(table.indexes).every((name) => indexes.some((index) => index.name === name))) return false;
  }

  const functions = await sql<{ exists: boolean }[]>`
    SELECT to_regprocedure('notify_log_channel_setting_changed()') IS NOT NULL AS exists
  `;
  if (!functions[0]?.exists) return false;

  const triggers = await sql<{ name: string }[]>`
    SELECT tgname AS name
    FROM pg_trigger
    WHERE tgrelid = 'public.log_channel_settings'::regclass AND NOT tgisinternal
    ORDER BY tgname
  `;
  return triggers.length === 1 && triggers[0]?.name === "log_channel_settings_notify_change";
}

export async function prepareLegacyMainJournal(sql: postgres.Sql) {
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('management-bot:drizzle-migrate'))`;
    const journal = await tx<{ journal: string | null }[]>`SELECT to_regclass('drizzle.__drizzle_migrations') AS journal`;
    const tableNames = await listPublicTableNames(tx);
    const hasJournal = journal[0]?.journal != null;
    const matches =
      !hasJournal && tableNames.length > 0 && (await matchesLegacyMain(tx, await loadLegacyMainManifest()));
    const action = decideBaseline({
      hasJournal,
      hasApplicationTables: tableNames.length > 0,
      matchesLegacyMain: matches,
    });
    if (action === "migrate") return false;

    await tx.unsafe("CREATE SCHEMA drizzle");
    await tx.unsafe(
      "CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY NOT NULL, hash text NOT NULL, created_at bigint)",
    );
    for (const entry of await loadLegacyMainJournalEntries()) {
      await tx`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${entry.hash}, ${entry.when})`;
    }
    return true;
  });
}

function runDrizzleKitMigrate() {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["run", "db:migrate:drizzle"], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`drizzle-kit migrate exited with code ${code ?? "unknown"}`));
    });
  });
}

export async function runMigration(options: {
  databaseUrl: string;
  runDrizzleKit?: () => Promise<void>;
}) {
  const { default: createPostgres } = await import("postgres");
  const sql = createPostgres(options.databaseUrl, { max: 1 });
  try {
    const bootstrapped = await prepareLegacyMainJournal(sql);
    if (bootstrapped) console.info(`Verified legacy main schema and registered migrations through ${LEGACY_MAIN_MIGRATION_TAG}.`);
    await (options.runDrizzleKit ?? runDrizzleKitMigrate)();
    return { bootstrapped };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
