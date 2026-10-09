import type { CalendarDaily, DailyEntry, DailyVersion, JobView } from "@/lib/types";
import { isValidDate } from "@/lib/dates";
import { getDb, nowIso, transaction } from "./db";
import { AppError } from "./errors";
import { clearJob, startJob } from "./jobs";
import { generateText } from "./llm/client";
import { optimizationWarnings } from "./llm/guard";
import { OPTIMIZE_SYSTEM, optimizeUser } from "./llm/prompts";

export const MAX_DAILY_CHARS = 20_000;

interface DailyRow {
  date: string;
  original: string;
  optimized: string | null;
  active: DailyVersion;
  optimized_stale: number;
  optimized_model: string | null;
  optimized_at: string | null;
  created_at: string;
  updated_at: string;
}

function toEntry(row: DailyRow): DailyEntry {
  const useOptimized = row.active === "optimized" && row.optimized !== null;
  return {
    date: row.date,
    original: row.original,
    optimized: row.optimized,
    active: useOptimized ? "optimized" : "original",
    optimizedStale: row.optimized_stale === 1,
    optimizedModel: row.optimized_model,
    optimizedAt: row.optimized_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    effective: useOptimized ? (row.optimized as string) : row.original,
    warnings: row.optimized !== null && row.optimized_stale !== 1 ? optimizationWarnings(row.original, row.optimized) : [],
  };
}

export function assertDate(date: unknown): string {
  if (!isValidDate(date)) throw new AppError(400, "INVALID_DATE", "日期格式必须为 YYYY-MM-DD 且为有效日期");
  return date;
}

export function validateContent(content: unknown, field = "日报内容"): string {
  if (typeof content !== "string") throw new AppError(400, "INVALID_CONTENT", `${field}必须是文本`);
  const text = content.replace(/\r\n/g, "\n").trim();
  if (text === "") throw new AppError(400, "EMPTY_CONTENT", `${field}不能为空`);
  if (text.length > MAX_DAILY_CHARS) {
    throw new AppError(400, "CONTENT_TOO_LONG", `${field}过长，最多 ${MAX_DAILY_CHARS} 个字符`);
  }
  return text;
}

export function getDaily(date: string): DailyEntry | null {
  const row = getDb().prepare("SELECT * FROM daily_entries WHERE date = ?").get(date) as DailyRow | undefined;
  return row ? toEntry(row) : null;
}

export function requireDaily(date: string): DailyEntry {
  const entry = getDaily(date);
  if (!entry) throw new AppError(404, "NOT_FOUND", "该日期没有日报");
  return entry;
}

export function listDailies(from: string, to: string): DailyEntry[] {
  const rows = getDb()
    .prepare("SELECT * FROM daily_entries WHERE date >= ? AND date <= ? ORDER BY date")
    .all(from, to) as unknown as DailyRow[];
  return rows.map(toEntry);
}

export function calendarDailies(from: string, to: string): CalendarDaily[] {
  return listDailies(from, to).map((e) => ({
    date: e.date,
    active: e.active,
    hasOptimized: e.optimized !== null,
    optimizedStale: e.optimizedStale,
  }));
}

export type SubmitMode = "overwrite" | "append";

/**
 * 提交日报。一天只有一条：已存在且未指定 mode 时返回 409（附带已有内容），由前端让用户选择覆盖或追加。
 * 原文一旦变化，已有优化稿即标记过期，并回退到采用原文，保证周报/月报不会使用与原文不符的旧优化稿。
 */
export function submitDaily(date: string, contentInput: unknown, mode?: unknown): DailyEntry {
  const content = validateContent(contentInput);
  if (mode !== undefined && mode !== "overwrite" && mode !== "append") {
    throw new AppError(400, "INVALID_MODE", "mode 只能是 overwrite 或 append");
  }
  return transaction((db) => {
    const now = nowIso();
    const existing = db.prepare("SELECT * FROM daily_entries WHERE date = ?").get(date) as DailyRow | undefined;
    if (!existing) {
      db.prepare("INSERT INTO daily_entries (date, original, created_at, updated_at) VALUES (?, ?, ?, ?)").run(date, content, now, now);
    } else if (mode === undefined) {
      throw new AppError(409, "DAILY_EXISTS", "该日期已有日报，请选择覆盖或追加", { existing: toEntry(existing) });
    } else if (mode === "overwrite") {
      db.prepare(
        "UPDATE daily_entries SET original = ?, optimized = NULL, active = 'original', optimized_stale = 0, optimized_model = NULL, optimized_at = NULL, updated_at = ? WHERE date = ?",
      ).run(content, now, date);
    } else {
      const merged = `${existing.original.trimEnd()}\n${content}`;
      if (merged.length > MAX_DAILY_CHARS) {
        throw new AppError(400, "CONTENT_TOO_LONG", `追加后超过 ${MAX_DAILY_CHARS} 个字符的上限`);
      }
      db.prepare(
        "UPDATE daily_entries SET original = ?, active = 'original', optimized_stale = CASE WHEN optimized IS NULL THEN 0 ELSE 1 END, updated_at = ? WHERE date = ?",
      ).run(merged, now, date);
    }
    return requireDaily(date);
  });
}

/** 编辑原文或优化稿 */
export function editDaily(date: string, target: unknown, contentInput: unknown): DailyEntry {
  if (target !== "original" && target !== "optimized") {
    throw new AppError(400, "INVALID_TARGET", "target 只能是 original 或 optimized");
  }
  const content = validateContent(contentInput);
  return transaction((db) => {
    const row = db.prepare("SELECT * FROM daily_entries WHERE date = ?").get(date) as DailyRow | undefined;
    if (!row) throw new AppError(404, "NOT_FOUND", "该日期没有日报");
    const now = nowIso();
    if (target === "original") {
      if (content === row.original) return requireDaily(date);
      db.prepare(
        "UPDATE daily_entries SET original = ?, active = 'original', optimized_stale = CASE WHEN optimized IS NULL THEN 0 ELSE 1 END, updated_at = ? WHERE date = ?",
      ).run(content, now, date);
    } else {
      if (row.optimized === null) throw new AppError(409, "NO_OPTIMIZED", "该日报还没有优化稿");
      db.prepare("UPDATE daily_entries SET optimized = ?, updated_at = ? WHERE date = ?").run(content, now, date);
    }
    return requireDaily(date);
  });
}

export function deleteDaily(date: string): void {
  const result = getDb().prepare("DELETE FROM daily_entries WHERE date = ?").run(date);
  if (Number(result.changes) === 0) throw new AppError(404, "NOT_FOUND", "该日期没有日报");
  clearJob("optimize", date);
}

/** 选择采用哪一版；随时可回退到原文 */
export function setActiveVersion(date: string, active: unknown): DailyEntry {
  if (active !== "original" && active !== "optimized") {
    throw new AppError(400, "INVALID_ACTIVE", "active 只能是 original 或 optimized");
  }
  const entry = requireDaily(date);
  if (active === "optimized" && entry.optimized === null) {
    throw new AppError(409, "NO_OPTIMIZED", "该日报还没有优化稿，无法采用");
  }
  getDb().prepare("UPDATE daily_entries SET active = ?, updated_at = ? WHERE date = ?").run(active, nowIso(), date);
  return requireDaily(date);
}

/**
 * 启动日报优化任务：校验后立即返回，模型调用在后台执行（状态见 /api/jobs 与日历）。
 * 优化稿作为“候选版本”保存，不会自动替换原文，也不改变当前采用的版本；
 * 失败时不修改任何已保存的数据，任务状态记为失败，可直接重试。
 */
export function startOptimizeDaily(date: string): JobView {
  const before = requireDaily(date);
  return startJob("optimize", date, async () => {
    const { text, model } = await generateText({
      task: "optimize",
      system: OPTIMIZE_SYSTEM,
      user: optimizeUser(before.original),
      maxTokens: 4096,
    });
    transaction((db) => {
      const row = db.prepare("SELECT * FROM daily_entries WHERE date = ?").get(date) as DailyRow | undefined;
      if (!row) throw new AppError(404, "NOT_FOUND", "该日报在优化期间已被删除");
      if (row.original !== before.original) {
        throw new AppError(409, "CHANGED_DURING_OPTIMIZE", "日报在优化期间被修改，本次优化结果已丢弃，请重试");
      }
      const now = nowIso();
      db.prepare(
        "UPDATE daily_entries SET optimized = ?, optimized_stale = 0, optimized_model = ?, optimized_at = ?, updated_at = ? WHERE date = ?",
      ).run(text, model, now, now, date);
    });
  });
}
