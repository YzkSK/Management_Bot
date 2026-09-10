import { z } from "zod";

/**
 * Discord ID(guildId/userId/channelId/roleId等のSnowflake)向けの共通zodスキーマ。
 * guildId: z.string().min(1)相当の定義が9箇所以上でコピペされ二重管理になっていたため集約する
 * (issue #227)。現状はスノーフレーク形式(/^\d{17,20}$/等)の厳格な検証はせず、
 * 従来通り非空文字列のみを要求する(呼び出し元の挙動を変えないため)。
 */
export const discordIdSchema = z.string().min(1);
