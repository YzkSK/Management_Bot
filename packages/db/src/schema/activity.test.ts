import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { activityDaily, activityHourly } from "./activity.js";

describe("activity schema", () => {
  test("activity_hourlyは(guild_id,user_id,hour)の複合PKを持つ", () => {
    const config = getTableConfig(activityHourly);
    expect(config.name).toBe("activity_hourly");
    expect(config.primaryKeys[0]?.columns.map((c) => c.name)).toEqual(["guild_id", "user_id", "hour"]);
  });

  test("activity_dailyは(guild_id,user_id,day)の複合PKを持つ", () => {
    const config = getTableConfig(activityDaily);
    expect(config.primaryKeys[0]?.columns.map((c) => c.name)).toEqual(["guild_id", "user_id", "day"]);
  });
});
