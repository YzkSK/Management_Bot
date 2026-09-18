import type { Db } from "@management-bot/db";
import { createTtlCache } from "@management-bot/shared";
import type { WhitelistMatchEntry } from "../domain/index.js";
import { listNgwords, type NgwordRow } from "./ngwords.js";
import { type EnabledThreshold, getEnabledThresholds } from "./thresholds.js";
import { listWhitelist } from "./whitelist.js";

export interface ModerationConfigSnapshot {
  whitelist: readonly WhitelistMatchEntry[];
  enabledThresholds: readonly EnabledThreshold[];
  ngwords: readonly NgwordRow[];
}

export interface ModerationConfigCache {
  get(db: Db, guildId: string): Promise<ModerationConfigSnapshot>;
  /** guildIdのキャッシュエントリを即座に破棄する。次回get()はTTL満了を待たず再取得する。 */
  invalidate(guildId: string): void;
}

/** 単一Botプロセス構成向けのguild単位インメモリTTLキャッシュ。デフォルト5秒(#352)。 */
const DEFAULT_TTL_MS = 5_000;

/**
 * メッセージ受信ごとにwhitelist/thresholds/ngwordsを個別にDBへ問い合わせていた構造
 * (連投攻撃が激しいほどDB参照数が比例して増加する、改善案6.1節)を解消するため、
 * guild単位で1つのスナップショットとしてまとめて取得・TTLキャッシュする。
 * 複数Botプロセス構成でのキャッシュ無効化(Redis Pub/Sub等)は現状単一Bot構成のためスコープ外。
 * Dashboardでの設定変更はTTL(デフォルト5秒)経過後に反映される。
 */
export function createModerationConfigCache(ttlMs = DEFAULT_TTL_MS): ModerationConfigCache {
  const cache = createTtlCache<ModerationConfigSnapshot>(ttlMs);
  return {
    get: (db, guildId) =>
      cache(guildId, async () => {
        const [whitelist, enabledThresholds, ngwords] = await Promise.all([
          listWhitelist(db, guildId),
          getEnabledThresholds(db, guildId),
          listNgwords(db, guildId),
        ]);
        return { whitelist, enabledThresholds, ngwords };
      }),
    invalidate: (guildId) => cache.invalidate(guildId),
  };
}
