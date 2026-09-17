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

function raidLockKey(guildId: string): string {
  return `moderation:raid-lock:${guildId}`;
}

// KEYS[1]=raidLockKey, ARGV[1]=windowSeconds(ミリ秒)
// message-buffer.tsのMARK_STRIKE_HIT_SCRIPTと同じ「次に許可される時刻」方式。
// 現在キーがない、またはnow>=nextAllowedAtMsなら1(新規インシデントとして扱ってよい)を返し、
// nextAllowedAtMs=now+windowSecondsで更新する。まだ未満なら0を返し値は変更しない。
const MARK_RAID_HIT_SCRIPT = `
local time = redis.call("TIME")
local nowMs = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local raw = redis.call("GET", KEYS[1])
local ttlSeconds = math.ceil(tonumber(ARGV[1]) / 1000)
if raw then
  local nextAllowedAtMs = tonumber(raw)
  if nowMs < nextAllowedAtMs then
    redis.call("EXPIRE", KEYS[1], ttlSeconds)
    return 0
  end
end
local nextAllowedAtMs = nowMs + tonumber(ARGV[1])
redis.call("SET", KEYS[1], nextAllowedAtMs, "EX", ttlSeconds)
return 1
`;

/**
 * レイド判定のウィンドウ内人数閾値は、閾値到達後も入室が続く限り毎回ヒットし続けてしまう
 * (バッファがwindowSeconds内の入室者を保持し続けるため)。これを放置すると同一バースト中の
 * 入室のたびに新しいcaseIdでインシデントが作られ、既にtimeout済みの対象を含めて何度も
 * 一括アクションが再発行される(Codexレビュー指摘)。message-buffer.tsのstrikeロックと
 * 同じ「windowSecondsに1回だけ新規インシデントとして扱う」方式でこれを防ぐ。
 * trueを返した呼び出しのみが実際にインシデントとして処理してよい。
 */
export async function markRaidHitAndCheckNewIncident(
  redis: Redis,
  guildId: string,
  windowSeconds: number,
): Promise<boolean> {
  const result = await redis.eval(MARK_RAID_HIT_SCRIPT, 1, raidLockKey(guildId), windowSeconds * 1000);
  return result === 1;
}
