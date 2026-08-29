import { parseEnv, envSchema } from "@management-bot/config";
import { BotClient } from "@management-bot/core";
import { createDb, syncFeatureMetadata } from "@management-bot/db";
import { FEATURES } from "./features.js";
import { buildInviteUrl } from "./invite-url.js";

const env = parseEnv(envSchema);

const { db } = createDb(env.DATABASE_URL);
await syncFeatureMetadata(db);

const client = new BotClient();
await client.registerFeatures(FEATURES);

client.once("ready", (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  console.log(`Invite URL: ${buildInviteUrl(env.DISCORD_CLIENT_ID)}`);
});

await client.login(env.DISCORD_TOKEN);
