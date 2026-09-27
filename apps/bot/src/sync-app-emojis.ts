import { readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClientApplication } from "discord.js";

/** リポジトリ直下のassets/emojis。Dockerイメージにもリポジトリごとコピーされる。 */
const EMOJI_DIR = fileURLToPath(new URL("../../../assets/emojis", import.meta.url));
const EXTENSIONS = new Set([".png", ".gif", ".webp", ".jpg", ".jpeg", ".avif"]);
const NAME_RE = /^[A-Za-z0-9_]{2,32}$/;
const MAX_BYTES = 256 * 1024;

/**
 * assets/emojis/ の画像のうち未登録のものをアプリケーション絵文字として登録する。
 * アプリケーション絵文字はBotごとに別管理のため、起動したBot自身に登録する(開発用・本番用で個別の手作業は不要)。
 * 同名が登録済みならスキップする。削除・差し替えは行わない(差し替えたい場合はDeveloper Portalで削除してから再起動)。
 */
export async function syncAppEmojis(application: ClientApplication): Promise<void> {
  const files = (await readdir(EMOJI_DIR).catch(() => [])).filter((f) => EXTENSIONS.has(extname(f).toLowerCase()));
  if (files.length === 0) return;

  const existing = new Set((await application.emojis.fetch()).map((e) => e.name));
  for (const file of files.sort()) {
    const name = basename(file, extname(file));
    if (existing.has(name)) continue;
    const path = join(EMOJI_DIR, file);
    if (!NAME_RE.test(name) || (await stat(path)).size > MAX_BYTES) {
      console.warn(`Skip app emoji ${file}: name must be [A-Za-z0-9_]{2,32} and size <= 256KB`);
      continue;
    }
    await application.emojis.create({ attachment: path, name });
    console.log(`Registered app emoji ${name}`);
  }
}

/** 登録済みのアプリケーション絵文字から、絵文字名 → `<:name:id>` を引くリゾルバを作る。 */
export async function loadAppEmojiResolver(application: ClientApplication): Promise<(name: string) => string | undefined> {
  const byName = new Map((await application.emojis.fetch()).map((e) => [e.name, e.toString()]));
  return (name) => byName.get(name);
}
