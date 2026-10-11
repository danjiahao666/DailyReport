import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * SQLite 单例（Node 内置 node:sqlite，无需编译原生模块）。
 * 挂在 globalThis 上，避免开发模式热更新时重复打开。
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS daily_entries (
  date TEXT PRIMARY KEY,
  original TEXT NOT NULL,
  optimized TEXT,
  active TEXT NOT NULL DEFAULT 'original' CHECK (active IN ('original','optimized')),
  optimized_stale INTEGER NOT NULL DEFAULT 0,
  optimized_model TEXT,
  optimized_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 日报优化稿的历史版本：每次优化、手动编辑、恢复都追加一条，版本号最大的一条就是当前优化稿
CREATE TABLE IF NOT EXISTS daily_optimized_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL REFERENCES daily_entries(date) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  content TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('generated','edited','restored')),
  model TEXT,
  -- 生成该版本时原文的哈希；NULL 表示无法确认它对应哪一版原文，一律按“已过期”处理
  source_hash TEXT,
  restored_from INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (date, version_no)
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('weekly','monthly')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  current_version_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (kind, period_start)
);

CREATE TABLE IF NOT EXISTS report_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  content TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('generated','edited','restored')),
  model TEXT,
  meta TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (report_id, version_no)
);

-- 大模型异步任务：每个对象（日报优化 / 周报 / 月报）只保留最近一次任务的状态
CREATE TABLE IF NOT EXISTS llm_jobs (
  kind TEXT NOT NULL CHECK (kind IN ('optimize','weekly','monthly')),
  target TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed')),
  error_code TEXT,
  error_message TEXT,
  retryable INTEGER NOT NULL DEFAULT 0,
  boot_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  PRIMARY KEY (kind, target)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** 本进程标识：任务记录里 boot_id 与之不同且仍为 running，说明执行它的进程已经退出 */
export const BOOT_ID: string = ((globalThis as { __dailyReportBootId?: string }).__dailyReportBootId ??= randomUUID());

interface DbHolder {
  db?: DatabaseSync;
  file?: string;
}

const holder: DbHolder = ((globalThis as { __dailyReportDb?: DbHolder }).__dailyReportDb ??= {});

export function dataDir(): string {
  return path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || "./data");
}

export function getDb(): DatabaseSync {
  const file = path.join(dataDir(), "daily-report.db");
  if (holder.db && holder.file === file) return holder.db;
  closeDb();
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA);
  backfillOptimizedVersions(db);
  // 上一个进程中断的任务不会再有人更新状态，标记为失败，避免页面永远显示“进行中”
  db.prepare(
    "UPDATE llm_jobs SET status = 'failed', error_code = 'INTERRUPTED', error_message = ?, retryable = 1, finished_at = ? WHERE status = 'running' AND boot_id <> ?",
  ).run("服务重启导致任务中断，请重试。", new Date().toISOString(), BOOT_ID);
  holder.db = db;
  holder.file = file;
  return db;
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * 升级前已有的优化稿没有历史记录：为每个有优化稿且无历史的日期补一条 v1。
 * 幂等，每次打开数据库都会执行，已有历史的日期不受影响。
 */
function backfillOptimizedVersions(db: DatabaseSync): void {
  const rows = db
    .prepare(
      `SELECT date, original, optimized, optimized_stale, optimized_model, optimized_at, updated_at FROM daily_entries e
       WHERE optimized IS NOT NULL AND NOT EXISTS (SELECT 1 FROM daily_optimized_versions v WHERE v.date = e.date)`,
    )
    .all() as unknown as {
    date: string;
    original: string;
    optimized: string;
    optimized_stale: number;
    optimized_model: string | null;
    optimized_at: string | null;
    updated_at: string;
  }[];
  if (rows.length === 0) return;
  const insert = db.prepare(
    "INSERT INTO daily_optimized_versions (date, version_no, content, origin, model, source_hash, created_at) VALUES (?, 1, ?, 'generated', ?, ?, ?)",
  );
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const r of rows) {
      insert.run(r.date, r.optimized, r.optimized_model, r.optimized_stale === 1 ? null : hashText(r.original), r.optimized_at ?? r.updated_at);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function closeDb(): void {
  if (holder.db) {
    holder.db.close();
    holder.db = undefined;
    holder.file = undefined;
  }
}

/** 在 IMMEDIATE 事务内执行同步函数，异常时回滚 */
export function transaction<T>(fn: (db: DatabaseSync) => T): T {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn(db);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
