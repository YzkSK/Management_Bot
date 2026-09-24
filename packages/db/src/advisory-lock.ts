import type { Db } from "./client.js";

/**
 * 文字列キー(Discordのスノーフレーク等)単位でセッションスコープのadvisory lock
 * (pg_advisory_lock)を取得し、task実行後に必ず解放する。hashtext()でPostgres組み込みの
 * ハッシュ関数を使い、bigintキーへ変換する(追加拡張は不要)。
 *
 * トランザクションスコープ(pg_try_advisory_xact_lock)ではなくセッションスコープを使うのは、
 * taskの中でDiscord API呼び出しのような長時間のI/Oを挟むケースを想定しているため
 * (トランザクション内に長時間のI/Oを閉じ込めるとDB接続を長時間占有してしまう)。
 * ロック取得・解放は同一コネクション上で行う必要があるため、db.$client.reserve()で
 * 専用コネクションを1本予約する。
 *
 * 呼び出し元(temp-voiceのオーナー移譲、#410)は、この関数でチャンネル単位の排他区間を作り、
 * 「DBの現在owner確認→Discord API呼び出し→DB確定」の一連の処理がTOCTOU(time-of-check-
 * to-time-of-use)なしにアトミックに見えるようにする(codexレビュー指摘)。
 */
export async function withResourceLock<T>(db: Db, resourceKey: string, task: () => Promise<T>): Promise<T> {
  const reserved = await db.$client.reserve();
  try {
    await reserved`SELECT pg_advisory_lock(hashtext(${resourceKey}))`;
    return await task();
  } finally {
    await reserved`SELECT pg_advisory_unlock(hashtext(${resourceKey}))`.catch((error: unknown) => {
      console.error(`temp-voice: failed to release advisory lock for ${resourceKey}`, error);
    });
    reserved.release();
  }
}
