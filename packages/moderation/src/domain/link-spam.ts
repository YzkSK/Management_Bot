import { countMentions } from "./mention-spam.js";

/**
 * URLに一般的に使われる短縮ドメインの固定リスト。展開はSSRFリスクがあるため行わず、
 * ドメイン名の一致のみで判定する(改善案5.6節: 短縮URL展開は初期実装では見送り)。
 */
const SHORTENED_URL_DOMAINS = [
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "is.gd",
  "ow.ly",
  "buff.ly",
  "rebrand.ly",
] as const;

/**
 * メッセージ本文はプロトコルなしで書かれることも多いため、"https?://"を必須にしない。
 * パスなし(例: "https://bit.ly")でも検知できるよう、ドメイン直後の"/"も必須にしない
 * (Codexレビュー指摘)。ドメイン名の前後に"(?<![\w.-])"/"(?![\w.-])"を付け、
 * "foo-bit.ly"や"foo.bit.ly"、"bit.ly-lookalike.com"のような別ドメインへの
 * 部分一致(誤検知)を除外する(invite-link.tsのINVITE_LINK_PATTERNと同じ方式、
 * Codexレビュー指摘: \bだけでは"."/"-"の前後でも成立してしまい先頭側の誤検知を防げない)。
 */
const SHORTENED_URL_PATTERN = new RegExp(
  `(?<![\\w.-])(?:https?:\\/\\/)?(?:www\\.)?(?:${SHORTENED_URL_DOMAINS.map((d) => d.replace(".", "\\.")).join("|")})(?![\\w.-])(?:\\/\\S*)?`,
  "i",
);

/** 宣伝によく使われる語句の固定リスト。guild単位の設定は将来拡張のスコープ(#369時点では未対応)。 */
const PROMOTIONAL_PHRASES = [
  "宣伝",
  "拡散希望",
  "フォロバ",
  "相互フォロー",
  "登録者募集",
  "サーバー宣伝",
  "サーバー広告",
  "ぜひ参加",
  "参加してね",
] as const;

/**
 * メンション併用判定用のURL検出。プロトコルあり("https://...")に加え、
 * プロトコルなしのドメイン形式(例: "discord.gg/abc", "example.com/path")も拾う
 * (Codexレビュー指摘: プロトコル必須だとdiscord.gg等の招待リンクを見落とす)。
 */
const URL_PATTERN = /https?:\/\/\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S*/i;

export interface LinkSpamScoreInput {
  content: string;
  /**
   * 投稿者がこのguildに参加してから経過した時間(ミリ秒)。undefinedの場合は
   * 参加時刻不明として「参加24時間以内」の加点対象にしない(安全側ではなく、
   * 情報不足時に過剰検知しない方針)。
   */
  msSinceJoined: number | undefined;
}

/** 「参加24時間以内」加点のしきい値。 */
const RECENTLY_JOINED_MS = 24 * 60 * 60 * 1000;

/**
 * 外部リンク・宣伝行為をスコア方式で採点する純粋関数(改善案5.6節)。
 * 改善案の採点表にある「外部Discord招待(+50点)」は、既存のinvite_link違反種別と
 * 役割が重複し、両方を有効化した場合に同一メッセージへ二重にstrikeが加算されてしまう
 * ため対象外とする(Codexレビュー指摘、外部招待の検知はinvite_link専用とする)。
 * 採点項目は初期実装スコープの4項目のみ(許可チャンネル・複数チャンネル同文投稿も対象外、#369)。
 */
export function scoreLinkSpam(input: LinkSpamScoreInput): number {
  let score = 0;

  if (input.msSinceJoined !== undefined && input.msSinceJoined >= 0 && input.msSinceJoined <= RECENTLY_JOINED_MS) {
    score += 20;
  }
  if (PROMOTIONAL_PHRASES.some((phrase) => input.content.includes(phrase))) score += 15;
  if (countMentions(input.content) > 0 && URL_PATTERN.test(input.content)) score += 20;
  if (SHORTENED_URL_PATTERN.test(input.content)) score += 10;

  return score;
}

/** スコアが削除閾値以上ならヒットとする。 */
export function hasLinkSpamHit(score: number, deleteThreshold: number): boolean {
  return score >= deleteThreshold;
}
