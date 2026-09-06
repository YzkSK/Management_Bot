/**
 * Discordロール権限のビットフィールド(discord.js PermissionsBitFieldと同じ定義)を
 * 表示用の日本語権限名リストに変換する。discord.jsのPermissionFlagsBitsを複製したもの。
 * 新しい権限が追加された場合はここにも追記する。
 */
const PERMISSIONS: ReadonlyArray<{ bit: bigint; label: string }> = [
  { bit: 1n << 0n, label: "招待を作成" },
  { bit: 1n << 1n, label: "メンバーをキック" },
  { bit: 1n << 2n, label: "メンバーをBAN" },
  { bit: 1n << 3n, label: "管理者" },
  { bit: 1n << 4n, label: "チャンネルの管理" },
  { bit: 1n << 5n, label: "サーバーの管理" },
  { bit: 1n << 6n, label: "リアクションの追加" },
  { bit: 1n << 7n, label: "監査ログを表示" },
  { bit: 1n << 8n, label: "優先スピーカー" },
  { bit: 1n << 9n, label: "配信" },
  { bit: 1n << 10n, label: "チャンネルを見る" },
  { bit: 1n << 11n, label: "メッセージを送信" },
  { bit: 1n << 12n, label: "テキスト読み上げメッセージを送信" },
  { bit: 1n << 13n, label: "メッセージの管理" },
  { bit: 1n << 14n, label: "埋め込みリンク" },
  { bit: 1n << 15n, label: "ファイルを添付" },
  { bit: 1n << 16n, label: "メッセージ履歴を読む" },
  { bit: 1n << 17n, label: "@everyone、@here、全ロールにメンション" },
  { bit: 1n << 18n, label: "外部の絵文字を使用" },
  { bit: 1n << 19n, label: "サーバーインサイトを見る" },
  { bit: 1n << 20n, label: "接続" },
  { bit: 1n << 21n, label: "発言" },
  { bit: 1n << 22n, label: "メンバーをミュート" },
  { bit: 1n << 23n, label: "メンバーのスピーカーをミュート" },
  { bit: 1n << 24n, label: "メンバーを移動" },
  { bit: 1n << 25n, label: "音声検出を使用" },
  { bit: 1n << 26n, label: "ニックネームの変更" },
  { bit: 1n << 27n, label: "ニックネームの管理" },
  { bit: 1n << 28n, label: "ロールの管理" },
  { bit: 1n << 29n, label: "ウェブフックの管理" },
  { bit: 1n << 30n, label: "サーバーの絵文字・ステッカー・サウンドの管理" },
  { bit: 1n << 31n, label: "アプリケーションコマンドの使用" },
  { bit: 1n << 32n, label: "発言をリクエスト" },
  { bit: 1n << 33n, label: "イベントの管理" },
  { bit: 1n << 34n, label: "スレッドの管理" },
  { bit: 1n << 35n, label: "公開スレッドの作成" },
  { bit: 1n << 36n, label: "非公開スレッドの作成" },
  { bit: 1n << 37n, label: "外部のステッカーを使用" },
  { bit: 1n << 38n, label: "スレッドにメッセージを送信" },
  { bit: 1n << 39n, label: "アクティビティを使用" },
  { bit: 1n << 40n, label: "メンバーをタイムアウト" },
  { bit: 1n << 41n, label: "クリエイターの収益化アナリティクスを見る" },
  { bit: 1n << 42n, label: "サウンドボードを使用" },
  { bit: 1n << 43n, label: "絵文字・ステッカー・サウンドの作成" },
  { bit: 1n << 44n, label: "イベントの作成" },
  { bit: 1n << 45n, label: "外部のサウンドを使用" },
  { bit: 1n << 46n, label: "ボイスメッセージを送信" },
  { bit: 1n << 48n, label: "ボイスチャンネルステータスの設定" },
  { bit: 1n << 49n, label: "投票を作成" },
  { bit: 1n << 50n, label: "外部アプリを使用" },
  { bit: 1n << 51n, label: "メッセージをピン留め" },
  { bit: 1n << 52n, label: "低速モードを回避" },
];

const KNOWN_BITS_MASK = PERMISSIONS.reduce((mask, { bit }) => mask | bit, 0n);

function permissionNamesForBits(value: bigint): string[] {
  const names = PERMISSIONS.filter(({ bit }) => (value & bit) === bit).map(({ label }) => label);
  const unknownBits = value & ~KNOWN_BITS_MASK;
  if (unknownBits !== 0n) names.push(`不明な権限(0b${unknownBits.toString(2)})`);
  return names;
}

/**
 * 権限ビットフィールドのbefore/afterを比較し、追加された権限名・削除された権限名を返す。
 * 数値として解釈できない値(不正データ)が渡された場合はnullを返し、呼び出し側で従来のbefore/after文字列表示にフォールバックさせる。
 */
export function diffPermissions(before: string, after: string): { added: string[]; removed: string[] } | null {
  if (!/^\d+$/.test(before) || !/^\d+$/.test(after)) return null;
  const beforeValue = BigInt(before);
  const afterValue = BigInt(after);
  const beforeNames = new Set(permissionNamesForBits(beforeValue));
  const afterNames = new Set(permissionNamesForBits(afterValue));
  return {
    added: [...afterNames].filter((name) => !beforeNames.has(name)),
    removed: [...beforeNames].filter((name) => !afterNames.has(name)),
  };
}
