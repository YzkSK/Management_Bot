import { remove } from "confusables";

/** 仮名・漢字・長音符。confusablesが「ロ→O」「エ→I」のように誤変換するため対象外にする。 */
const JAPANESE_CHARS = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー]/u;

/**
 * 見た目が似た文字(キリル文字の`і`、数学用英数字、全角等)をラテン文字へ寄せる(UTS#39 skeleton相当、#556)。
 * `dіscord.gg`のようなホモグリフによるNGワード・招待リンク検知の回避を防ぐ。
 * 日本語の仮名・漢字はラテン文字へ誤変換され日本語NGワードが英字に誤マッチするため、変換対象外とする。
 * ASCIIはそのまま保たれる(招待コードの大文字小文字も不変)。
 */
export function foldConfusables(text: string): string {
  let result = "";
  for (const char of text) {
    result += JAPANESE_CHARS.test(char) ? char : remove(char);
  }
  return result;
}
