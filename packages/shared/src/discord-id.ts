import { z } from "zod";

/**
 * Discord ID(guildId/userId/channelId/roleId等のSnowflake)向けの共通zodスキーマ。
 * guildId: z.string().min(1)相当の定義が9箇所以上でコピペされ二重管理になっていたため集約する
 * (issue #227)。現状はスノーフレーク形式(/^\d{17,20}$/等)の厳格な検証はせず、
 * 従来通り非空文字列のみを要求する(呼び出し元の挙動を変えないため)。
 */
export const discordIdSchema = z.string().min(1);

/**
 * ロール名をメンション風に「@名前」で表示する。@everyoneロールは名前自体が「@everyone」のため、
 * それだけは付け足さない(「@@everyone」にしない)。ほかの@で始まるロール名(例: 「@admin」)は
 * 名前の一部なので、そのまま@を付ける。ユーザー名には使わないこと(ニックネームを「@everyone」にでき、
 * 全員宛てのメンションと区別できなくなるため)。
 */
export function roleMentionLabel(name: string): string {
  return name === "@everyone" ? name : `@${name}`;
}
