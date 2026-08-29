import { describe, expect, test } from "bun:test";
import { envSchema, parseEnv } from "./env.ts";

const validEnv = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  DISCORD_TOKEN: "token",
  DISCORD_CLIENT_ID: "client-id",
  DISCORD_CLIENT_SECRET: "client-secret",
  DISCORD_OAUTH_REDIRECT_URI: "https://example.com/auth/callback",
  DASHBOARD_WEB_URL: "https://example.com",
  SESSION_SECRET: "a".repeat(32),
};

describe("parseEnv", () => {
  test("正しい環境変数を通す", () => {
    const env = parseEnv(envSchema, validEnv);
    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
  });

  test("不正な環境変数(必須項目欠落)で例外を投げる", () => {
    const invalidEnv = { ...validEnv, DATABASE_URL: undefined };
    expect(() => parseEnv(envSchema, invalidEnv)).toThrow();
  });

  test("SESSION_SECRETが短すぎる場合に例外を投げる", () => {
    expect(() =>
      parseEnv(envSchema, { ...validEnv, SESSION_SECRET: "short" }),
    ).toThrow();
  });

  test("DATABASE_URLがpostgres://以外のプロトコルの場合に例外を投げる", () => {
    expect(() =>
      parseEnv(envSchema, { ...validEnv, DATABASE_URL: "https://example.com" }),
    ).toThrow();
  });

  test("REDIS_URLがredis://以外のプロトコルの場合に例外を投げる", () => {
    expect(() =>
      parseEnv(envSchema, { ...validEnv, REDIS_URL: "https://example.com" }),
    ).toThrow();
  });

  test(".pick()で部分schemaを構成できる(例: Discordアプリ用、DB/Redis/セッション変数なしで動く)", () => {
    const discordEnvSchema = envSchema.pick({
      DISCORD_TOKEN: true,
      DISCORD_CLIENT_ID: true,
      DISCORD_CLIENT_SECRET: true,
    });
    const discordOnlyEnv = {
      DISCORD_TOKEN: "token",
      DISCORD_CLIENT_ID: "client-id",
      DISCORD_CLIENT_SECRET: "client-secret",
    };
    const env = parseEnv(discordEnvSchema, discordOnlyEnv);
    expect(env).toEqual(discordOnlyEnv);
  });

  test(".pick()で構成した部分schemaでも必須項目の欠落で例外を投げる", () => {
    const discordEnvSchema = envSchema.pick({ DISCORD_TOKEN: true });
    expect(() => parseEnv(discordEnvSchema, {})).toThrow();
  });
});
