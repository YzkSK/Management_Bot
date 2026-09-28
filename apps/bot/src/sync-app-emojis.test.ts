import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncAppEmojis } from "./sync-app-emojis.js";

const setup = async (registered: string[]) => {
  const dir = await mkdtemp(join(tmpdir(), "emojis-"));
  const log: string[] = [];
  const emojis = new Map(registered.map((name) => [name, { name, delete: async () => void log.push(`delete ${name}`) }]));
  const application = {
    id: "app1",
    emojis: {
      fetch: async () => [...emojis.values()],
      create: async ({ name }: { attachment: Buffer; name: string }) => {
        log.push(`create ${name}`);
        emojis.set(name, { name, delete: async () => void log.push(`delete ${name}`) });
      },
    },
  };
  const hashes = new Map<string, string>();
  const store = {
    hget: async (key: string, field: string) => hashes.get(`${key}/${field}`) ?? null,
    hset: async (key: string, field: string, value: string) => {
      hashes.set(`${key}/${field}`, value);
      return 1;
    },
  };
  return { dir, log, application, store };
};

describe("syncAppEmojis", () => {
  test("ハッシュ未記録の既存絵文字は登録し直し、以後は画像が変わったものだけ差し替える", async () => {
    const { dir, log, application, store } = await setup(["a_icon", "b_icon"]);
    await writeFile(join(dir, "a_icon.png"), "a1");
    await writeFile(join(dir, "b_icon.png"), "b1");
    await writeFile(join(dir, "c_icon.png"), "c1");

    await syncAppEmojis(application, store, dir);
    expect(log).toEqual(["delete a_icon", "create a_icon", "delete b_icon", "create b_icon", "create c_icon"]);

    log.length = 0;
    await syncAppEmojis(application, store, dir);
    expect(log).toEqual([]);

    await writeFile(join(dir, "b_icon.png"), "b2");
    await syncAppEmojis(application, store, dir);
    expect(log).toEqual(["delete b_icon", "create b_icon"]);
  });
});
