/**
 * 日期工具：全部以 "YYYY-MM-DD" 字符串表示"日历日期"，内部统一按 UTC 做加减，
 * 避免服务器时区、夏令时影响周/月边界的计算。
 * 周起始日约定与 JS 一致：0=周日，1=周一，…，6=周六。
 */

export type DateStr = string;
export type MonthStr = string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const WEEKDAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

export function isValidDate(value: unknown): value is DateStr {
  if (typeof value !== "string") return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1970 || y > 2999) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function isValidMonth(value: unknown): value is MonthStr {
  if (typeof value !== "string") return false;
  const m = MONTH_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  return y >= 1970 && y <= 2999;
}

export function isValidWeekStart(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6;
}

function toUtc(date: DateStr): Date {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`非法日期: ${date}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function fromUtc(dt: Date): DateStr {
  const y = String(dt.getUTCFullYear()).padStart(4, "0");
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(date: DateStr, days: number): DateStr {
  const dt = toUtc(date);
  dt.setUTCDate(dt.getUTCDate() + days);
  return fromUtc(dt);
}

export function weekdayOf(date: DateStr): number {
  return toUtc(date).getUTCDay();
}

export function weekdayName(date: DateStr): string {
  return WEEKDAY_NAMES[weekdayOf(date)];
}

/** 返回 date 所在自然周的起始日 */
export function weekStartOf(date: DateStr, weekStart: number): DateStr {
  const offset = (weekdayOf(date) - weekStart + 7) % 7;
  return addDays(date, -offset);
}

export interface DateRange {
  start: DateStr;
  end: DateStr;
}

export function weekRange(date: DateStr, weekStart: number): DateRange {
  const start = weekStartOf(date, weekStart);
  return { start, end: addDays(start, 6) };
}

export function monthOf(date: DateStr): MonthStr {
  return date.slice(0, 7);
}

export function monthRange(month: MonthStr): DateRange {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

export function addMonths(month: MonthStr, delta: number): MonthStr {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}`;
}

/** 闭区间内的所有日期 */
export function eachDay(start: DateStr, end: DateStr): DateStr[] {
  const out: DateStr[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 日历网格范围：覆盖该月的所有完整自然周 */
export function monthGridRange(month: MonthStr, weekStart: number): DateRange {
  const r = monthRange(month);
  return { start: weekStartOf(r.start, weekStart), end: weekRange(r.end, weekStart).end };
}

export interface WeekSlice {
  /** 自然周的完整范围 */
  weekStart: DateStr;
  weekEnd: DateStr;
  /** 该周落在本月内的部分（按日期归属拆分） */
  from: DateStr;
  to: DateStr;
  /** 整周都在本月内 */
  full: boolean;
}

/** 与指定月份有交集的所有自然周，以及每周落在本月内的日期范围 */
export function weeksOfMonth(month: MonthStr, weekStart: number): WeekSlice[] {
  const mr = monthRange(month);
  const out: WeekSlice[] = [];
  for (let ws = weekStartOf(mr.start, weekStart); ws <= mr.end; ws = addDays(ws, 7)) {
    const we = addDays(ws, 6);
    const from = ws < mr.start ? mr.start : ws;
    const to = we > mr.end ? mr.end : we;
    out.push({ weekStart: ws, weekEnd: we, from, to, full: ws >= mr.start && we <= mr.end });
  }
  return out;
}
