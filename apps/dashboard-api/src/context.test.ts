import { describe, expect, mock, test } from "bun:test";
import type { Db } from "@management-bot/db";
import { createResolveEffectiveCapabilities } from "./context.js";

// resolveはDb引数をそのままdbに渡すだけの薄いラッパーとして注入するため、
// このユニットテストではdbは使われない(型を満たすためのダミー)。
const dummyDb = {} as Db;

describe("createResolveEffectiveCapabilities", () => {
  test("同じ入力での並行呼び出しはresolveを1回しか実行しない", async () => {
    const resolve = mock(() => Promise.resolve(1));
    const resolveEffectiveCapabilities = createResolveEffectiveCapabilities(dummyDb, resolve);

    const input = { guildId: "g1", discordUserId: "u1", isOwner: false, roleIds: ["r1", "r2"] };
    const [a, b] = await Promise.all([resolveEffectiveCapabilities(input), resolveEffectiveCapabilities(input)]);

    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  test("roleIdsの順序が違っても同じキーとして扱われる", async () => {
    const resolve = mock(() => Promise.resolve(2));
    const resolveEffectiveCapabilities = createResolveEffectiveCapabilities(dummyDb, resolve);

    await Promise.all([
      resolveEffectiveCapabilities({ guildId: "g1", discordUserId: "u1", isOwner: false, roleIds: ["r1", "r2"] }),
      resolveEffectiveCapabilities({ guildId: "g1", discordUserId: "u1", isOwner: false, roleIds: ["r2", "r1"] }),
    ]);

    expect(resolve).toHaveBeenCalledTimes(1);
  });

  test("guildId/discordUserId/roleIdsが異なる入力はそれぞれ個別に解決される", async () => {
    const resolve = mock(() => Promise.resolve(3));
    const resolveEffectiveCapabilities = createResolveEffectiveCapabilities(dummyDb, resolve);

    await Promise.all([
      resolveEffectiveCapabilities({ guildId: "g1", discordUserId: "u1", isOwner: false, roleIds: [] }),
      resolveEffectiveCapabilities({ guildId: "g2", discordUserId: "u1", isOwner: false, roleIds: [] }),
      resolveEffectiveCapabilities({ guildId: "g1", discordUserId: "u2", isOwner: false, roleIds: [] }),
      resolveEffectiveCapabilities({ guildId: "g1", discordUserId: "u1", isOwner: false, roleIds: ["r1"] }),
    ]);

    expect(resolve).toHaveBeenCalledTimes(4);
  });

  test("完了後は結果をキャッシュせず、次回呼び出しで再度resolveする", async () => {
    const resolve = mock(() => Promise.resolve(4));
    const resolveEffectiveCapabilities = createResolveEffectiveCapabilities(dummyDb, resolve);

    const input = { guildId: "g1", discordUserId: "u1", isOwner: false, roleIds: [] };
    await resolveEffectiveCapabilities(input);
    await resolveEffectiveCapabilities(input);

    expect(resolve).toHaveBeenCalledTimes(2);
  });

  test("失敗した呼び出しは完了後にキャッシュから外れ、後続の呼び出しは再試行できる", async () => {
    const resolve = mock()
      .mockImplementationOnce(() => Promise.reject(new Error("db error")))
      .mockImplementationOnce(() => Promise.resolve(5));
    const resolveEffectiveCapabilities = createResolveEffectiveCapabilities(dummyDb, resolve);

    const input = { guildId: "g1", discordUserId: "u1", isOwner: false, roleIds: [] };
    await expect(resolveEffectiveCapabilities(input)).rejects.toThrow("db error");
    await expect(resolveEffectiveCapabilities(input)).resolves.toBe(5);

    expect(resolve).toHaveBeenCalledTimes(2);
  });
});
