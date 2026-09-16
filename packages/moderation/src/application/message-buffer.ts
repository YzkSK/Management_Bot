import type { Redis } from "ioredis";

export interface BufferedMessage {
  messageId: string;
  channelId: string;
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

function strikeLockKey(guildId: string, userId: string, violationType: string): string {
  return `moderation:strike-lock:${guildId}:${userId}:${violationType}`;
}

interface SerializedMessage {
  messageId: string;
  channelId: string;
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
    channelId: message.channelId,
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

// KEYS[1]=strikeLockKey, ARGV[1]=windowSeconds(ミリ秒)
// 値は次にstrikeしてよい時刻(nextAllowedAtMs)を保持する。
// 現在時刻はアプリ側のDate.now()ではなく、Redisサーバーの時刻(TIMEコマンド)を唯一の時刻源とする
// (複数プロセス/ホストのクロックずれで判定がずれることを防ぐため)。
// 現在キーがない、またはnow>=nextAllowedAtMsなら「strike可能」と判定し、
// nextAllowedAtMs=now+windowSecondsで更新して1を返す(連投が途切れなくてもwindowSecondsごとに
// 必ずstrikeが進む)。まだnextAllowedAtMs未満なら0を返し、値は変更しない
// (TTLだけ後続の掃除用に据え置きで延長する)。
const MARK_STRIKE_HIT_SCRIPT = `
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
 * 連投バースト中の多重strike加算を、windowSecondsに1回のペースに制限するために違反ヒットを記録する。
 * 最後にstrikeしてからwindowSeconds秒経過していれば(バーストが途切れたか、バーストが続いたまま
 * windowSeconds経過したかを問わず)trueを返し、strikeを加算してよい。
 * それ以外(直近のstrikeからwindowSeconds未満)はfalseを返す。
 * これにより、連投が途切れない場合でもwindowSecondsごとに確実にエスカレーション段階が進む一方、
 * 1回のバースト内でメッセージのたびに無条件でstrikeが進むことは防げる。
 * strike加算(DB)が後続で失敗しても、この関数は状態を巻き戻さない
 * (DB接続断絶等の失敗はcommit済みかどうか判別できないため、誤って巻き戻すと
 * 実際にはcommit済みだった場合に二重strikeを許してしまう。windowSeconds経過後に
 * 自動的に次のstrikeが可能になるため、実害は検知が最大windowSecondsぶん遅れる程度)。
 */
export async function markStrikeHitAndCheckNewBurst(
  redis: Redis,
  guildId: string,
  userId: string,
  violationType: string,
  windowSeconds: number,
): Promise<boolean> {
  const result = await redis.eval(
    MARK_STRIKE_HIT_SCRIPT,
    1,
    strikeLockKey(guildId, userId, violationType),
    windowSeconds * 1000,
  );
  return result === 1;
}
