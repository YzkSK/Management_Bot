/**
 * Discord招待URL(discord.gg/<code>, discord.com/invite/<code>, discordapp.com/invite/<code>)
 * から招待コードを抽出する。ホスト名直前に英数字・ドット・ハイフンが続く場合は
 * 別ドメインへの埋め込み(例: notdiscord.gg)とみなし除外するため、
 * 単語境界(?<![\w.-])で始端を固定する。ホスト名は大文字小文字を区別しないためiフラグを付与する。
 * (メッセージ本文はプロトコルなしで書かれることも多く厳密なURLパースを前提にできないため、
 * `example.test/discord.gg/fake`のような他ドメインのパス内埋め込みまでは防がない。
 * 安全側に倒す設計方針(spec参照)と、この形式が実際のスパムでは非現実的なことから許容する。)
 */
const INVITE_LINK_PATTERN = /(?<![\w.-])(?:discord\.gg|discord(?:app)?\.com\/invite)\/([a-zA-Z0-9-]+)/gi;

/** メッセージ本文に含まれるDiscord招待コードを重複除去して抽出する(マッチしなければ空配列)。 */
export function extractInviteCodes(content: string): string[] {
  const codes = [...content.matchAll(INVITE_LINK_PATTERN)]
    .map((m) => m[1])
    .filter((code) => code !== undefined);
  return [...new Set(codes)];
}

/**
 * 抽出した招待コードの解決結果(自ギルドの招待かどうか)を受け取り、
 * 1件でも他ギルドの招待があればヒットと判定する純粋関数。
 * 解決自体(fetchInvite呼び出し)はapplication/discord層の責務。
 */
export function hasInviteLinkHit(resolutions: readonly boolean[]): boolean {
  return resolutions.some((isOwnGuild) => !isOwnGuild);
}
