import { describe, expect, mock, test } from "bun:test";
import type { Db } from "@management-bot/db";
import { createGetGuildMemberNamesWith, createResolveEffectiveCapabilities } from "./context.js";

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

describe("createGetGuildMemberNamesWith", () => {
  test("同じguildId:userIdへの再呼び出しはfetchNamesを再実行せずキャッシュを使う", async () => {
    const fetchNames = mock((_guildId: string, userIds: readonly string[]) =>
      Promise.resolve(new Map(userIds.map((id) => [id, `name-${id}`]))),
    );
    const getGuildMemberNames = createGetGuildMemberNamesWith(fetchNames);

    const first = await getGuildMemberNames("cache-g1", ["cache-u1"]);
    const second = await getGuildMemberNames("cache-g1", ["cache-u1"]);

    expect(first.get("cache-u1")).toBe("name-cache-u1");
    expect(second.get("cache-u1")).toBe("name-cache-u1");
    expect(fetchNames).toHaveBeenCalledTimes(1);
  });

  test("未キャッシュのuserIdが混在する場合はそのuserIdのみfetchNamesを呼ぶ", async () => {
    const fetchNames = mock((_guildId: string, userIds: readonly string[]) =>
      Promise.resolve(new Map(userIds.map((id) => [id, `name-${id}`]))),
    );
    const getGuildMemberNames = createGetGuildMemberNamesWith(fetchNames);

    await getGuildMemberNames("cache-g2", ["cache-u1"]);
    fetchNames.mockClear();
    const result = await getGuildMemberNames("cache-g2", ["cache-u1", "cache-u2"]);

    expect(result.get("cache-u1")).toBe("name-cache-u1");
    expect(result.get("cache-u2")).toBe("name-cache-u2");
    expect(fetchNames).toHaveBeenCalledTimes(1);
    expect(fetchNames).toHaveBeenCalledWith("cache-g2", ["cache-u2"]);
  });

  test("解決できなかったuserIdはMapに含めない", async () => {
    const fetchNames = mock(() => Promise.resolve(new Map()));
    const getGuildMemberNames = createGetGuildMemberNamesWith(fetchNames);

    const result = await getGuildMemberNames("cache-g3", ["cache-u-missing"]);

    expect(result.has("cache-u-missing")).toBe(false);
  });
});
