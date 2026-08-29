import { sql } from "drizzle-orm";
import { FEATURE_METADATA } from "@management-bot/shared";
import type { Db } from "./client.js";
import { features } from "./schema/index.js";

export async function syncFeatureMetadata(db: Db): Promise<void> {
  await db
    .insert(features)
    .values([...FEATURE_METADATA])
    .onConflictDoUpdate({
      target: features.key,
      set: { name: sql`excluded.name`, description: sql`excluded.description` },
    });
}
