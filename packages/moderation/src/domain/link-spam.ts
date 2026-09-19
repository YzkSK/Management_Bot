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

const SHORTENED_URL_PATTERN = new RegExp(
  `\\bhttps?:\\/\\/(?:www\\.)?(?:${SHORTENED_URL_DOMAINS.map((d) => d.replace(".", "\\.")).join("|")})\\/`,
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

const URL_PATTERN = /https?:\/\/\S+/i;

export interface LinkSpamScoreInput {
  content: string;
  /** メッセージに他ギルドへの招待リンクが含まれるか(checkInviteLinkと同じ判定基準)。 */
  hasExternalInvite: boolean;
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
 * 採点項目は初期実装スコープの5項目のみ(許可チャンネル・複数チャンネル同文投稿は対象外、#369)。
 * URLを含まないメッセージ(招待リンクのみのケース含む)でも宣伝語句・メンション等は独立に加点する。
 */
export function scoreLinkSpam(input: LinkSpamScoreInput): number {
  let score = 0;

  if (input.hasExternalInvite) score += 50;
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
