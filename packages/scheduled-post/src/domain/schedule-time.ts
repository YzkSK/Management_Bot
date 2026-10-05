const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** タイムゾーンは日本時間(JST、UTC+9、夏時間なし)固定。 */
const JST_OFFSET_MS = 9 * HOUR_MS;

/** 登録・編集とも、この時間以内(以下)に迫った日時は受け付けない。編集は投稿予定時刻のこの時間前まで。 */
export const MIN_LEAD_MS = MINUTE_MS;
/** 予約できるのは最長半年(183日)先まで。 */
export const MAX_AHEAD_MS = 183 * DAY_MS;
/** Bot停止中などで予定時刻を過ぎていても、遅れがこの時間以内なら投稿する。超えたら時間切れ。 */
export const EXPIRY_MS = HOUR_MS;

export type ScheduleTimeError = "invalid_format" | "invalid_date" | "past" | "too_soon" | "too_far";

export type ScheduleTimeResult = { ok: true; date: Date } | { ok: false; error: ScheduleTimeError; message: string };

export const SCHEDULE_TIME_ERROR_MESSAGES: Record<ScheduleTimeError, string> = {
  invalid_format:
    "日時の形式が正しくありません。`2026/10/10 20:00`・`10/10 20:00`・`30分後`・`2時間後`・`3日後` のいずれかで指定してください。",
  invalid_date: "存在しない日時です。日付と時刻を確認してください。",
  past: "過去の日時は指定できません。",
  too_soon: "1分以内の日時は指定できません。少し先の日時を指定してください。",
  too_far: "予約できるのは半年先までです。",
};

function fail(error: ScheduleTimeError): ScheduleTimeResult {
  return { ok: false, error, message: SCHEDULE_TIME_ERROR_MESSAGES[error] };
}

interface JstParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function jstParts(date: Date): JstParts {
  const shifted = new Date(date.getTime() + JST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/** 分未満(秒・ミリ秒)を切り捨てる。 */
export function truncateToMinute(date: Date): Date {
  return new Date(Math.floor(date.getTime() / MINUTE_MS) * MINUTE_MS);
}

const ABSOLUTE_PATTERN = /^(?:(\d{4})[/-])?(\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})$/;
const RELATIVE_PATTERN = /^(\d{1,6})\s*(分|時間|日)後$/;

/**
 * `2026/10/10 20:00`・`10/10 20:00`(年省略=JSTの今年)・`N分後`/`N時間後`/`N日後`を解釈する。
 * 構文のみを扱い、過去・近すぎ・遠すぎの検証は{@link validateScheduledAt}で行う。結果は分単位に切り捨てる。
 */
export function parseScheduleInput(input: string, now: Date): ScheduleTimeResult {
  // 全角数字・全角記号(／：など)を半角に揃える。
  const text = input.normalize("NFKC").trim();

  const relative = RELATIVE_PATTERN.exec(text);
  if (relative) {
    const amount = Number(relative[1]);
    const unitMs = relative[2] === "分" ? MINUTE_MS : relative[2] === "時間" ? HOUR_MS : DAY_MS;
    if (amount < 1) return fail("invalid_format");
    return { ok: true, date: truncateToMinute(new Date(now.getTime() + amount * unitMs)) };
  }

  const absolute = ABSOLUTE_PATTERN.exec(text);
  if (!absolute) return fail("invalid_format");
  const year = absolute[1] === undefined ? jstParts(now).year : Number(absolute[1]);
  const month = Number(absolute[2]);
  const day = Number(absolute[3]);
  const hour = Number(absolute[4]);
  const minute = Number(absolute[5]);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute) - JST_OFFSET_MS);
  const back = jstParts(date);
  // Date.UTCは範囲外の値(2月30日・25時等)を繰り上げて解釈するため、往復して一致するか確認する。
  if (back.year !== year || back.month !== month || back.day !== day || back.hour !== hour || back.minute !== minute) {
    return fail("invalid_date");
  }
  return { ok: true, date };
}

/** 過去・1分以内・半年超を弾く。登録時と編集時で共通。 */
export function validateScheduledAt(date: Date, now: Date): ScheduleTimeResult {
  const diff = date.getTime() - now.getTime();
  if (diff <= 0) return fail("past");
  if (diff <= MIN_LEAD_MS) return fail("too_soon");
  if (diff > MAX_AHEAD_MS) return fail("too_far");
  return { ok: true, date };
}

/** 入力文字列を解釈して検証する(登録・編集モーダル用)。 */
export function resolveScheduledAt(input: string, now: Date): ScheduleTimeResult {
  const parsed = parseScheduleInput(input, now);
  return parsed.ok ? validateScheduledAt(parsed.date, now) : parsed;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** モーダルの初期値用。`2026/10/10 20:00`(JST)。 */
export function formatScheduleInput(date: Date): string {
  const p = jstParts(date);
  return `${p.year}/${pad2(p.month)}/${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** 表示用の日時のみ。`10月10日 20:00`。今年以外は年も付ける。 */
export function formatScheduledLabel(date: Date, now: Date): string {
  const p = jstParts(date);
  const yearPart = p.year === jstParts(now).year ? "" : `${p.year}年`;
  return `${yearPart}${p.month}月${p.day}日 ${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** 表示用。`10月10日 20:00(あと3時間)`。今年以外は年も付ける。 */
export function formatScheduledAt(date: Date, now: Date): string {
  const label = formatScheduledLabel(date, now);
  const diff = date.getTime() - now.getTime();
  let remaining: string;
  if (diff < MINUTE_MS) remaining = "まもなく";
  else if (diff < HOUR_MS) remaining = `あと${Math.floor(diff / MINUTE_MS)}分`;
  else if (diff < DAY_MS) remaining = `あと${Math.floor(diff / HOUR_MS)}時間`;
  else remaining = `あと${Math.floor(diff / DAY_MS)}日`;
  return `${label}(${remaining})`;
}
