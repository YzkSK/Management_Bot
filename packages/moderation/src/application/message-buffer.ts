import type { Redis } from "ioredis";

export interface BufferedMessage {
  messageId: string;
  content: string;
  createdAt: Date;
}

const MAX_BUFFER_SIZE = 50;

function bufferKey(guildId: string, userId: string): string {
  return `moderation:flood:${guildId}:${userId}`;
}

function processedKey(guildId: string, messageId: string): string {
  return `moderation:processed:${guildId}:${messageId}`;
}

interface SerializedMessage {
  messageId: string;
  content: string;
  createdAt: string;
}

// KEYS[1]=processedKey, KEYS[2]=bufferKey
// ARGV[1]=processedTtlSeconds, ARGV[2]=serializedMessage, ARGV[3]=maxBufferSize, ARGV[4]=bufferWindowSeconds
// 既に処理済み(SET NXが失敗)ならバッファには一切触れずnilを返す。
// 未処理ならバッファへのpush/trim/expireまでを同一操作としてアトミックに行う。
const CLAIM_AND_PUSH_SCRIPT = `
local claimed = redis.call("SET", KEYS[1], "1", "EX", ARGV[1], "NX")
if not claimed then
  return nil
end
redis.call("LPUSH", KEYS[2], ARGV[2])
redis.call("LTRIM", KEYS[2], 0, ARGV[3] - 1)
redis.call("EXPIRE", KEYS[2], ARGV[4])
return redis.call("LRANGE", KEYS[2], 0, -1)
`;

/**
 * messageIdを一度だけ処理済みとしてマークした上で(SETNX)、新規メッセージをバッファ先頭に積み、
 * TTLをwindowSecondsで更新し、更新後のバッファ全件(新しい順)を返す。
 * 既に処理済み(再配送・ハンドラ再試行)の場合はnullを返し、バッファには一切触れない。
 * claim判定とバッファ更新を単一のLuaスクリプトで行うため、同一ユーザーの複数メッセージが
 * 同時に届いてもpush/trim/expireの間に競合しない。
 */
export async function claimAndPushMessage(
  redis: Redis,
  guildId: string,
  userId: string,
  message: BufferedMessage,
  processedTtlSeconds: number,
  windowSeconds: number,
): Promise<BufferedMessage[] | null> {
  const serialized: SerializedMessage = {
    messageId: message.messageId,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  };

  const raw = (await redis.eval(
    CLAIM_AND_PUSH_SCRIPT,
    2,
    processedKey(guildId, message.messageId),
    bufferKey(guildId, userId),
    processedTtlSeconds,
    JSON.stringify(serialized),
    MAX_BUFFER_SIZE,
    windowSeconds,
  )) as string[] | null;

  if (raw === null) return null;
  return raw.map((item) => {
    const parsed = JSON.parse(item) as SerializedMessage;
    return { ...parsed, createdAt: new Date(parsed.createdAt) };
  });
}
