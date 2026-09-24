import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema/index.js";
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
 * taskには予約済みコネクション上のDbインスタンス(lockedDb)を渡し、ロック区間中のDB操作は
 * 必ずlockedDb経由で行うようにする(codexレビュー指摘: taskの中で元のdb(通常プール)に
 * 対してクエリを発行すると、複数チャンネルが同時にロック待ちになった際、全ての予約済み
 * コネクションでプールの空き接続が無くなり、task内のクエリが永久に接続を確保できず
 * デッドロックする。ロック保持中のDB操作を専用コネクション1本に閉じ込めることで、
 * 通常プールの接続を消費しないようにする)。
 *
 * 呼び出し元(temp-voiceのオーナー移譲、#410)は、この関数でチャンネル単位の排他区間を作り、
 * 「DBの現在owner確認→Discord API呼び出し→DB確定」の一連の処理がTOCTOU(time-of-check-
 * to-time-of-use)なしにアトミックに見えるようにする(codexレビュー指摘)。
 */
export async function withResourceLock<T>(db: Db, resourceKey: string, task: (lockedDb: Db) => Promise<T>): Promise<T> {
  const reserved = await db.$client.reserve();
  // postgres.jsのreserve()が返す接続は、通常のpostgres()インスタンスと異なりoptionsプロパティを
  // 持たない。drizzle()はconstruct時にoptions.parsers/serializersを書き換えるため、素の状態では
  // 動かない。元のプールのoptionsをそのまま渡すとparsers/serializersオブジェクトを共有してしまい、
  // drizzle()の書き換えが元のプール(db.$client)にも波及する副作用があるため、浅くコピーしてから渡す。
  const clientOptions = (db.$client as unknown as { options: { parsers: object; serializers: object } }).options;
  Object.assign(reserved, {
    options: { ...clientOptions, parsers: { ...clientOptions.parsers }, serializers: { ...clientOptions.serializers } },
  });
  const lockedDb: Db = drizzle(reserved, { schema });
  try {
    await reserved`SELECT pg_advisory_lock(hashtext(${resourceKey}))`;
    return await task(lockedDb);
  } finally {
    await reserved`SELECT pg_advisory_unlock(hashtext(${resourceKey}))`.catch((error: unknown) => {
      console.error(`temp-voice: failed to release advisory lock for ${resourceKey}`, error);
    });
    reserved.release();
  }
}
