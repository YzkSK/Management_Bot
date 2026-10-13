import { afterAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import {
  listenForTempVoiceChannelAction,
  tempVoiceChannelActionNotificationSchema,
  type TempVoiceChannelActionNotification,
} from "./temp-voice-action-notifications.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run this test");

const sql = postgres(databaseUrl);
afterAll(async () => {
  await sql.end({ timeout: 5 });
});

const base = { requestId: "11111111-1111-4111-8111-111111111111", guildId: "g1", channelId: "c1", executorId: "u1" };

describe("tempVoiceChannelActionNotificationSchema", () => {
  test("各actionを受理し、不正な形式は拒否する", () => {
    const valid = [
      { type: "rename", name: "x" },
      { type: "userLimit", value: 3 },
      { type: "bitrate", kbps: 64 },
      { type: "setLocked", locked: true },
      { type: "setHidden", hidden: false },
      { type: "permit", targetType: "user", targetId: "u2" },
      { type: "deny", targetType: "role", targetId: "r1" },
      { type: "removeOverride", targetType: "role", targetId: "r1" },
      { type: "transferOwner", userId: "u2" },
    ];
    for (const action of valid) expect(tempVoiceChannelActionNotificationSchema.safeParse({ ...base, action }).success).toBe(true);

    const invalid = [
      { type: "unknown" },
      { type: "userLimit", value: 1.5 },
      { type: "permit", targetType: "channel", targetId: "u2" },
      { type: "setLocked" },
    ];
    for (const action of invalid) expect(tempVoiceChannelActionNotificationSchema.safeParse({ ...base, action }).success).toBe(false);
    expect(tempVoiceChannelActionNotificationSchema.safeParse({ guildId: "g1", action: valid[0] }).success).toBe(false);
    expect(
      tempVoiceChannelActionNotificationSchema.safeParse({ guildId: "g1", channelId: "c1", executorId: "u1", action: valid[0] }).success,
    ).toBe(false);
    expect(tempVoiceChannelActionNotificationSchema.safeParse({ ...base, requestId: "not-uuid", action: valid[0] }).success).toBe(false);
  });
});

describe("listenForTempVoiceChannelAction", () => {
  test("正しいpayloadのみコールバックに渡し、不正なpayloadは無視する", async () => {
    const received: TempVoiceChannelActionNotification[] = [];
    const listener = listenForTempVoiceChannelAction(databaseUrl, (n) => received.push(n));
    await listener.ready;
    try {
      await sql`SELECT pg_notify('temp_voice_channel_action', ${JSON.stringify({ ...base, action: { type: "bogus" } })})`;
      await sql`SELECT pg_notify('temp_voice_channel_action', 'not json')`;
      await sql`SELECT pg_notify('temp_voice_channel_action', ${JSON.stringify({ ...base, action: { type: "setHidden", hidden: true } })})`;
      for (let i = 0; i < 100 && received.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    } finally {
      await listener.close();
    }
    expect(received).toEqual([{ ...base, action: { type: "setHidden", hidden: true } }]);
  });
});
