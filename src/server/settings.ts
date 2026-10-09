import { getDb } from "./db";
import { isValidWeekStart } from "@/lib/dates";
import { AppError } from "./errors";

function envWeekStart(): number {
  const raw = process.env.WEEK_START;
  if (raw === undefined || raw === "") return 1;
  const n = Number(raw);
  return isValidWeekStart(n) ? n : 1;
}

/** 周起始日：0=周日 … 6=周六；默认周一，可通过设置修改（未设置时取环境变量 WEEK_START） */
export function getWeekStart(): number {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'week_start'").get() as
    | { value: string }
    | undefined;
  if (!row) return envWeekStart();
  const n = Number(row.value);
  return isValidWeekStart(n) ? n : envWeekStart();
}

export function setWeekStart(value: unknown): number {
  if (!isValidWeekStart(value)) {
    throw new AppError(400, "INVALID_WEEK_START", "周起始日必须是 0（周日）到 6（周六）之间的整数");
  }
  getDb()
    .prepare("INSERT INTO settings (key, value) VALUES ('week_start', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(String(value));
  return value;
}
