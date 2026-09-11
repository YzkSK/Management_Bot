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

interface SerializedMessage {
  messageId: string;
  content: string;
  createdAt: string;
}

/**
 * 新規メッセージをRedisバッファの先頭に積み、TTLをwindowSecondsで更新した上で、
 * 更新後のバッファ全件(新しい順)を返す。頻度判定・重複判定の両方でこのバッファを共用する。
 */
export async function pushAndReadBuffer(
  redis: Redis,
  guildId: string,
  userId: string,
  message: BufferedMessage,
  windowSeconds: number,
): Promise<BufferedMessage[]> {
  const key = bufferKey(guildId, userId);
  const serialized: SerializedMessage = {
    messageId: message.messageId,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  };
  await redis.lpush(key, JSON.stringify(serialized));
  await redis.ltrim(key, 0, MAX_BUFFER_SIZE - 1);
  await redis.expire(key, windowSeconds);

  const raw = await redis.lrange(key, 0, -1);
  return raw.map((item) => {
    const parsed = JSON.parse(item) as SerializedMessage;
    return { ...parsed, createdAt: new Date(parsed.createdAt) };
  });
}
