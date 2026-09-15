import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export function createDb(databaseUrl: string, options?: { max?: number }) {
  if (options?.max !== undefined && (!Number.isInteger(options.max) || options.max < 1)) {
    throw new RangeError("createDb options.max must be a positive integer");
  }
  const client = postgres(databaseUrl, options);
  return {
    db: drizzle(client, { schema }),
    close: () => client.end({ timeout: 5 }),
  };
}

export type Db = ReturnType<typeof createDb>["db"];
