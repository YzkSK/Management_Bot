import { EventEmitter } from "node:events";

/**
 * correlateAuditLogEntry(annotateRow成功時)とwriteLogEntry(相関完了を待つ側)を、
 * 同一プロセス内でDB行id単位に結びつけるための橋渡し。両者は別々のDiscordイベント
 * (元イベント vs guildAuditLogEntryCreate)から非同期に呼ばれる独立した処理のため、
 * 「実行者が確定した瞬間に送信する」には両者を直接つなぐ手段が要る。
 *
 * emitCorrelated呼び出しがwaitForCorrelated呼び出しより先に起きても取りこぼさないよう、
 * (行id → 確定済みマーク)を一定期間保持する。writeLogEntry側が後から待ち始めても
 * 即座に解決できる。
 */
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

const alreadyCorrelated = new Set<string>();
/** 誰も待たないままメモリに残り続けないよう、確定マークの保持上限。相関ウィンドウ(30秒)より十分長く取る。 */
const CORRELATED_MARK_TTL_MS = 60_000;

/** annotateRowがexecutorIdの追記に成功した直後に呼ぶ。 */
export function emitCorrelated(id: string): void {
  alreadyCorrelated.add(id);
  setTimeout(() => alreadyCorrelated.delete(id), CORRELATED_MARK_TTL_MS);
  emitter.emit(id);
}

/**
 * idの相関確定を待つ。timeoutMs以内に確定すればtrueで即座に解決し、確定しないままなら
 * falseでタイムアウトする。emitCorrelatedが先に呼ばれていた場合は待たずに即trueを返す。
 */
export function waitForCorrelated(id: string, timeoutMs: number): Promise<boolean> {
  if (alreadyCorrelated.has(id)) return Promise.resolve(true);

  return new Promise((resolve) => {
    const onCorrelated = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      emitter.off(id, onCorrelated);
      resolve(false);
    }, timeoutMs);
    emitter.once(id, onCorrelated);
  });
}
