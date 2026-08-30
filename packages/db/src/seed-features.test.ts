import { describe, expect, test } from "bun:test";
import { FEATURE_METADATA } from "@management-bot/shared";
import { syncFeatureMetadata } from "./seed-features.ts";
import { features } from "./schema/index.ts";
import type { Db } from "./client.ts";

describe("syncFeatureMetadata", () => {
  test("FEATURE_METADATAを一括insert+onConflictDoUpdateする", async () => {
    let insertedValues: unknown;
    let conflictOpts: { target: unknown; set: unknown } | undefined;
    const fakeDb = {
      insert: (table: unknown) => {
        expect(table).toBe(features);
        return {
          values: (value: unknown) => {
            insertedValues = value;
            return {
              onConflictDoUpdate: (opts: typeof conflictOpts) => {
                conflictOpts = opts;
                return Promise.resolve();
              },
            };
          },
        };
      },
    } as unknown as Db;

    await syncFeatureMetadata(fakeDb);

    expect(insertedValues).toEqual([...FEATURE_METADATA]);
    expect(conflictOpts?.target).toBe(features.key);
    expect(conflictOpts?.set).toHaveProperty("name");
    expect(conflictOpts?.set).toHaveProperty("description");
  });
});
