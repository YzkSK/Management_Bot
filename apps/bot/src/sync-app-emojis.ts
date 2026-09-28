import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setAppEmojis } from "@management-bot/shared";
import type { ClientApplication } from "discord.js";
import type { Redis } from "ioredis";

/** リポジトリ直下のassets/emojis。Dockerイメージにもリポジトリごとコピーされる。 */
const EMOJI_DIR = fileURLToPath(new URL("../../../assets/emojis", import.meta.url));
const EXTENSIONS = new Set([".png", ".gif", ".webp", ".jpg", ".jpeg", ".avif"]);
const NAME_RE = /^[A-Za-z0-9_]{2,32}$/;
const MAX_BYTES = 256 * 1024;

type HashStore = Pick<Redis, "hget" | "hset">;
type RegisteredEmoji = { name: string | null; delete(): Promise<unknown> };
type EmojiApplication = {
  id: string;
  emojis: {
    fetch(): Promise<{ map<T>(fn: (e: RegisteredEmoji) => T): T[] }>;
    create(options: { attachment: Buffer; name: string }): Promise<unknown>;
  };
};

/**
 * assets/emojis/ の画像をアプリケーション絵文字として登録する。
 * アプリケーション絵文字はBotごとに別管理のため、起動したBot自身に登録する(開発用・本番用で個別の手作業は不要)。
 * 登録した画像のハッシュをRedisに記録し、画像が変わった(またはハッシュ未記録の)絵文字は削除して登録し直す。
 * ファイルが消えた絵文字は削除しない。
 */
export async function syncAppEmojis(
  application: EmojiApplication,
  store: HashStore,
  dir: string = EMOJI_DIR,
): Promise<void> {
  const files = (await readdir(dir).catch(() => [])).filter((f) => EXTENSIONS.has(extname(f).toLowerCase()));
  if (files.length === 0) return;

  const hashKey = `app-emoji:hash:${application.id}`;
  const existing = new Map((await application.emojis.fetch()).map((e) => [e.name, e]));
  for (const file of files.sort()) {
    const name = basename(file, extname(file));
    const data = await readFile(join(dir, file));
    const hash = createHash("sha256").update(data).digest("hex");
    const current = existing.get(name);
    if (current && (await store.hget(hashKey, name)) === hash) continue;
    if (!NAME_RE.test(name) || data.length > MAX_BYTES) {
      console.warn(`Skip app emoji ${file}: name must be [A-Za-z0-9_]{2,32} and size <= 256KB`);
      continue;
    }
    if (current) await current.delete();
    await application.emojis.create({ attachment: data, name });
    await store.hset(hashKey, name, hash);
    console.log(`${current ? "Replaced" : "Registered"} app emoji ${name}`);
  }
}

/**
 * 登録済みのアプリケーション絵文字を取得し、各機能の絵文字表示に注入する(#455)。
 * 失敗・未登録なら各機能はUnicode絵文字のまま動く。
 */
export async function applyAppEmojis(application: ClientApplication): Promise<void> {
  const emojis = await application.emojis.fetch();
  setAppEmojis(
    [...emojis.values()].flatMap((e) => (e.name === null ? [] : [{ id: e.id, name: e.name, animated: e.animated ?? false }])),
  );
}
