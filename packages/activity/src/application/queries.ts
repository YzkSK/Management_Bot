import type { Db } from "@management-bot/db";
import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { toJstDay } from "../domain/index.js";

export type Granularity = "hour" | "day";
export type RankingSort = "voice" | "messages";

export interface SeriesPoint {
  bucket: string;
  messageCount: number;
  voiceSeconds: number;
}

interface RangeFilter {
  guildId: string;
  from: Date;
  to: Date;
  userId?: string;
}

/**
 * サーバー内で誰か1人でもVCにいた時間(重なりを除いた時間)を記録する予約ユーザーID(issue #508)。
 * Discordのユーザーは数値のスノーフレークなので衝突しない。ランキング・メンバー集計からは除外する。
 */
export const VOICE_OCCUPIED_USER_ID = "voice-occupied";

const count = z.coerce.number().int();
const nullableIso = z.coerce
  .date()
  .nullable()
  .transform((d) => (d ? d.toISOString() : null));

/**
 * [from, to) の活動行。時間単位の行とロールアップ済みの日次行の和集合を返す。
 * ロールアップは加算と削除を同一トランザクションで行うため、同じ活動が両方に存在することはない
 * (ロールアップ前の古い時間行もそのまま拾えるよう、90日の境界では分けずに両テーブルを読む)。
 * 日次行はJSTの日付単位のため、fromとtoを含む日の行はその日全体が対象になる。
 * 列: user_id, at(時間先頭またはJSTの0時), day(JST日付), hod(JSTの時、日次行はNULL), message_count, voice_seconds
 */
function activitySource(f: RangeFilter): SQL {
  const userFilter =
    f.userId === undefined ? sql` AND user_id <> ${VOICE_OCCUPIED_USER_ID}` : sql` AND user_id = ${f.userId}`;
  const lastDay = toJstDay(new Date(f.to.getTime() - 1));
  return sql`
    SELECT user_id, hour AS at,
           to_char(hour AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD') AS day,
           extract(hour FROM hour AT TIME ZONE 'Asia/Tokyo')::int AS hod,
           message_count, voice_seconds
    FROM activity_hourly
    WHERE guild_id = ${f.guildId}
      AND hour >= ${f.from.toISOString()}::timestamptz AND hour < ${f.to.toISOString()}::timestamptz${userFilter}
    UNION ALL
    SELECT user_id, (day::timestamp AT TIME ZONE 'Asia/Tokyo') AS at,
           to_char(day, 'YYYY-MM-DD') AS day, NULL::int AS hod,
           message_count, voice_seconds
    FROM activity_daily
    WHERE guild_id = ${f.guildId} AND day >= ${toJstDay(f.from)}::date AND day <= ${lastDay}::date${userFilter}`;
}

const seriesRowSchema = z.object({ bucket: z.string(), message_count: count, voice_seconds: count });

function toSeries(rows: unknown): SeriesPoint[] {
  return z
    .array(seriesRowSchema)
    .parse(rows)
    .map((r) => ({ bucket: r.bucket, messageCount: r.message_count, voiceSeconds: r.voice_seconds }));
}

function seriesQuery(source: SQL, granularity: Granularity): SQL {
  const bucket =
    granularity === "hour" ? sql.raw(`to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.000"Z"')`) : sql.raw("day");
  return sql`
    SELECT ${bucket} AS bucket, SUM(message_count)::bigint AS message_count, SUM(voice_seconds)::bigint AS voice_seconds
    FROM (${source}) src GROUP BY 1 ORDER BY 1`;
}

export async function getServerSummary(
  db: Db,
  input: { guildId: string; from: Date; to: Date; granularity: Granularity },
): Promise<{ totals: { messageCount: number; voiceSeconds: number; activeMembers: number }; series: SeriesPoint[] }> {
  const members = activitySource(input);
  // VC時間は延べ時間ではなく、誰かがVCにいた時間(予約ユーザーIDの行)で数える(issue #508)。
  const occupied = activitySource({ ...input, userId: VOICE_OCCUPIED_USER_ID });
  const series = sql`
    SELECT at, day, message_count, 0 AS voice_seconds FROM (${members}) m
    UNION ALL
    SELECT at, day, 0 AS message_count, voice_seconds FROM (${occupied}) o`;
  const [totalsRows, seriesRows] = await Promise.all([
    db.execute(sql`
      SELECT (SELECT COALESCE(SUM(message_count), 0) FROM (${members}) m)::bigint AS message_count,
             (SELECT COALESCE(SUM(voice_seconds), 0) FROM (${occupied}) o)::bigint AS voice_seconds,
             (SELECT COUNT(DISTINCT user_id) FILTER (WHERE message_count > 0 OR voice_seconds > 0) FROM (${members}) m)::int
               AS active_members`),
    db.execute(seriesQuery(series, input.granularity)),
  ]);
  const totals = z
    .tuple([z.object({ message_count: count, voice_seconds: count, active_members: count })])
    .parse([...totalsRows])[0];
  return {
    totals: { messageCount: totals.message_count, voiceSeconds: totals.voice_seconds, activeMembers: totals.active_members },
    series: toSeries([...seriesRows]),
  };
}

const SORT_COLUMN: Record<RankingSort, SQL> = {
  voice: sql.raw("voice_seconds"),
  messages: sql.raw("message_count"),
};

function aggregatedByUser(source: SQL): SQL {
  return sql`
    SELECT user_id, SUM(message_count)::bigint AS message_count, SUM(voice_seconds)::bigint AS voice_seconds,
           MAX(at) FILTER (WHERE message_count > 0 OR voice_seconds > 0) AS last_active_at
    FROM (${source}) src GROUP BY user_id
    HAVING SUM(message_count) > 0 OR SUM(voice_seconds) > 0`;
}

export interface RankingRow {
  userId: string;
  messageCount: number;
  voiceSeconds: number;
  lastActiveAt: string | null;
}

export async function getMemberRanking(
  db: Db,
  input: { guildId: string; from: Date; to: Date; sort: RankingSort; limit: number; offset: number },
): Promise<{ rows: RankingRow[]; total: number }> {
  const agg = aggregatedByUser(activitySource(input));
  const [rows, totalRows] = await Promise.all([
    db.execute(sql`
      SELECT * FROM (${agg}) agg
      ORDER BY ${SORT_COLUMN[input.sort]} DESC, user_id ASC
      LIMIT ${input.limit} OFFSET ${input.offset}`),
    db.execute(sql`SELECT COUNT(*)::int AS total FROM (${agg}) agg`),
  ]);
  return {
    rows: z
      .array(z.object({ user_id: z.string(), message_count: count, voice_seconds: count, last_active_at: nullableIso }))
      .parse([...rows])
      .map((r) => ({
        userId: r.user_id,
        messageCount: r.message_count,
        voiceSeconds: r.voice_seconds,
        lastActiveAt: r.last_active_at,
      })),
    total: z.tuple([z.object({ total: count })]).parse([...totalRows])[0].total,
  };
}

export interface MemberDetail {
  totals: { messageCount: number; voiceSeconds: number };
  rank: { messages: number | null; voice: number | null };
  byHourOfDay: { messageCount: number[]; voiceSeconds: number[] };
  daily: SeriesPoint[];
  lastMessageAt: string | null;
  lastVoiceAt: string | null;
}

/** 秒精度の最終時刻を優先し、導入前の行は時間先頭、ロールアップ済みは日付にフォールバックする。 */
function lastActivityAt(guildId: string, userId: string, column: "message_count" | "voice_seconds"): SQL {
  const col = sql.raw(column);
  const lastCol = sql.raw(column === "message_count" ? "last_message_at" : "last_voice_at");
  return sql`COALESCE(
    (SELECT MAX(${lastCol}) FROM activity_hourly WHERE guild_id = ${guildId} AND user_id = ${userId}),
    (SELECT MAX(hour) FROM activity_hourly WHERE guild_id = ${guildId} AND user_id = ${userId} AND ${col} > 0),
    (SELECT MAX(day)::timestamp AT TIME ZONE 'Asia/Tokyo' FROM activity_daily WHERE guild_id = ${guildId} AND user_id = ${userId} AND ${col} > 0)
  )`;
}

export async function getMemberDetail(
  db: Db,
  input: { guildId: string; userId: string; from: Date; to: Date },
): Promise<MemberDetail> {
  const guildSource = activitySource({ guildId: input.guildId, from: input.from, to: input.to });
  const userSource = activitySource(input);
  const [rankRows, hodRows, dailyRows, lastRows] = await Promise.all([
    db.execute(sql`
      WITH agg AS (${aggregatedByUser(guildSource)}),
      ranked AS (
        SELECT user_id, message_count, voice_seconds,
               CASE WHEN message_count > 0 THEN RANK() OVER (ORDER BY message_count DESC) END AS message_rank,
               CASE WHEN voice_seconds > 0 THEN RANK() OVER (ORDER BY voice_seconds DESC) END AS voice_rank
        FROM agg
      )
      SELECT message_count, voice_seconds, message_rank::int, voice_rank::int FROM ranked WHERE user_id = ${input.userId}`),
    db.execute(sql`
      SELECT hod, SUM(message_count)::bigint AS message_count, SUM(voice_seconds)::bigint AS voice_seconds
      FROM (${userSource}) src WHERE hod IS NOT NULL GROUP BY hod`),
    db.execute(seriesQuery(userSource, "day")),
    db.execute(sql`
      SELECT ${lastActivityAt(input.guildId, input.userId, "message_count")} AS last_message_at,
             ${lastActivityAt(input.guildId, input.userId, "voice_seconds")} AS last_voice_at`),
  ]);

  const rank = z
    .array(
      z.object({
        message_count: count,
        voice_seconds: count,
        message_rank: count.nullable(),
        voice_rank: count.nullable(),
      }),
    )
    .parse([...rankRows])[0];
  const messageByHour = Array.from({ length: 24 }, () => 0);
  const voiceByHour = Array.from({ length: 24 }, () => 0);
  const hodSchema = z.array(z.object({ hod: count, message_count: count, voice_seconds: count }));
  for (const r of hodSchema.parse([...hodRows])) {
    messageByHour[r.hod] = r.message_count;
    voiceByHour[r.hod] = r.voice_seconds;
  }
  const last = z
    .tuple([z.object({ last_message_at: nullableIso, last_voice_at: nullableIso })])
    .parse([...lastRows])[0];

  return {
    totals: { messageCount: rank?.message_count ?? 0, voiceSeconds: rank?.voice_seconds ?? 0 },
    rank: { messages: rank?.message_rank ?? null, voice: rank?.voice_rank ?? null },
    byHourOfDay: { messageCount: messageByHour, voiceSeconds: voiceByHour },
    daily: toSeries([...dailyRows]),
    lastMessageAt: last.last_message_at,
    lastVoiceAt: last.last_voice_at,
  };
}
