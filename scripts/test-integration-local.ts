const databaseUrl = "postgres://management_bot:management_bot@127.0.0.1:5432/management_bot";
const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  REDIS_URL: "redis://127.0.0.1:6379",
  VITE_API_URL: "http://localhost:3000",
};

async function run(command: readonly string[]): Promise<void> {
  const process = Bun.spawn(command, { cwd: import.meta.dir + "/..", env, stdout: "inherit", stderr: "inherit" });
  if ((await process.exited) !== 0) throw new Error(`Command failed: ${command.join(" ")}`);
}

await run(["bun", "run", "--cwd", "packages/db", "db:migrate"]);
await run(["bunx", "turbo", "run", "test", "--concurrency=1", "--", "--parallel=1"]);
