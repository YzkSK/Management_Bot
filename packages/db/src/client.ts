import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export function createDb(databaseUrl: string, options?: { max?: number }) {
  const client = options?.max === undefined ? postgres(databaseUrl) : postgres(databaseUrl, { max: options.max });
  return {
    db: drizzle(client, { schema }),
    close: () => client.end({ timeout: 5 }),
  };
}

export type Db = ReturnType<typeof createDb>["db"];
