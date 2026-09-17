import type { Redis } from "ioredis";
import type { RaidBufferEntry } from "../domain/index.js";

const MAX_BUFFER_SIZE = 200;

function raidBufferKey(guildId: string): string {
  return `moderation:raid:${guildId}`;
}

interface SerializedRaidEntry {
  userId: string;
  joinedAt: string;
  isNewAccount: boolean;
}

// KEYS[1]=raidBufferKey, ARGV[1]=serializedEntry, ARGV[2]=maxBufferSize, ARGV[3]=windowSeconds
// 新規入室者をバッファ先頭に積み、TTLをwindowSecondsで更新し、更新後のバッファ全件(新しい順)を返す。
// TTLはキー自体の掃除用であり、windowSeconds外のエントリの除外は呼び出し側がjoinedAtで絞り込む
// (message-buffer.tsのpushMentionCountと同じ方式)。
const PUSH_RAID_ENTRY_SCRIPT = `
redis.call("LPUSH", KEYS[1], ARGV[1])
redis.call("LTRIM", KEYS[1], 0, ARGV[2] - 1)
redis.call("EXPIRE", KEYS[1], ARGV[3])
return redis.call("LRANGE", KEYS[1], 0, -1)
`;

/**
 * ギルド単位のレイド判定用入室バッファ(moderation:raid:{guildId})へ新規入室者を積み、
 * 更新後のバッファ全件(新しい順)を返す。個々の入室者はGuildMemberAddごとに一意
 * (Discordが同一ユーザーの重複入室イベントを送ることはない)ため、message-buffer.tsの
 * claimAndPushMessageと異なり冪等化(SETNX)は不要。
 */
export async function pushRaidEntry(
  redis: Redis,
  guildId: string,
  entry: RaidBufferEntry,
  windowSeconds: number,
): Promise<RaidBufferEntry[]> {
  const serialized: SerializedRaidEntry = {
    userId: entry.userId,
    joinedAt: entry.joinedAt.toISOString(),
    isNewAccount: entry.isNewAccount,
  };
  const raw = (await redis.eval(
    PUSH_RAID_ENTRY_SCRIPT,
    1,
    raidBufferKey(guildId),
    JSON.stringify(serialized),
    MAX_BUFFER_SIZE,
    windowSeconds,
  )) as string[];
  return raw.map((item) => {
    const parsed = JSON.parse(item) as SerializedRaidEntry;
    return { userId: parsed.userId, joinedAt: new Date(parsed.joinedAt), isNewAccount: parsed.isNewAccount };
  });
}
