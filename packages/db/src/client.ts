import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl);
  return {
    db: drizzle(client, { schema }),
    close: () => client.end({ timeout: 5 }),
  };
}

export type Db = ReturnType<typeof createDb>["db"];
